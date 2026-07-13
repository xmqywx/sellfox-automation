# Manheim 自动写回 MySQL + 定时替代 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Node 爬虫自动发现当前所有 salvage 拍卖、抓全、并自动写回生产 MySQL（幂等、与 Java 共存不重复），本地定时运行。

**Architecture:** 新增 `discover.js`（Playwright 首页 → 当前 SALVAGENZ 拍卖代码）、`mysql-migrate.js`（幂等给生产表加 item_id 列）、重写 `mysql-sync.js`（SELECT-先查-不存在才插，含 item_id 与图片、跨库 id 映射）、`sync-all.js`（编排：发现→逐场爬→写回），并加 `enrich.js` 给车注入 uuid/plan_type。定时用本地 cron 跑 `sync-all`。

**Tech Stack:** Node 22 (ESM) · Crawlee BasicCrawler · Playwright · cheerio · better-sqlite3 · mysql2 · vitest

**Spec:** `docs/superpowers/specs/2026-07-14-manheim-mysql-autosync-design.md`

**关键实测前提（已在设计阶段确认，2026-07-14）：**
- 生产表 `car_crawler_manheim` 仅 PRIMARY(id)，**vin/rego 无唯一键** → 去重只能靠应用层 SELECT-先查；现有 `mysql-sync.js` 的 `ON DUPLICATE KEY UPDATE` **必须删除重写**。
- `admin` 账号有 ALTER/INDEX 权限，可加列。
- SQLite `manheim` 表**已有** uuid/plan_type/item_id 列（无需改 schema）。

---

## File Structure

```
manheim-crawler/src/
  crawler/
    enrich.js        # 【新】enrichVehicle(vehicle,cfg): 注入 uuid=auctionId, plan_type
    discover.js      # 【新】parseAuctionsFromHtml + discoverAuctions(Playwright 首页)
    main.js          # 【改】parseDetail 后调 enrichVehicle
  store/
    mysql-migrate.js # 【新】ensureItemIdColumn(conn,{dbName}) 幂等加列+索引
    mysql-sync.js    # 【重写】syncRows: SELECT-先查-不存在才插 + 全字段 + item_id + 图片
  sync-all.js        # 【新】runAll: discover → 逐场 run → syncToMysql → 汇总
scripts/
  cron-sync.sh       # 【新】cron 包装脚本
  run-migration.md   # 【新】生产加列的干跑+确认+执行记录
test/
  enrich.test.js  discover.test.js  mysql-migrate.test.js  mysql-sync.test.js
  fixtures/homepage-rendered.html   fixtures/homepage-broken.html
```

---

## Chunk 1: 迁移脚本 + 车辆字段注入

### Task 1: mysql-migrate.js（幂等给生产表加 item_id 列）

**Files:**
- Create: `manheim-crawler/src/store/mysql-migrate.js`
- Test: `manheim-crawler/test/mysql-migrate.test.js`

- [ ] **Step 1: 写失败测试（注入假 conn，两分支）**

```js
// test/mysql-migrate.test.js
import { describe, it, expect, vi } from 'vitest';
import { ensureItemIdColumn } from '../src/store/mysql-migrate.js';

function fakeConn(responses) {
  const calls = [];
  const query = vi.fn(async (sql, params) => { calls.push({ sql, params }); return responses.shift(); });
  return { calls, query };
}

describe('ensureItemIdColumn', () => {
  it('skips ALTER when column already exists', async () => {
    const conn = fakeConn([[[{ COLUMN_NAME: 'item_id' }]]]); // information_schema returns a row
    const r = await ensureItemIdColumn(conn, { dbName: 'nzcar_recycling_prod' });
    expect(r.added).toBe(false);
    expect(conn.calls.length).toBe(1); // only the existence check
  });

  it('runs ALTER + CREATE INDEX when column is absent', async () => {
    const conn = fakeConn([[[]], [{}], [{}]]); // absent, then ALTER, then CREATE INDEX
    const r = await ensureItemIdColumn(conn, { dbName: 'nzcar_recycling_prod' });
    expect(r.added).toBe(true);
    expect(conn.calls[1].sql).toMatch(/ALTER TABLE car_crawler_manheim ADD COLUMN item_id/i);
    expect(conn.calls[2].sql).toMatch(/CREATE INDEX idx_manheim_item/i);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd manheim-crawler && npx vitest run test/mysql-migrate.test.js`
