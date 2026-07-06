// src/crawler/main.js
import { BasicCrawler, Configuration } from 'crawlee';
import { load } from 'cheerio';
import { config } from '../config.js';
import { openDb, upsertVehicle, insertImages, recordFailed } from '../store/db.js';
import { buildListingUrl, parseListing } from './listing.js';
import { parseDetail } from './detail.js';
import { fetchHtml } from './fetcher.js';
import { closeBrowser } from './fallback.js';
import { uploadImages } from '../media/s3.js';
import { reconcile } from '../reconcile.js';
// mysql-sync 用 lazy import（默认关时不加载 mysql2）。

export async function run(cfg = config) {
  const db = openDb(cfg.dbPath);
  const enqueued = new Set();
  const stored = new Set();

  const crawler = new BasicCrawler({
    maxConcurrency: cfg.maxConcurrency,
    maxRequestRetries: cfg.maxRequestRetries,
    // BasicCrawler 由我们在 handler 内自行 fetch（curl 快路径 / Playwright 兜底），
    // 绕过 gotScraping 的 403 指纹拦截；队列/重试/并发仍由 Crawlee 提供。
    async requestHandler({ request, addRequests }) {
      const label = request.userData.label;
      const isDetail = label === 'DETAIL';
      const { html, mode } = await fetchHtml(request.url, { isDetail });
      const $ = load(html);

      if (label === 'LIST') {
        const { detailUrls, hasNext } = parseListing($, cfg.baseUrl);
        for (const url of detailUrls) enqueued.add(url);
        await addRequests(detailUrls.map((url) => ({ url, userData: { label: 'DETAIL' } })));
        // 仅当当前页确实产出了详情 URL 才翻页，防止最后一页仍渲染 a.next 导致页码无限攀升。
        if (hasNext && detailUrls.length > 0) {
          const page = (request.userData.page || 1) + 1;
          await addRequests([{ url: buildListingUrl(cfg, page), userData: { label: 'LIST', page } }]);
        }
        return;
      }

      // DETAIL
      const { vehicle, images } = parseDetail($, request.url);
      vehicle.fetch_mode = mode;

      // 只在"连车辆基本信息都解析不到"时才判为空跳过（说明抓取/解析失败）。
      // 摩托/ATV 等无 vin/rego 但有 make + item_id 的车照常入库（用 item_id 兜底去重），不再漏。
      const hasIdentifier = vehicle.vin || vehicle.registration || vehicle.item_id;
      if (!hasIdentifier || (!vehicle.vin && !vehicle.registration && !vehicle.make)) {
        recordFailed(db, { url: request.url, kind: 'empty', error: 'no identifier/make after fetch', attempts: request.retryCount });
        return; // 对账会把它算作 missing → 可见
      }

      const withS3 = await uploadImages(images, cfg);
      const { id } = upsertVehicle(db, vehicle);
      if (withS3.length) insertImages(db, id, vehicle.uuid ?? null, withS3);
      stored.add(request.url);
    },
    failedRequestHandler({ request, error }) {
      recordFailed(db, { url: request.url, kind: request.userData.label === 'LIST' ? 'listing' : 'detail', error: String(error?.message || error), attempts: request.retryCount });
    },
  }, new Configuration({ persistStorage: false }));

  try {
    await crawler.addRequests([{ url: buildListingUrl(cfg, 1), userData: { label: 'LIST', page: 1 } }]);
    await crawler.run();

    const report = reconcile([...enqueued], [...stored]);
    console.log(`[reconcile] expected=${report.expected} stored=${report.stored} missing=${report.missing.length}`);
    if (!report.ok) {
      console.error('[reconcile] MISSING URLS:\n' + report.missing.join('\n'));
    }

    if (cfg.mysql.enabled) {
      const { syncToMysql } = await import('../store/mysql-sync.js'); // lazy：默认关时不加载 mysql2
      await syncToMysql(db, cfg);
    }

    return report;
  } finally {
    // 即使 crawler.run() 抛错也要关闭共享的 chromium 浏览器和 db，避免句柄泄漏。
    await closeBrowser();
    db.close();
  }
}

// 直接运行入口
if (import.meta.url === `file://${process.argv[1]}`) {
  run().then((r) => process.exit(r.ok ? 0 : 1));
}
