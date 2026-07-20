#!/usr/bin/env node
/**
 * 批量补图：把 car_crawler_manheim_image 里已爬到的图，补进客户车表 car_vehicles_images。
 *
 * 解决的问题：车录入 car_vehicles 时爬虫还没抓到该车 → app 取不到图 → 车表 0 图。
 * 事后爬虫抓到了，但没有回填机制，所以要手工补。
 *
 * 安全设计：
 *   - 默认 DRY-RUN（只打印计划），加 --execute 才真正写库
 *   - 按 rego（大小写/空格归一）匹配，并强制校验 make 一致，防止串车
 *   - 只处理"车表 0 图"的车，绝不覆盖已有图
 *   - 抽查图片 URL 是否可访问（默认每台查第一张），非 200 跳过
 *   - 全程单事务，失败整体回滚
 *
 * ⚠️ 注意：写入的 url 指向 Manheim 原图（临时）。Manheim 日后删图会断链。
 *    完整原图地址同时存入 ori_url，将来可据此重传到自有 S3 变永久图。
 *
 * 用法（在 manheim-crawler/ 下，.env 里配好 MYSQL_*）：
 *   node scripts/backfill-vehicle-images.mjs                 # 干跑，看有多少待补
 *   node scripts/backfill-vehicle-images.mjs --execute       # 真正写库
 *   node scripts/backfill-vehicle-images.mjs --limit 20 --execute
 *   node scripts/backfill-vehicle-images.mjs --stock 12294,12297 --execute   # 只补指定车
 *   node scripts/backfill-vehicle-images.mjs --no-url-check --execute        # 跳过图片可访问性抽查(更快)
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const EXECUTE = has('--execute');
const URL_CHECK = !has('--no-url-check');
const LIMIT = Number(val('--limit', '0')) || 0;
const ONLY_STOCK = (val('--stock', '') || '').split(',').map((s) => s.trim()).filter(Boolean);

async function httpStatus(url) {
  try {
    const { stdout } = await execFileAsync('curl', [
      '-sL', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '15',
      '-A', 'Mozilla/5.0', url,
    ]);
    return stdout.trim();
  } catch { return 'ERR'; }
}

function requireEnv(name) {
  const v = process.env[name];
  if (!v) { console.error(`缺少环境变量 ${name}（请在 manheim-crawler/.env 配置 MYSQL_HOST/MYSQL_USER/MYSQL_PASSWORD/MYSQL_DATABASE）`); process.exit(1); }
  return v;
}

const conn = await mysql.createConnection({
  host: requireEnv('MYSQL_HOST'),
  port: Number(process.env.MYSQL_PORT || 3306),
  user: requireEnv('MYSQL_USER'),
  password: requireEnv('MYSQL_PASSWORD'),
  database: requireEnv('MYSQL_DATABASE'),
  connectTimeout: 15000,
});

// 候选：车表有车、车表 0 图、且爬虫库按 rego 命中且该车有图。
// 同一 rego 可能命中多条爬虫记录（历史重复），取图最多的那条。
const [rows] = await conn.query(`
  SELECT v.id AS stock, v.registration_id AS v_rego, v.make AS v_make, v.model AS v_model,
         m.id AS manheim_id, m.uuid, m.make AS m_make, m.model AS m_model,
         (SELECT COUNT(*) FROM car_crawler_manheim_image i WHERE i.manheim_id = m.id) AS crawler_imgs
  FROM car_vehicles v
  JOIN car_crawler_manheim m
    ON UPPER(TRIM(m.registration)) = UPPER(TRIM(v.registration_id))
  WHERE v.is_del = 0
    AND TRIM(COALESCE(v.registration_id,'')) <> ''
    AND NOT EXISTS (SELECT 1 FROM car_vehicles_images vi WHERE vi.vehicles_id = v.id)
    AND EXISTS (SELECT 1 FROM car_crawler_manheim_image i WHERE i.manheim_id = m.id)
  ORDER BY v.id DESC
`);

// 每台车只保留 crawler_imgs 最多的那条爬虫记录
const best = new Map();
for (const r of rows) {
  const cur = best.get(r.stock);
  if (!cur || r.crawler_imgs > cur.crawler_imgs) best.set(r.stock, r);
}
let candidates = [...best.values()];
if (ONLY_STOCK.length) candidates = candidates.filter((c) => ONLY_STOCK.includes(String(c.stock)));
if (LIMIT) candidates = candidates.slice(0, LIMIT);

console.log(`候选待补车辆：${candidates.length} 台${EXECUTE ? '（EXECUTE 模式）' : '（DRY-RUN，不写库）'}`);
console.log('stock  rego     | 车表 make/model | 爬虫 make/model (场次) | 图 | 校验');

const todo = [];
for (const c of candidates) {
  const alignOk = String(c.v_make || '').trim().toLowerCase() === String(c.m_make || '').trim().toLowerCase();
  let urlCode = 'skip';
  if (alignOk && URL_CHECK) {
    const [first] = await conn.query('SELECT url FROM car_crawler_manheim_image WHERE manheim_id=? ORDER BY id LIMIT 1', [c.manheim_id]);
    urlCode = first.length ? await httpStatus(first[0].url) : 'noimg';
  }
  const ok = alignOk && (!URL_CHECK || urlCode === '200');
  console.log(`${c.stock} ${String(c.v_rego).padEnd(8)}| ${c.v_make} ${c.v_model} | ${c.m_make} ${c.m_model} (${c.uuid}) | ${c.crawler_imgs} | ${alignOk ? '' : 'MAKE不符!跳过 '}${URL_CHECK ? 'url=' + urlCode : ''}${ok ? ' ✓' : ' ✗'}`);
  if (ok) todo.push(c);
}

if (!todo.length) { console.log('\n没有可补的车。'); await conn.end(); process.exit(0); }

await conn.beginTransaction();
let rowsInserted = 0;
for (const c of todo) {
  // 再查一次，防并发/重复
  const [ex] = await conn.query('SELECT COUNT(*) n FROM car_vehicles_images WHERE vehicles_id=?', [c.stock]);
  if (ex[0].n > 0) { console.log(`SKIP ${c.stock}: 期间已有 ${ex[0].n} 张`); continue; }
  const [imgs] = await conn.query('SELECT url FROM car_crawler_manheim_image WHERE manheim_id=? ORDER BY id', [c.manheim_id]);
  let n = 0;
  for (const im of imgs) {
    n++;
    await conn.execute(
      `INSERT INTO car_vehicles_images (vehicles_id,num,url,ori_url,create_by,update_by,create_time,update_time)
       VALUES (?,?,?,?,?,?,NOW(),NOW())`,
      [c.stock, n, String(im.url).replace(/^https?:\/\//, ''), im.url, 'System', 'System']
    );
  }
  rowsInserted += n;
}

if (EXECUTE) {
  await conn.commit();
  console.log(`\n*** 已提交：${todo.length} 台 / ${rowsInserted} 张图 ***`);
} else {
  await conn.rollback();
  console.log(`\n*** DRY-RUN 已回滚（未写库）：将补 ${todo.length} 台 / ${rowsInserted} 张图 ***`);
  console.log('确认无误后加 --execute 真正写入。');
}
await conn.end();