Expected: FAIL（模块未定义）。

- [ ] **Step 3: 实现 mysql-migrate.js**

```js
// src/store/mysql-migrate.js
// 幂等给生产表加 item_id 列。MySQL 无 ADD COLUMN IF NOT EXISTS，用 information_schema 判断。
export async function ensureItemIdColumn(conn, { dbName }) {
  const [cols] = await conn.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'car_crawler_manheim' AND COLUMN_NAME = 'item_id'`,
    [dbName]
  );
  if (cols.length) return { added: false };
  await conn.query('ALTER TABLE car_crawler_manheim ADD COLUMN item_id VARCHAR(50) NULL');
  await conn.query('CREATE INDEX idx_manheim_item ON car_crawler_manheim (item_id)');
  return { added: true };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd manheim-crawler && npx vitest run test/mysql-migrate.test.js`
Expected: PASS（2 tests）。

- [ ] **Step 5: Commit**

```bash
git add manheim-crawler/src/store/mysql-migrate.js manheim-crawler/test/mysql-migrate.test.js
git commit -m "feat(crawler): 幂等迁移脚本 给生产表加 item_id 列"
```

---

### Task 1b: 【人工门控】对生产库执行加列

> ⚠️ 改生产库。**不由 subagent 自动执行**——由控制者/人工跑，干跑确认后再执行。

- [ ] **Step 1: 干跑（只查，不改）**

Run（在 `manheim-crawler/`，用 `.env` 或环境变量提供 MYSQL_HOST/MYSQL_USER/MYSQL_PASSWORD/MYSQL_DATABASE，与 config.js 一致）：
```bash
node -e "import('mysql2/promise').then(async m=>{const c=await m.default.createConnection({host:process.env.MYSQL_HOST,port:Number(process.env.MYSQL_PORT||3306),user:process.env.MYSQL_USER,password:process.env.MYSQL_PASSWORD,database:process.env.MYSQL_DATABASE});const [x]=await c.query(\"SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='car_crawler_manheim' AND COLUMN_NAME='item_id'\",[process.env.MYSQL_DATABASE]);console.log('item_id exists:',x.length>0);await c.end();})"
```
Expected: `item_id exists: false`（首次）。

- [ ] **Step 2: 执行加列（确认后）**

Run:
```bash
node -e "import('./src/store/mysql-migrate.js').then(async M=>{const m=await import('mysql2/promise');const c=await m.default.createConnection({host:process.env.MYSQL_HOST,port:Number(process.env.MYSQL_PORT||3306),user:process.env.MYSQL_USER,password:process.env.MYSQL_PASSWORD,database:process.env.MYSQL_DATABASE});const r=await M.ensureItemIdColumn(c,{dbName:process.env.MYSQL_DATABASE});console.log(r);await c.end();})"
```
Expected: `{ added: true }`（首次）；重跑应 `{ added: false }`（幂等）。

- [ ] **Step 3: 记录到 scripts/run-migration.md**

写明执行时间、before/after（`SHOW COLUMNS FROM car_crawler_manheim LIKE 'item_id'`）、回滚命令 `ALTER TABLE car_crawler_manheim DROP COLUMN item_id;`。
另核查索引已建：`SHOW INDEX FROM car_crawler_manheim WHERE Key_name='idx_manheim_item'`；若上次半途加了列但索引没建成（迁移脚本会因列已存在而跳过建索引），手动补 `CREATE INDEX idx_manheim_item ON car_crawler_manheim (item_id);`。

- [ ] **Step 4: Commit**

```bash
git add manheim-crawler/scripts/run-migration.md
git commit -m "chore(crawler): 生产库加 item_id 列 执行记录"
```

---

### Task 2: enrich.js（给车注入 uuid/plan_type）

**Files:**
- Create: `manheim-crawler/src/crawler/enrich.js`
- Modify: `manheim-crawler/src/crawler/main.js`
- Test: `manheim-crawler/test/enrich.test.js`

- [ ] **Step 1: 写失败测试**

```js
// test/enrich.test.js
import { describe, it, expect } from 'vitest';
import { enrichVehicle } from '../src/crawler/enrich.js';

