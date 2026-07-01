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
        if (hasNext) {
          const page = (request.userData.page || 1) + 1;
          await addRequests([{ url: buildListingUrl(cfg, page), userData: { label: 'LIST', page } }]);
        }
        return;
      }

      // DETAIL
      const { vehicle, images } = parseDetail($, request.url);
      vehicle.fetch_mode = mode;

      if (!vehicle.vin && !vehicle.registration) {
        recordFailed(db, { url: request.url, kind: 'empty', error: 'no vin/rego after fetch', attempts: request.retryCount });
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

  await crawler.addRequests([{ url: buildListingUrl(cfg, 1), userData: { label: 'LIST', page: 1 } }]);
  await crawler.run();
  await closeBrowser();

  const report = reconcile([...enqueued], [...stored]);
  console.log(`[reconcile] expected=${report.expected} stored=${report.stored} missing=${report.missing.length}`);
  if (!report.ok) {
    console.error('[reconcile] MISSING URLS:\n' + report.missing.join('\n'));
  }

  if (cfg.mysql.enabled) {
    const { syncToMysql } = await import('../store/mysql-sync.js'); // lazy：默认关时不加载 mysql2
    await syncToMysql(db, cfg);
  }

  db.close();
  return report;
}

// 直接运行入口
if (import.meta.url === `file://${process.argv[1]}`) {
  run().then((r) => process.exit(r.ok ? 0 : 1));
}
