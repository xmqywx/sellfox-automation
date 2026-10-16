#!/usr/bin/env node
/**
 * 把 car_vehicles_images 里"临时指向 Manheim 原图"的记录，转成永久 S3 托管图。
 *
 * 背景：批量补图脚本写入的 url 指向 img.manheim.com.au（临时，Manheim 删图即断）。
 * 本脚本下载原图 → 上传到自有 S3 bucket（对象公开可访问）→ 把 url 改成 S3 直链。
 * S3 直链格式与 Java 后端 uploadFile 一致：<bucket>.s3.<region>.amazonaws.com/<key>
 *
 * 安全设计：
 *   - 默认 DRY-RUN，加 --execute 才真正上传/改库
 *   - 只处理 url 仍指向 Manheim 的行（幂等，重跑不会重复传已永久化的）
 *   - 逐张：下载失败/上传失败 → 跳过该张，不改其 url（下次可重试），不影响其它
 *   - 改 url 前校验 S3 直链确实 200 可访问，否则不改
 *
 * 环境变量（不写进脚本）：
 *   MYSQL_HOST/MYSQL_PORT/MYSQL_USER/MYSQL_PASSWORD/MYSQL_DATABASE   （.env）
 *   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_REGION(默认 ap-southeast-2)
 *   S3_BUCKET（默认 carrecyclimages）
 *
 * 用法（manheim-crawler/ 下）：
 *   node scripts/promote-images-to-s3.mjs                 # 干跑：看多少待永久化
 *   node scripts/promote-images-to-s3.mjs --execute       # 真正上传+改库
 *   node scripts/promote-images-to-s3.mjs --limit 200 --execute
 *   node scripts/promote-images-to-s3.mjs --stock 12247 --execute
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const EXECUTE = has('--execute');
const LIMIT = Number(val('--limit', '0')) || 0;
const ONLY_STOCK = (val('--stock', '') || '').split(',').map((s) => s.trim()).filter(Boolean);

const REGION = process.env.AWS_REGION || 'ap-southeast-2';
const BUCKET = process.env.S3_BUCKET || 'carrecyclimages';
const S3_HOST = `${BUCKET}.s3.${REGION}.amazonaws.com`;

function requireEnv(name) {
  const v = process.env[name];
  if (!v) { console.error(`缺少环境变量 ${name}`); process.exit(1); }
  return v;
}

const s3 = new S3Client({
  region: REGION,
  credentials: { accessKeyId: requireEnv('AWS_ACCESS_KEY_ID'), secretAccessKey: requireEnv('AWS_SECRET_ACCESS_KEY') },
});

async function httpStatus(url) {
  try {
    const { stdout } = await execFileAsync('curl', ['-sL', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '20', url]);
    return stdout.trim();
  } catch { return 'ERR'; }
}

const conn = await mysql.createConnection({
  host: requireEnv('MYSQL_HOST'), port: Number(process.env.MYSQL_PORT || 3306),
  user: requireEnv('MYSQL_USER'), password: requireEnv('MYSQL_PASSWORD'),
  database: requireEnv('MYSQL_DATABASE'), connectTimeout: 15000,
});

// 待永久化：url 仍指向 Manheim 原图
let sql = "SELECT id, vehicles_id, url FROM car_vehicles_images WHERE url LIKE 'img.manheim.com.au/%'";
const params = [];
if (ONLY_STOCK.length) { sql += ` AND vehicles_id IN (${ONLY_STOCK.map(() => '?').join(',')})`; params.push(...ONLY_STOCK); }
sql += ' ORDER BY vehicles_id, num';
if (LIMIT) sql += ` LIMIT ${LIMIT}`;
const [rows] = await conn.query(sql, params);

console.log(`待永久化图片：${rows.length} 条${EXECUTE ? '（EXECUTE）' : '（DRY-RUN）'}  bucket=${BUCKET}`);
if (!rows.length) { console.log('没有待永久化的图（都已是永久图或无临时图）。'); await conn.end(); process.exit(0); }
if (!EXECUTE) {
  console.log('样例：');
  for (const r of rows.slice(0, 5)) {
    const key = r.url.replace(/^img\.manheim\.com\.au\//, '');
    console.log(`  id${r.id} stock${r.vehicles_id}: ${r.url}\n    → s3 key=${key}  →  ${S3_HOST}/${key}`);
  }
  console.log('\n确认后加 --execute 真正上传+改库。');
  await conn.end();
  process.exit(0);
}

let ok = 0, fail = 0;
for (const r of rows) {
  const srcUrl = 'https://' + r.url;
  const key = r.url.replace(/^img\.manheim\.com\.au\//, '');
  try {
    const res = await fetch(srcUrl);
    if (!res.ok) throw new Error('download ' + res.status);
    const buf = Buffer.from(await res.arrayBuffer());
    const ct = res.headers.get('content-type') || 'image/jpeg';
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: buf, ContentType: ct }));
    const s3url = `${S3_HOST}/${key}`;
    const code = await httpStatus('https://' + s3url);
    if (code !== '200') throw new Error('s3 url not 200: ' + code);
    await conn.execute('UPDATE car_vehicles_images SET url=?, update_by=?, update_time=NOW() WHERE id=?', [s3url, 'System', r.id]);
    ok++;
    if (ok % 25 === 0) console.log(`  ...已永久化 ${ok}`);
  } catch (e) {
    fail++;
    console.warn(`  FAIL id${r.id} stock${r.vehicles_id}: ${String(e.message || e)}`);
  }
}
console.log(`\n*** 完成：永久化 ${ok} 张，失败 ${fail} 张（失败的 url 未改，可重跑） ***`);
await conn.end();