describe('enrichVehicle', () => {
  it('sets uuid to the auction id and plan_type to Salvage', () => {
    const v = { vin: 'X', make: 'Toyota' };
    enrichVehicle(v, { auctionId: 'ND130726' });
    expect(v.uuid).toBe('ND130726');
    expect(v.plan_type).toBe('Salvage');
  });

  it('does not overwrite an existing non-null uuid/plan_type', () => {
    const v = { uuid: 'KEEP', plan_type: 'Other' };
    enrichVehicle(v, { auctionId: 'ND130726' });
    expect(v.uuid).toBe('KEEP');
    expect(v.plan_type).toBe('Other');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd manheim-crawler && npx vitest run test/enrich.test.js`
Expected: FAIL（模块未定义）。

- [ ] **Step 3: 实现 enrich.js**

```js
// src/crawler/enrich.js
// 新站 DOM 不含 uuid/plan_type，由编排按拍卖注入（生产 MySQL 这两列 NOT NULL）。
export function enrichVehicle(vehicle, cfg) {
  if (vehicle.uuid == null) vehicle.uuid = cfg.auctionId;
  if (vehicle.plan_type == null) vehicle.plan_type = cfg.planType || 'Salvage';
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd manheim-crawler && npx vitest run test/enrich.test.js`
Expected: PASS（2 tests）。

- [ ] **Step 5: main.js 接线**

在 `src/crawler/main.js` 的 DETAIL 分支，`parseDetail` 之后、`upsertVehicle` 之前调用。
先加 import：
```js
import { enrichVehicle } from './enrich.js';
```
再在 `vehicle.fetch_mode = mode;` 之后加一行：
```js
      enrichVehicle(vehicle, cfg);
```

- [ ] **Step 6: 跑全套 + 冒烟确认不崩**

Run: `cd manheim-crawler && npx vitest run`
Expected: 全绿。
Run: `rm -f data/manheim.sqlite && AUCTION_ID=NR200726 PLAYWRIGHT_BROWSERS_PATH=0 npm run crawl 2>&1 | grep reconcile`
Expected: `missing=0`；`sqlite3 data/manheim.sqlite "SELECT DISTINCT uuid,plan_type FROM manheim"` → `NR200726|Salvage`。

- [ ] **Step 7: Commit**

```bash
git add manheim-crawler/src/crawler/enrich.js manheim-crawler/src/crawler/main.js manheim-crawler/test/enrich.test.js
git commit -m "feat(crawler): 注入 uuid=拍卖代码 + plan_type=Salvage"
```

---

## Chunk 2: 拍卖发现 + mysql-sync 重写

### Task 3: discover.js（Playwright 首页发现当前拍卖）

**Files:**
- Create: `manheim-crawler/src/crawler/discover.js`
- Create: `manheim-crawler/test/fixtures/homepage-rendered.html`（真实渲染后 HTML 快照）
- Create: `manheim-crawler/test/fixtures/homepage-broken.html`（无拍卖链接的坏结构）
- Test: `manheim-crawler/test/discover.test.js`

- [ ] **Step 1: 抓真实渲染首页存 fixture**

Run（Playwright 渲染首页并存 body HTML）：
```bash
cd manheim-crawler && PLAYWRIGHT_BROWSERS_PATH=0 node -e "import('playwright').then(async({chromium})=>{const b=await chromium.launch({headless:true});const p=await(await b.newContext()).newPage();await p.goto('https://www.manheim.co.nz/',{waitUntil:'networkidle',timeout:45000});await new Promise(r=>setTimeout(r,3000));require('fs').writeFileSync('test/fixtures/homepage-rendered.html',await p.content());await b.close();console.log('saved');})"
```
Expected: `homepage-rendered.html` 含多个 `/damaged-vehicles/auctions/<CODE>...franchiseID=SALVAGENZ` 链接。
再手工造一个 `homepage-broken.html`：`<html><body>no auctions here</body></html>`。

- [ ] **Step 2: 写失败测试**

```js
// test/discover.test.js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseAuctionsFromHtml } from '../src/crawler/discover.js';

const rendered = readFileSync(new URL('./fixtures/homepage-rendered.html', import.meta.url), 'utf8');
const broken = readFileSync(new URL('./fixtures/homepage-broken.html', import.meta.url), 'utf8');

describe('parseAuctionsFromHtml', () => {
  it('extracts SALVAGENZ auction codes only', () => {
    const list = parseAuctionsFromHtml(rendered);
    const codes = list.map(a => a.code);
    expect(list.length).toBeGreaterThan(0);
    for (const a of list) expect(a.code).toMatch(/^[A-Z]{2}[0-9]{6}$/);
    // 硬校验真值：fixture 里真实存在的某个 SALVAGENZ 代码必须被抽到
    expect(codes).toContain('__FILL_REAL_SALVAGE_CODE__');
    // 过滤生效：fixture 里存在的某个非 SALVAGENZ 代码（passenger PP/PS 或 trucks）必须不在列表
    expect(codes).not.toContain('__FILL_REAL_NON_SALVAGE_CODE__');
  });

  it('throws (not returns []) when structure is broken / nothing parsed', () => {
    expect(() => parseAuctionsFromHtml(broken)).toThrow(/structure|no .*auction/i);
  });
});
```

- [ ] **Step 2b: 用真实代码替换占位（防"能过但没校验真值"硬 gate）**

打开 `test/fixtures/homepage-rendered.html`，找一个真实的 SALVAGENZ 拍卖代码（如 `ND130726`）填入
`__FILL_REAL_SALVAGE_CODE__`，再找一个真实的 passenger/trucks 代码（如 `PS140726` 或 `PP120726`）
填入 `__FILL_REAL_NON_SALVAGE_CODE__`。**未替换占位即视为未完成本步**（`toContain('__FILL...')` 必失败）。

- [ ] **Step 3: 跑测试确认失败**

Run: `cd manheim-crawler && npx vitest run test/discover.test.js`
Expected: FAIL（模块未定义）。

- [ ] **Step 4: 实现 discover.js**

```js
// src/crawler/discover.js
import { load } from 'cheerio';
import { chromium } from 'playwright';

// 从渲染后的首页 HTML 抽取当前 SALVAGENZ 拍卖。解析不到→抛错（不把"页面变了"当"今天没拍卖"）。
export function parseAuctionsFromHtml(html) {
  const $ = load(html);
  const seen = new Map();
  $('a[href*="/damaged-vehicles/auctions/"]').each((_, a) => {
    const href = $(a).attr('href') || '';
    if (!/franchiseID=SALVAGENZ/i.test(href)) return;
    const code = (href.match(/\/auctions\/([A-Z]{2}[0-9]{6})/) || [])[1];
    if (!code || seen.has(code)) return;
    const name = ($(a).closest('tr,li,div').text() || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    seen.set(code, { code, name, franchise: 'SALVAGENZ' });
  });
  const list = [...seen.values()];
  if (list.length === 0) {
    throw new Error('discover: no SALVAGENZ auctions parsed — homepage structure may have changed');
  }
  return list;
}

async function renderHomepage() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await (await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    })).newPage();
    await page.goto('https://www.manheim.co.nz/', { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForTimeout(3000);
    return await page.content();
  } finally {
    await browser.close();
  }
}

// deps.render 可注入（测试用）；生产走真实渲染。
export async function discoverAuctions(deps = {}) {
  const html = deps.render ? await deps.render() : await renderHomepage();
  return parseAuctionsFromHtml(html);
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd manheim-crawler && npx vitest run test/discover.test.js`
Expected: PASS（2 tests）。

- [ ] **Step 6: Commit**

```bash
git add manheim-crawler/src/crawler/discover.js manheim-crawler/test/discover.test.js manheim-crawler/test/fixtures/homepage-rendered.html manheim-crawler/test/fixtures/homepage-broken.html
git commit -m "feat(crawler): 首页发现当前 SALVAGENZ 拍卖(结构损坏则抛错)"
```

---

### Task 4: 重写 mysql-sync.js（SELECT-先查 + 全字段 + item_id + 图片）

**Files:**
- Modify (rewrite): `manheim-crawler/src/store/mysql-sync.js`
- Modify: `manheim-crawler/test/mysql-sync.test.js`（替换旧断言）

> 现有 `syncRows` 是 `INSERT ... ON DUPLICATE KEY UPDATE`（生产无唯一键→会重复插入），**整体删除重写**。

- [ ] **Step 1: 写失败测试（替换 test/mysql-sync.test.js 内容）**

```js
// test/mysql-sync.test.js
import { describe, it, expect, vi } from 'vitest';
import { openDb, upsertVehicle, insertImages } from '../src/store/db.js';
import { syncRows } from '../src/store/mysql-sync.js';

function fakeConn({ existing = false, insertId = 777 }) {
  const calls = [];
  const execute = vi.fn(async (sql, params) => {
    calls.push({ sql, params });
    if (/^SELECT id FROM car_crawler_manheim WHERE/i.test(sql)) return [existing ? [{ id: 1 }] : []];
    if (/^INSERT INTO car_crawler_manheim \(/i.test(sql)) return [{ insertId }];
    if (/^INSERT INTO car_crawler_manheim_image/i.test(sql)) return [{ insertId: 0 }];
    return [[]];
  });
  return { calls, execute };
}

function seed() {
  const db = openDb(':memory:');
  const { id } = upsertVehicle(db, { uuid: 'ND130726', plan_type: 'Salvage', vin: 'VIN1', registration: 'R1', make: 'Toyota', item_id: 'IT1', source_url: 'u', fetch_mode: 'curl' });
  insertImages(db, id, 'ND130726', [{ url: 'http://a/1.jpg', s3_url: null }]);
  return db;
}

describe('syncRows (SELECT-先查-不存在才插)', () => {
  it('inserts new car + image with the MySQL insertId as manheim_id', async () => {
    const db = seed();
    const conn = fakeConn({ existing: false, insertId: 777 });
    const r = await syncRows(db, conn);
    expect(r).toEqual({ inserted: 1, skipped: 0 });
    const carInsert = conn.calls.find(c => /^INSERT INTO car_crawler_manheim \(/i.test(c.sql));
    expect(carInsert.sql).toMatch(/item_id/);
    expect(carInsert.sql).toMatch(/'System'/); // create_by/update_by
    const imgInsert = conn.calls.find(c => /image/i.test(c.sql));
    expect(imgInsert.params[1]).toBe(777); // manheim_id = MySQL insertId, NOT sqlite id
    db.close();
  });

  it('skips existing car (no INSERT) and does not update', async () => {
    const db = seed();
    const conn = fakeConn({ existing: true });
    const r = await syncRows(db, conn);
    expect(r).toEqual({ inserted: 0, skipped: 1 });
    expect(conn.calls.some(c => /^INSERT INTO/i.test(c.sql))).toBe(false);
    expect(conn.calls.some(c => /UPDATE/i.test(c.sql))).toBe(false);
    db.close();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd manheim-crawler && npx vitest run test/mysql-sync.test.js`
Expected: FAIL（旧 syncRows 行为不符）。

- [ ] **Step 3: 重写 mysql-sync.js**

```js
// src/store/mysql-sync.js
import mysql from 'mysql2/promise';
import { ensureItemIdColumn } from './mysql-migrate.js';

const COLS = [
  'uuid','plan_type','year','make','body_type','model','colour','variant',
  'doors','seats','odometer','transmission','engine','fuel_type',
  'registration','vin','no_of_keys','seller_type','damage','comment','item_id',
];

// SELECT-先查（vin OR rego OR item_id，命中即跳过）→ 不存在才插车+图片。
// 生产表无唯一键，去重靠这里的应用层查（见 spec §7）。命中即跳过、不 UPDATE（字段冻结在首次入库值）。
export async function syncRows(db, conn) {
  const rows = db.prepare('SELECT * FROM manheim').all();
  let inserted = 0, skipped = 0;
  for (const row of rows) {
    const [ex] = await conn.execute(
      `SELECT id FROM car_crawler_manheim
       WHERE vin = ? OR registration = ? OR (item_id IS NOT NULL AND item_id = ?) LIMIT 1`,
      [row.vin, row.registration, row.item_id]
    );
    if (ex.length) { skipped++; continue; }

    const cols = COLS.filter((c) => row[c] != null);
    const sql = `INSERT INTO car_crawler_manheim (${cols.join(',')},create_by,update_by,create_time,update_time)
                 VALUES (${cols.map(() => '?').join(',')},'System','System',NOW(),NOW())`;
    const [ins] = await conn.execute(sql, cols.map((c) => row[c]));
    const carId = ins.insertId; // MySQL 自增 id —— 图片外键必须用它，不是 SQLite id

    const allImgs = db.prepare('SELECT url FROM manheim_image WHERE manheim_id = ? AND url IS NOT NULL').all(row.id);
    const imgs = allImgs.filter((im) => im.url.length <= 255); // MySQL url 列 varchar(255)
    if (imgs.length !== allImgs.length) {
      console.warn(`[sync] ${row.vin || row.item_id}: 丢弃 ${allImgs.length - imgs.length} 条 >255 字符的图片 URL（MySQL 列上限）`);
    }
    for (const im of imgs) {
      await conn.execute(
        `INSERT INTO car_crawler_manheim_image (uuid,manheim_id,url,create_by,update_by,create_time,update_time)
         VALUES (?,?,?,?,?,NOW(),NOW())`,
        [row.uuid, carId, im.url, 'System', 'System']
      );
    }
    inserted++;
  }
  return { inserted, skipped };
}

export async function syncToMysql(db, cfg) {
  if (!cfg.mysql.enabled) return { inserted: 0, skipped: 0, disabled: true };
  const conn = await mysql.createConnection({
    host: cfg.mysql.host, port: cfg.mysql.port, user: cfg.mysql.user,
    password: cfg.mysql.password, database: cfg.mysql.database,
  });
  try {
    await ensureItemIdColumn(conn, { dbName: cfg.mysql.database }); // 幂等，确保 item_id 列在
    return await syncRows(db, conn);
  } finally {
    await conn.end();
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd manheim-crawler && npx vitest run test/mysql-sync.test.js`
Expected: PASS（2 tests）。

- [ ] **Step 5: Commit**

```bash
git add manheim-crawler/src/store/mysql-sync.js manheim-crawler/test/mysql-sync.test.js
git commit -m "feat(crawler): 重写 mysql-sync 为 SELECT-先查+全字段+item_id+图片(跨库id映射)"
```

---

## Chunk 3: 编排 + 定时 + 端到端

### Task 5: sync-all.js（发现→逐场爬→写回→汇总）

**Files:**
- Create: `manheim-crawler/src/sync-all.js`
- Test: 无独立单测（编排层）；靠 Task 7 端到端。

- [ ] **Step 1: 实现 sync-all.js**

```js
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
  console.log(`[discover] ${auctions.length} SALVAGENZ auctions: ${auctions.map(a => a.code).join(', ')}`);

  const reports = [];
  for (const a of auctions) {
    try {
      // 每场 run() 只填 SQLite，禁用其内置写库（否则会每场各写一次 MySQL + 末尾再写一次，
      // 且重复跑迁移/逐行 SELECT）。写回统一由本函数末尾做一次。
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
  runAll().then((r) => process.exit(r.reports.every(x => !x.error) ? 0 : 1));
}
```

- [ ] **Step 2: 冒烟（不写库，仅抓取跑通）**

Run: `cd manheim-crawler && PLAYWRIGHT_BROWSERS_PATH=0 MYSQL_SYNC=false node src/sync-all.js 2>&1 | grep -iE "discover|crawl|done"`
Expected: 打印发现的拍卖列表、每场 reconcile、`[done] ... synced=0`；不崩。

- [ ] **Step 3: Commit**

```bash
git add manheim-crawler/src/sync-all.js
git commit -m "feat(crawler): sync-all 编排(发现→逐场爬→写回→汇总)"
```

---

### Task 6: cron-sync.sh + 本地定时配置

**Files:**
- Create: `manheim-crawler/scripts/cron-sync.sh`
- Create: `manheim-crawler/scripts/README-cron.md`

- [ ] **Step 1: 写 cron-sync.sh**

```bash
#!/usr/bin/env bash
# 本地定时入口：加载 .env、渲染发现、抓取、写回 MySQL。日志追加到 scripts/cron.log。
set -euo pipefail
cd "$(dirname "$0")/.."            # → manheim-crawler/
set -a; [ -f .env ] && . ./.env; set +a
export PLAYWRIGHT_BROWSERS_PATH=0
export MYSQL_SYNC=true
echo "=== $(date '+%F %T') sync-all start ===" >> scripts/cron.log
node src/sync-all.js >> scripts/cron.log 2>&1
echo "=== $(date '+%F %T') sync-all end (exit $?) ===" >> scripts/cron.log
```
`chmod +x scripts/cron-sync.sh`。

- [ ] **Step 2: 写 README-cron.md（安装说明）**

内容：
- `.env` 需含 `MYSQL_HOST/MYSQL_PORT/MYSQL_USER/MYSQL_PASSWORD/MYSQL_DATABASE`（与 config.js 一致；gitignore 已含 `.env`）。可选 `MYSQL_SYNC=true`（脚本内也会设）。
- 安装 crontab（每天 09:00 本地跑一次，避开 Java 的凌晨窗口）：
  ```
  crontab -l 2>/dev/null | grep -v cron-sync.sh; echo "0 9 * * * /Users/ying/Documents/Sunny/manheim-crawler/scripts/cron-sync.sh"
  ```
  用 `crontab -e` 粘贴，或 `(crontab -l 2>/dev/null; echo "0 9 * * * <abs-path>/scripts/cron-sync.sh") | crontab -`。
- 与 Java 共存：两者都按 vin/rego 去重跳过，不会重复插。
- 停用：`crontab -e` 删除该行。

- [ ] **Step 3: 本地手动验证脚本可跑（不装 cron）**

Run: `cd manheim-crawler && MYSQL_SYNC=false bash scripts/cron-sync.sh; tail -5 scripts/cron.log`
Expected: cron.log 有 start/end 记录，sync-all 跑通（此处 MYSQL_SYNC=false 覆盖脚本内 true 仅为验证不写库；真实定时用脚本默认 true）。

> 注：`scripts/cron.log` 加入 .gitignore（已有 `*.log`）。

- [ ] **Step 4: Commit**

```bash
git add manheim-crawler/scripts/cron-sync.sh manheim-crawler/scripts/README-cron.md
git commit -m "feat(crawler): 本地定时 cron 包装脚本 + 安装说明"
```

---

### Task 7: 端到端（迁移已执行后，真实写回一次）

**Files:**
- Create: `manheim-crawler/scripts/autosync-verify-<date>.md`（验证记录，日期落地时填）

> 前置：Task 1b 已对生产库加好 item_id 列。

- [ ] **Step 1: 记录写回前基线**

Run（`.env` 提供 DB 凭证）：查 `SELECT COUNT(*) FROM car_crawler_manheim`，记为 before。

- [ ] **Step 2: 真实跑一次 sync-all（开写回）**

Run: `cd manheim-crawler && PLAYWRIGHT_BROWSERS_PATH=0 MYSQL_SYNC=true node src/sync-all.js 2>&1 | tee scripts/autosync-run.log | grep -iE "discover|crawl|sync|done"`
Expected: `[sync] inserted=N skipped=M`，N = 当前缺口数、M = 已存在数。

- [ ] **Step 3: 验证幂等 + 无重复**

再跑一次：`... node src/sync-all.js | grep sync`
Expected: 第二次 `inserted=0`（全 skipped）——证明幂等、不重复插。
再查 `SELECT COUNT(*) FROM car_crawler_manheim` = before + N（只多了第一次的 N）。

- [ ] **Step 4: 抽查无 key 车已入库**

Run: 查 `SELECT vin,registration,item_id,make,model FROM car_crawler_manheim WHERE item_id IS NOT NULL LIMIT 10`
Expected: 出现摩托/ATV 等（vin/rego 空、item_id 有值）。

- [ ] **Step 5: 写验证记录 + Commit**

```bash
git add manheim-crawler/scripts/autosync-verify-<date>.md
git commit -m "test(crawler): 自动写回端到端验证(inserted=缺口, 幂等无重复)"
```

---

## 完成标准（Definition of Done）

- 全套单测通过（`npm test`）。
- 生产库已加 `item_id` 列（幂等、有执行记录、附回滚命令）。
- `sync-all` 能自动发现当前所有 SALVAGENZ 拍卖并抓全（各场 reconcile missing=0）。
- 真实写回一次：inserted=当前缺口；再跑 inserted=0（幂等、无重复行）。
- 无 vin/rego 车经 item_id 进库。
- 本地 cron 脚本就绪、有安装说明；与 Java 共存不冲突。
