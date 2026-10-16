// src/sync-all.js
import { rmSync } from 'node:fs';
import { config } from './config.js';
import { openDb } from './store/db.js';
import { discoverAuctions } from './crawler/discover.js';
import { run } from './crawler/main.js';
import { syncToMysql } from './store/mysql-sync.js';
import { closeBrowser } from './crawler/fallback.js';

export async function runAll(cfg = config) {
  // 全新快照：只反映当前在售
  try { rmSync(cfg.dbPath, { force: true }); } catch {}

  const auctions = await discoverAuctions();
  console.log(`[discover] ${auctions.length} SALVAGENZ auctions: ${auctions.map((a) => a.code).join(', ')}`);

  const reports = [];
  for (const a of auctions) {
    try {
      // 每场 run() 只填 SQLite，禁用其内置写库（写回统一在末尾做一次，避免重复跑迁移/逐行写）
      const r = await run({ ...cfg, auctionId: a.code, mysql: { ...cfg.mysql, enabled: false } });
      reports.push({ code: a.code, ...r });
      console.log(`[crawl] ${a.code}: expected=${r.expected} stored=${r.stored} missing=${r.missing.length}`);
    } catch (e) {
      reports.push({ code: a.code, error: String(e.message || e) });
      console.error(`[crawl] ${a.code} FAILED: ${e.message}`);
    }
  }
  await closeBrowser();

  let sync = { inserted: 0, skipped: 0 };
  if (cfg.mysql.enabled) {
    sync = await syncToMysql(openDb(cfg.dbPath), cfg);
    console.log(`[sync] inserted=${sync.inserted} skipped=${sync.skipped}`);
  } else {
    console.warn('[sync] MYSQL_SYNC 未开启，跳过写回（仅抓取到 SQLite）');
  }

  const totalMissing = reports.reduce((n, r) => n + (r.missing ? r.missing.length : 0), 0);
  console.log(`[done] auctions=${auctions.length} crawl-missing=${totalMissing} synced=${sync.inserted}`);
  return { auctions, reports, sync };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runAll().then((r) => process.exit(r.reports.every((x) => !x.error) ? 0 : 1));
}
