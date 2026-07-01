# Manheim NZ 车源爬虫（Node.js / Crawlee）Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 Node.js + Crawlee 重写 Manheim NZ 车源爬虫，根治"二次跳转导致的随机漏车"，把数据落 SQLite 并对账不漏，图片上传 S3，预留 MySQL 写回。

**Architecture:** `CheerioCrawler` 走快路径抓静态 HTML，关键字段缺失或检测到跳转时对单条无缝降级到 Playwright；数据经 vin/rego 去重后 upsert 进 SQLite；抓完做"列表声明 vs 入库"对账，漏车可见可报警。各模块单一职责、可独立测试。

**Tech Stack:** Node.js 22 (ESM) · Crawlee 3 (`CheerioCrawler` + got-scraping) · Playwright (chromium) · better-sqlite3 · @aws-sdk/client-s3 · dotenv · vitest（测试）

**Spec:** `docs/superpowers/specs/2026-07-02-manheim-crawler-rewrite-design.md`

---

## File Structure

所有新代码在仓库根的 `manheim-crawler/` 子目录：

```
manheim-crawler/
  package.json           # ESM, scripts, deps
  vitest.config.js       # 测试配置
  .env.example           # 配置样例（不含真实凭证）
  .gitignore             # node_modules, data/, .env, storage/
  README.md              # 运行说明
  src/
    config.js            # 集中配置（读 .env）
    crawler/
      selectors.js       # 【recon 产出】所有 DOM 选择器与跳转判定，集中一处
      listing.js         # 列表页：构造分页 URL + 解析出详情 URL 列表
      detail.js          # 详情页：HTML→车辆对象+图片URL+needsFallback
      fields.js          # 标签→字段映射（对应原 convertInfoFromWeb）
      fallback.js        # Playwright 补抓单条 HTML
      main.js            # 编排：Crawlee router + 入队 + 降级 + 入库 + 对账
    store/
      db.js              # SQLite：建表 + vin/rego 去重 upsert + 图片/失败记录
      mysql-sync.js      # 【预留、可开关】写回 MySQL 两表
    media/
      s3.js              # 下载图片→上传 S3，返回 URL（可开关）
    reconcile.js         # 列表声明集合 vs 入库集合 对账，产漏车报告
  test/
    fixtures/            # recon 抓的真实 HTML 快照
    *.test.js
  data/                  # SQLite 文件（gitignore）
```

---

## Chunk 1: 脚手架与存储层

### Task 1: 项目脚手架

**Files:**
- Create: `manheim-crawler/package.json`
- Create: `manheim-crawler/vitest.config.js`
- Create: `manheim-crawler/.gitignore`
- Create: `manheim-crawler/.env.example`
- Create: `manheim-crawler/README.md`
- Create: `manheim-crawler/test/smoke.test.js`

- [ ] **Step 1: 创建 package.json**

```json
{
  "name": "manheim-crawler",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "crawl": "node src/crawler/main.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@aws-sdk/client-s3": "^3.658.0",
    "better-sqlite3": "^11.3.0",
    "crawlee": "^3.11.5",
    "dotenv": "^16.4.5",
    "playwright": "^1.47.2"
  },
  "devDependencies": {
    "vitest": "^2.1.2"
  }
}
```

- [ ] **Step 2: 创建 vitest.config.js**

```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.js'],
    testTimeout: 20000,
  },
});
```

- [ ] **Step 3: 创建 .gitignore**

```
node_modules/
data/
storage/
.env
*.log
```

- [ ] **Step 4: 创建 .env.example**

```
# 目标拍卖
AUCTION_ID=ND060726
FRANCHISE_ID=SALVAGENZ

# 抓取节流（抗封）
MAX_CONCURRENCY=4
MIN_DELAY_MS=500
MAX_RETRIES=5

# 存储
DB_PATH=./data/manheim.sqlite

# 可选代理（本地默认关，留空即不用）
PROXY_URL=

# S3（可开关；ENABLED=false 时跳过图片上传但不阻断数据抓取）
S3_ENABLED=false
S3_BUCKET=
S3_REGION=
S3_PREFIX=manheim/
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=

# MySQL 写回（预留，默认关）
MYSQL_SYNC=false
MYSQL_HOST=
MYSQL_PORT=3306
MYSQL_USER=
MYSQL_PASSWORD=
MYSQL_DATABASE=
```

- [ ] **Step 5: 创建 README.md**

```md
# Manheim NZ 车源爬虫

Node.js + Crawlee 重写版。复制 `.env.example` 为 `.env` 后：

    npm install
    npx playwright install chromium
    npm run crawl     # 抓取
    npm test          # 单测

数据落 `data/manheim.sqlite`。详见 `docs/superpowers/specs/2026-07-02-manheim-crawler-rewrite-design.md`。
```

- [ ] **Step 6: 创建占位冒烟测试 test/smoke.test.js**

```js
import { describe, it, expect } from 'vitest';

describe('smoke', () => {
  it('toolchain works', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 7: 安装依赖并跑测试**

Run: `cd manheim-crawler && npm install && npx playwright install chromium && npm test`
Expected: vitest 输出 `1 passed`（smoke 通过）。若 better-sqlite3 需编译，npm install 会自动编译；失败则先 `npm rebuild better-sqlite3`。

- [ ] **Step 8: Commit**

```bash
git add manheim-crawler/package.json manheim-crawler/vitest.config.js manheim-crawler/.gitignore manheim-crawler/.env.example manheim-crawler/README.md manheim-crawler/test/smoke.test.js manheim-crawler/package-lock.json
git commit -m "chore(crawler): 脚手架 + 依赖 + vitest 冒烟测试"
```

---

### Task 2: 配置模块 config.js

**Files:**
- Create: `manheim-crawler/src/config.js`
- Test: `manheim-crawler/test/config.test.js`

- [ ] **Step 1: 写失败测试**

```js
// test/config.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('applies defaults when env is empty', () => {
    const c = loadConfig({});
    expect(c.auctionId).toBe('ND060726');
    expect(c.franchiseId).toBe('SALVAGENZ');
    expect(c.maxConcurrency).toBe(4);
    expect(c.s3.enabled).toBe(false);
    expect(c.mysql.enabled).toBe(false);
  });

  it('reads overrides and coerces numbers/booleans', () => {
    const c = loadConfig({
      AUCTION_ID: 'ND999999',
      MAX_CONCURRENCY: '8',
      S3_ENABLED: 'true',
      S3_BUCKET: 'my-bucket',
    });
    expect(c.auctionId).toBe('ND999999');
    expect(c.maxConcurrency).toBe(8);
    expect(c.s3.enabled).toBe(true);
    expect(c.s3.bucket).toBe('my-bucket');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd manheim-crawler && npx vitest run test/config.test.js`
Expected: FAIL（`loadConfig` 未定义）。

- [ ] **Step 3: 实现 config.js**

```js
// src/config.js
import 'dotenv/config';

const num = (v, d) => (v === undefined || v === '' ? d : Number(v));
const bool = (v) => v === 'true';

// loadConfig 接受 env 对象（默认 process.env），便于测试注入
export function loadConfig(env = process.env) {
  return {
    baseUrl: 'https://www.manheim.co.nz',
    auctionId: env.AUCTION_ID || 'ND060726',
    franchiseId: env.FRANCHISE_ID || 'SALVAGENZ',
    maxConcurrency: num(env.MAX_CONCURRENCY, 4),
    minDelayMs: num(env.MIN_DELAY_MS, 500),
    maxRequestRetries: num(env.MAX_RETRIES, 5),
    dbPath: env.DB_PATH || './data/manheim.sqlite',
    proxyUrl: env.PROXY_URL || undefined,
    s3: {
      enabled: bool(env.S3_ENABLED),
      bucket: env.S3_BUCKET || '',
      region: env.S3_REGION || '',
      prefix: env.S3_PREFIX || 'manheim/',
      accessKeyId: env.AWS_ACCESS_KEY_ID || '',
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY || '',
    },
    mysql: {
      enabled: bool(env.MYSQL_SYNC),
      host: env.MYSQL_HOST || '',
      port: num(env.MYSQL_PORT, 3306),
      user: env.MYSQL_USER || '',
      password: env.MYSQL_PASSWORD || '',
      database: env.MYSQL_DATABASE || '',
    },
  };
}

export const config = loadConfig();
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd manheim-crawler && npx vitest run test/config.test.js`
Expected: PASS（2 tests）。

- [ ] **Step 5: Commit**

```bash
git add manheim-crawler/src/config.js manheim-crawler/test/config.test.js
git commit -m "feat(crawler): 集中配置模块 + 测试"
```

---

### Task 3: SQLite 建表 db.js（openDb）

**Files:**
- Create: `manheim-crawler/src/store/db.js`
- Test: `manheim-crawler/test/db.schema.test.js`

- [ ] **Step 1: 写失败测试（内存库建表）**

```js
// test/db.schema.test.js
import { describe, it, expect } from 'vitest';
import { openDb } from '../src/store/db.js';

describe('openDb', () => {
  it('creates the three tables', () => {
    const db = openDb(':memory:');
    const names = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => r.name);
    expect(names).toContain('manheim');
    expect(names).toContain('manheim_image');
    expect(names).toContain('failed_requests');
    db.close();
  });

  it('manheim table has vin and registration columns', () => {
    const db = openDb(':memory:');
    const cols = db.prepare('PRAGMA table_info(manheim)').all().map((c) => c.name);
    expect(cols).toContain('vin');
    expect(cols).toContain('registration');
    expect(cols).toContain('last_seen');
    expect(cols).toContain('fetch_mode');
    db.close();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd manheim-crawler && npx vitest run test/db.schema.test.js`
Expected: FAIL（`openDb` 未定义）。

- [ ] **Step 3: 实现 openDb + 建表**

```js
// src/store/db.js
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS manheim (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid TEXT,
  plan_type TEXT,
  year TEXT, make TEXT, model TEXT, body_type TEXT, colour TEXT, variant TEXT,
  doors TEXT, seats TEXT, odometer TEXT, transmission TEXT, engine TEXT,
  fuel_type TEXT, registration TEXT, vin TEXT, no_of_keys TEXT, seller_type TEXT,
  comment TEXT, damage TEXT,
  source_url TEXT,
  fetch_mode TEXT,
  first_seen TEXT DEFAULT (datetime('now')),
  last_seen  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_manheim_vin ON manheim(vin);
CREATE INDEX IF NOT EXISTS idx_manheim_rego ON manheim(registration);

CREATE TABLE IF NOT EXISTS manheim_image (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manheim_id INTEGER,
  uuid TEXT,
  url TEXT,
  s3_url TEXT
);
CREATE INDEX IF NOT EXISTS idx_image_manheim ON manheim_image(manheim_id);

CREATE TABLE IF NOT EXISTS failed_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT,
  kind TEXT,
  error TEXT,
  attempts INTEGER,
  ts TEXT DEFAULT (datetime('now'))
);
`;

export function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
  return db;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd manheim-crawler && npx vitest run test/db.schema.test.js`
Expected: PASS（2 tests）。

- [ ] **Step 5: Commit**

```bash
git add manheim-crawler/src/store/db.js manheim-crawler/test/db.schema.test.js
git commit -m "feat(crawler): SQLite 建表（manheim/image/failed）"
```

---

### Task 4: db.js 去重 upsert（upsertVehicle）

**Files:**
- Modify: `manheim-crawler/src/store/db.js`
- Test: `manheim-crawler/test/db.upsert.test.js`

去重规则（对齐 spec 6 节）：vin 非空优先按 vin 匹配；vin 空再按 registration 匹配；命中则 update（刷新 last_seen 与传入的非空字段），未命中则 insert。both 都在但与既有行冲突时以 vin 命中的行为准更新，并写一条 `failed_requests(kind='field_conflict')` 告警。

- [ ] **Step 1: 写失败测试**

```js
// test/db.upsert.test.js
import { describe, it, expect } from 'vitest';
import { openDb, upsertVehicle } from '../src/store/db.js';

const car = (o) => ({
  vin: null, registration: null, make: 'Toyota', model: 'Corolla',
  source_url: 'u', fetch_mode: 'cheerio', ...o,
});

describe('upsertVehicle', () => {
  it('inserts a new vehicle and returns isNew=true', () => {
    const db = openDb(':memory:');
    const r = upsertVehicle(db, car({ vin: 'VIN1' }));
    expect(r.isNew).toBe(true);
    expect(typeof r.id).toBe('number');
    db.close();
  });

  it('matches existing by vin and updates (no duplicate row)', () => {
    const db = openDb(':memory:');
    upsertVehicle(db, car({ vin: 'VIN1', odometer: '100' }));
    const r2 = upsertVehicle(db, car({ vin: 'VIN1', odometer: '200' }));
    expect(r2.isNew).toBe(false);
    const count = db.prepare("SELECT COUNT(*) n FROM manheim WHERE vin='VIN1'").get().n;
    expect(count).toBe(1);
    const row = db.prepare("SELECT odometer FROM manheim WHERE vin='VIN1'").get();
    expect(row.odometer).toBe('200'); // 已更新
    db.close();
  });

  it('falls back to registration when vin is null', () => {
    const db = openDb(':memory:');
    upsertVehicle(db, car({ vin: null, registration: 'ABC123' }));
    const r2 = upsertVehicle(db, car({ vin: null, registration: 'ABC123' }));
    expect(r2.isNew).toBe(false);
    const count = db.prepare("SELECT COUNT(*) n FROM manheim WHERE registration='ABC123'").get().n;
    expect(count).toBe(1);
    db.close();
  });

  it('logs field_conflict when both keys present but map to different vin', () => {
    const db = openDb(':memory:');
    upsertVehicle(db, car({ vin: 'VINX', registration: 'REGX' }));
    // 新记录 rego 相同但 vin 不同 → 以 vin 为准新增，并告警
    upsertVehicle(db, car({ vin: 'VINY', registration: 'REGX' }));
    const conflicts = db.prepare("SELECT COUNT(*) n FROM failed_requests WHERE kind='field_conflict'").get().n;
    expect(conflicts).toBeGreaterThanOrEqual(1);
    db.close();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd manheim-crawler && npx vitest run test/db.upsert.test.js`
Expected: FAIL（`upsertVehicle` 未定义）。

- [ ] **Step 3: 实现 upsertVehicle（追加到 db.js）**

```js
// src/store/db.js 追加
const COLS = [
  'uuid','plan_type','year','make','model','body_type','colour','variant',
  'doors','seats','odometer','transmission','engine','fuel_type',
  'registration','vin','no_of_keys','seller_type','comment','damage',
  'source_url','fetch_mode',
];

function findExisting(db, v) {
  if (v.vin) {
    const byVin = db.prepare('SELECT * FROM manheim WHERE vin = ?').get(v.vin);
    if (byVin) return byVin;
  }
  if (v.registration) {
    const byRego = db.prepare('SELECT * FROM manheim WHERE registration = ?').get(v.registration);
    if (byRego) {
      // both present but existing row's vin differs from incoming vin → conflict
      if (v.vin && byRego.vin && byRego.vin !== v.vin) return null;
      return byRego;
    }
  }
  return null;
}

export function upsertVehicle(db, v) {
  const existing = findExisting(db, v);

  // 冲突检测：incoming 有 vin，且按 rego 找到一行但 vin 不同（existing 为 null 表示走新增）
  if (v.vin && v.registration) {
    const byRego = db.prepare('SELECT vin FROM manheim WHERE registration = ?').get(v.registration);
    if (byRego && byRego.vin && byRego.vin !== v.vin) {
      recordFailed(db, {
        url: v.source_url, kind: 'field_conflict',
        error: `rego ${v.registration} maps to vin ${byRego.vin} but incoming vin ${v.vin}`,
        attempts: 0,
      });
    }
  }

  if (existing) {
    const sets = COLS.filter((c) => v[c] !== undefined && v[c] !== null)
      .map((c) => `${c} = @${c}`)
      .concat("last_seen = datetime('now')");
    db.prepare(`UPDATE manheim SET ${sets.join(', ')} WHERE id = @id`)
      .run({ ...v, id: existing.id });
    return { id: existing.id, isNew: false };
  }

  const insertCols = COLS.filter((c) => v[c] !== undefined);
  const info = db.prepare(
    `INSERT INTO manheim (${insertCols.join(',')}) VALUES (${insertCols.map((c) => '@' + c).join(',')})`
  ).run(v);
  return { id: Number(info.lastInsertRowid), isNew: true };
}

export function recordFailed(db, { url, kind, error, attempts }) {
  db.prepare('INSERT INTO failed_requests (url, kind, error, attempts) VALUES (?,?,?,?)')
    .run(url, kind, error, attempts ?? 0);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd manheim-crawler && npx vitest run test/db.upsert.test.js`
Expected: PASS（4 tests）。

- [ ] **Step 5: Commit**

```bash
git add manheim-crawler/src/store/db.js manheim-crawler/test/db.upsert.test.js
git commit -m "feat(crawler): vin/rego 去重 upsert + 冲突告警"
```

---

### Task 5: db.js 图片入库（insertImages）

**Files:**
- Modify: `manheim-crawler/src/store/db.js`
- Test: `manheim-crawler/test/db.images.test.js`

- [ ] **Step 1: 写失败测试**

```js
// test/db.images.test.js
import { describe, it, expect } from 'vitest';
import { openDb, upsertVehicle, insertImages } from '../src/store/db.js';

describe('insertImages', () => {
  it('inserts images linked to a vehicle', () => {
    const db = openDb(':memory:');
    const { id } = upsertVehicle(db, {
      vin: 'VIN1', registration: null, source_url: 'u', fetch_mode: 'cheerio',
    });
    insertImages(db, id, 'uuid1', [
      { url: 'http://a/1.jpg', s3_url: null },
      { url: 'http://a/2.jpg', s3_url: 's3://x/2.jpg' },
    ]);
    const n = db.prepare('SELECT COUNT(*) n FROM manheim_image WHERE manheim_id=?').get(id).n;
    expect(n).toBe(2);
    db.close();
  });

  it('is idempotent per (manheim_id,url) — re-run does not duplicate', () => {
    const db = openDb(':memory:');
    const { id } = upsertVehicle(db, { vin: 'VIN1', source_url: 'u', fetch_mode: 'cheerio' });
    insertImages(db, id, 'uuid1', [{ url: 'http://a/1.jpg', s3_url: null }]);
    insertImages(db, id, 'uuid1', [{ url: 'http://a/1.jpg', s3_url: 's3://x/1.jpg' }]);
    const n = db.prepare('SELECT COUNT(*) n FROM manheim_image WHERE manheim_id=?').get(id).n;
    expect(n).toBe(1);
    db.close();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd manheim-crawler && npx vitest run test/db.images.test.js`
Expected: FAIL（`insertImages` 未定义）。

- [ ] **Step 3: 实现 insertImages（追加到 db.js；含唯一约束）**

先在 `SCHEMA` 的 `manheim_image` 定义末尾加唯一索引：

```sql
CREATE UNIQUE INDEX IF NOT EXISTS uniq_image ON manheim_image(manheim_id, url);
```

再追加函数：

```js
// src/store/db.js 追加
export function insertImages(db, manheimId, uuid, images) {
  const stmt = db.prepare(
    `INSERT INTO manheim_image (manheim_id, uuid, url, s3_url)
     VALUES (?,?,?,?)
     ON CONFLICT(manheim_id, url) DO UPDATE SET s3_url = COALESCE(excluded.s3_url, s3_url)`
  );
  const tx = db.transaction((rows) => {
    for (const img of rows) stmt.run(manheimId, uuid, img.url, img.s3_url ?? null);
  });
  tx(images);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd manheim-crawler && npx vitest run test/db.images.test.js`
Expected: PASS（2 tests）。

- [ ] **Step 5: Commit**

```bash
git add manheim-crawler/src/store/db.js manheim-crawler/test/db.images.test.js
git commit -m "feat(crawler): 图片入库(幂等 upsert by manheim_id+url)"
```

---

## Chunk 2: Recon 与解析

### Task 6: 真实页面 Recon（必做，不得跳过）

> 这是全计划的地基：所有选择器与"二次跳转"判定都由本任务实证产出。**严禁**用推断选择器写进 `selectors.js` 充数——本任务的验收就是"选择器来自真实 HTML"。

**Files:**
- Create: `manheim-crawler/src/crawler/selectors.js`
- Create: `manheim-crawler/test/fixtures/listing.html`（真实列表页快照）
- Create: `manheim-crawler/test/fixtures/detail.html`（真实详情页快照，选一条"直连成功"的）
- Create: `manheim-crawler/test/fixtures/detail-redirect.html`（真实"二次跳转"壳页快照，若存在）
- Create: `manheim-crawler/docs-recon.md`（recon 记录：DOM 结构、跳转类型结论）

- [ ] **Step 1: 抓真实列表页并存快照**

Run:
```bash
cd manheim-crawler
node -e "import('crawlee').then(async ({ gotScraping }) => {
  const r = await gotScraping({ url: 'https://www.manheim.co.nz/damaged-vehicles/auctions/ND060726/page1?franchiseID=SALVAGENZ' });
  require('fs').writeFileSync('test/fixtures/listing.html', r.body);
  console.log('status', r.statusCode, 'len', r.body.length);
});"
```
Expected: status 200，`listing.html` 有内容。若返回 30x/403，记录到 `docs-recon.md` 并调整（可能需要 Playwright 抓）。

- [ ] **Step 2: 人工/脚本定位列表页 DOM**

用脚本打印候选结构，确认：车辆条目容器选择器、每条的详情链接选择器、分页/总车数信息、以及列表页是否直接暴露 VIN/rego（用于对账"声明集合"）。

Run:
```bash
node -e "import('cheerio').then(({ load }) => {
  const $ = load(require('fs').readFileSync('test/fixtures/listing.html','utf8'));
  // 打印可能的条目容器 class 计数，人工挑选
  const counts = {};
  $('*[class]').each((_,el)=>{const c=$(el).attr('class');counts[c]=(counts[c]||0)+1;});
  console.log(Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,40));
});"
```
> 注：`cheerio` 随 crawlee 传递依赖已安装；若未装单独 `npm i cheerio`。
Expected: 输出高频 class 列表，据此确定 `listItem` 与 `detailLink` 选择器，记入 `docs-recon.md`。

- [ ] **Step 3: 抓一条详情页并判定"二次跳转"类型**

从列表页解析出的第一个详情 URL：先用**不跟随重定向**方式请求，看是否 30x；再用跟随方式请求看最终页是否含 `vehicle-details`。据此判定跳转是 HTTP 302 还是 JS/meta。

Run:
```bash
node -e "import('crawlee').then(async ({ gotScraping }) => {
  const url = process.env.DETAIL_URL; // 从 listing 解析得到，手动传入
  const noFollow = await gotScraping({ url, followRedirect: false, throwHttpErrors: false });
  console.log('no-follow status', noFollow.statusCode, 'location', noFollow.headers.location);
  const follow = await gotScraping({ url, followRedirect: true });
  require('fs').writeFileSync('test/fixtures/detail.html', follow.body);
  console.log('final len', follow.body.length, 'hasVehicleDetails', follow.body.includes('vehicle-details'));
});"
```
Expected: 明确记录——若 no-follow 是 3xx 且带 `location`，则**根因坐实为 HTTP 302**，Crawlee 默认 `followRedirect:true` 即可修复；若 no-follow 是 200 但页面无 `vehicle-details`（内容靠 JS 注入），则为 JS 渲染，需 Playwright 降级。结论写入 `docs-recon.md`。

- [ ] **Step 4: 定稿 selectors.js**

根据 Step 2/3 的真实结构填写（下例为结构骨架，**值必须来自 recon**，不得照抄推断值）：

```js
// src/crawler/selectors.js
// 所有选择器均由 2026-07-02 recon（见 docs-recon.md）从真实 HTML 确认。
export const SELECTORS = {
  listItem: '',          // 列表页每辆车的容器，例：'.vehicle-item'（以 recon 为准）
  detailLink: '',        // 条目内详情链接，例：'.card-header a'
  listDeclaredKey: '',   // 列表条目上可直接读到的 vin/rego（若无则留空，对账退回详情集合）
  pagination: {
    // 判断是否有下一页的依据（选择器或页数解析），以 recon 为准
    nextLink: '',
    totalCountText: '',
  },
  detail: {
    imageContainer: '',  // 例：'#vehicle-image'
    imageAttr: 'data-src',
    detailsBlock: '',    // 例：'.vehicle-details'
    infoBlock: '',       // 例：'.vehicle-info'
    comment: '',         // 例：'.vehicle-comments p'
    damageItem: '',      // 例：'.vehicle-damage .col-xs-6'
    dt: 'dt',
    dd: 'dd',
  },
};

// 判定该详情 HTML 是否需要 Playwright 降级：解析不到关键块即为 true。
export function needsFallback(html) {
  if (!html) return true;
  // 无详情块 + 疑似跳转/空壳 → 降级
  const hasDetails = SELECTORS.detail.detailsBlock && html.includes('vehicle-details');
  const looksRedirect = /<meta[^>]+http-equiv=["']?refresh/i.test(html)
    || /window\.location\s*=/.test(html);
  return !hasDetails || looksRedirect;
}
```

- [ ] **Step 5: 写 recon 记录 docs-recon.md**

内容必须包含：列表页 status、选定的各选择器及其依据、详情"二次跳转"实测结论（HTTP 302 还是 JS）、以及对 spec 中"Hutool 根因"的实证结论（坐实/修正）。

- [ ] **Step 6: Commit**

```bash
git add manheim-crawler/src/crawler/selectors.js manheim-crawler/test/fixtures/ manheim-crawler/docs-recon.md
git commit -m "feat(crawler): recon 定稿选择器 + 跳转类型实证 + 真实HTML fixtures"
```

---

### Task 7: 字段映射 fields.js

**Files:**
- Create: `manheim-crawler/src/crawler/fields.js`
- Test: `manheim-crawler/test/fields.test.js`

- [ ] **Step 1: 写失败测试**

```js
// test/fields.test.js
import { describe, it, expect } from 'vitest';
import { applyPair, FIELD_MAP } from '../src/crawler/fields.js';

describe('fields', () => {
  it('maps known labels (strips trailing colon) to columns', () => {
    const v = {};
    applyPair(v, 'Build Year:', '2015');
    applyPair(v, 'Make', 'Toyota');
    applyPair(v, 'VIN', 'JT123');
    expect(v.year).toBe('2015');
    expect(v.make).toBe('Toyota');
    expect(v.vin).toBe('JT123');
  });

  it('ignores unknown labels', () => {
    const v = {};
    applyPair(v, 'Totally Unknown', 'x');
    expect(v).toEqual({});
  });

  it('FIELD_MAP covers all labels the legacy Java switch handled', () => {
    for (const label of ['Build Year','Make','Body Type','Model','Body Colour',
      'Variant','Doors','Seats','Odometer','Transmission','Engine','Fuel Type',
      'Registration','VIN','No of Keys','Seller Type']) {
      expect(FIELD_MAP[label]).toBeTruthy();
    }
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd manheim-crawler && npx vitest run test/fields.test.js`
Expected: FAIL（模块未定义）。

- [ ] **Step 3: 实现 fields.js（1:1 对齐原 convertInfoFromWeb）**

```js
// src/crawler/fields.js
export const FIELD_MAP = {
  'Build Year': 'year',
  'Make': 'make',
  'Body Type': 'body_type',
  'Model': 'model',
  'Body Colour': 'colour',
  'Variant': 'variant',
  'Doors': 'doors',
  'Seats': 'seats',
  'Odometer': 'odometer',
  'Transmission': 'transmission',
  'Engine': 'engine',
  'Fuel Type': 'fuel_type',
  'Registration': 'registration',
  'VIN': 'vin',
  'No of Keys': 'no_of_keys',
  'Seller Type': 'seller_type',
};

// 去掉 label 中的冒号（对齐 Java 的 StrUtil.removeAny(type, ":")），映射赋值
export function applyPair(vehicle, label, value) {
  const key = String(label).replace(/:/g, '').trim();
  const col = FIELD_MAP[key];
  if (col) vehicle[col] = String(value).trim();
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd manheim-crawler && npx vitest run test/fields.test.js`
Expected: PASS（3 tests）。

- [ ] **Step 5: Commit**

```bash
git add manheim-crawler/src/crawler/fields.js manheim-crawler/test/fields.test.js
git commit -m "feat(crawler): 字段映射(对齐原 convertInfoFromWeb)"
```

---

### Task 8: 详情解析 detail.js

**Files:**
- Create: `manheim-crawler/src/crawler/detail.js`
- Test: `manheim-crawler/test/detail.test.js`（用 Task 6 的真实 fixture）

- [ ] **Step 1: 写失败测试（基于真实 detail.html fixture）**

```js
// test/detail.test.js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { load } from 'cheerio';
import { parseDetail } from '../src/crawler/detail.js';

const html = readFileSync(new URL('./fixtures/detail.html', import.meta.url), 'utf8');

describe('parseDetail', () => {
  it('extracts vin or registration from a real detail page', () => {
    const { vehicle } = parseDetail(load(html), 'http://example/detail');
    // recon 的这条 fixture 至少应含 vin 或 rego 之一
    expect(vehicle.vin || vehicle.registration).toBeTruthy();
    expect(vehicle.source_url).toBe('http://example/detail');
  });

  it('extracts image urls (may be empty but must be an array)', () => {
    const { images } = parseDetail(load(html), 'http://example/detail');
    expect(Array.isArray(images)).toBe(true);
  });
});
```

> 落地时：跑一次 recon fixture，把断言里的期望值改成该条真实车的实际 VIN/rego（避免"能过但没校验真值"）。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd manheim-crawler && npx vitest run test/detail.test.js`
Expected: FAIL（`parseDetail` 未定义）。

- [ ] **Step 3: 实现 parseDetail（逻辑对齐 Java 详情解析，选择器来自 selectors.js）**

```js
// src/crawler/detail.js
import { SELECTORS } from './selectors.js';
import { applyPair } from './fields.js';

const S = SELECTORS.detail;

// 解析一个 <dl> 区块的 dt/dd 成对喂给 applyPair
function applyBlock($, blockSel, vehicle) {
  const block = $(blockSel).first();
  if (!block.length) return;
  const dts = block.find(S.dt);
  const dds = block.find(S.dd);
  dts.each((i, dt) => {
    const label = $(dt).text();
    const value = $(dds.get(i)).text();
    applyPair(vehicle, label, value);
  });
}

export function parseDetail($, sourceUrl) {
  const vehicle = { source_url: sourceUrl, fetch_mode: 'cheerio' };

  applyBlock($, S.detailsBlock, vehicle);
  applyBlock($, S.infoBlock, vehicle);

  // comment
  if (S.comment) {
    const c = $(S.comment).first().text().trim();
    if (c) vehicle.comment = c;
  }

  // damage：逗号拼接（对齐 Java StrUtil.join）
  if (S.damageItem) {
    const parts = $(S.damageItem).map((_, el) => $(el).text().trim()).get().filter(Boolean);
    if (parts.length) vehicle.damage = parts.join(',');
  }

  // images：读 imageAttr（默认 data-src）
  const images = [];
  if (S.imageContainer) {
    $(`${S.imageContainer} img`).each((_, img) => {
      const url = $(img).attr(S.imageAttr) || $(img).attr('src');
      if (url) images.push({ url, s3_url: null });
    });
  }

  return { vehicle, images };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd manheim-crawler && npx vitest run test/detail.test.js`
Expected: PASS（2 tests）。

- [ ] **Step 5: Commit**

```bash
git add manheim-crawler/src/crawler/detail.js manheim-crawler/test/detail.test.js
git commit -m "feat(crawler): 详情页解析(字段/图片/损伤/备注)"
```

---

### Task 9: 列表解析与分页 listing.js

**Files:**
- Create: `manheim-crawler/src/crawler/listing.js`
- Test: `manheim-crawler/test/listing.test.js`（用真实 listing.html fixture）

- [ ] **Step 1: 写失败测试**

```js
// test/listing.test.js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { load } from 'cheerio';
import { buildListingUrl, parseListing } from '../src/crawler/listing.js';

const html = readFileSync(new URL('./fixtures/listing.html', import.meta.url), 'utf8');

describe('listing', () => {
  it('builds a paged listing url', () => {
    const url = buildListingUrl({
      baseUrl: 'https://www.manheim.co.nz', auctionId: 'ND060726', franchiseId: 'SALVAGENZ',
    }, 2);
    expect(url).toBe('https://www.manheim.co.nz/damaged-vehicles/auctions/ND060726/page2?franchiseID=SALVAGENZ');
  });

  it('parses detail urls from a real listing page (non-empty)', () => {
    const { detailUrls } = parseListing(load(html), 'https://www.manheim.co.nz');
    expect(detailUrls.length).toBeGreaterThan(0);
    expect(detailUrls[0]).toMatch(/^https?:\/\//);
  });

  it('reports whether there is a next page', () => {
    const { hasNext } = parseListing(load(html), 'https://www.manheim.co.nz');
    expect(typeof hasNext).toBe('boolean');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd manheim-crawler && npx vitest run test/listing.test.js`
Expected: FAIL（模块未定义）。

- [ ] **Step 3: 实现 listing.js（选择器来自 selectors.js）**

```js
// src/crawler/listing.js
import { SELECTORS } from './selectors.js';

export function buildListingUrl(cfg, page) {
  return `${cfg.baseUrl}/damaged-vehicles/auctions/${cfg.auctionId}/page${page}?franchiseID=${cfg.franchiseId}`;
}

// 相对链接补全为绝对
function abs(baseUrl, href) {
  if (!href) return null;
  return href.startsWith('http') ? href : `${baseUrl}${href.startsWith('/') ? '' : '/'}${href}`;
}

export function parseListing($, baseUrl) {
  const detailUrls = [];
  const declaredKeys = [];
  $(SELECTORS.listItem).each((_, item) => {
    const href = $(item).find(SELECTORS.detailLink).first().attr('href');
    const url = abs(baseUrl, href);
    if (url) detailUrls.push(url);
    if (SELECTORS.listDeclaredKey) {
      const k = $(item).find(SELECTORS.listDeclaredKey).first().text().trim();
      if (k) declaredKeys.push(k);
    }
  });

  const hasNext = SELECTORS.pagination.nextLink
    ? $(SELECTORS.pagination.nextLink).length > 0
    : false;

  return { detailUrls, declaredKeys, hasNext };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd manheim-crawler && npx vitest run test/listing.test.js`
Expected: PASS（3 tests）。

- [ ] **Step 5: Commit**

```bash
git add manheim-crawler/src/crawler/listing.js manheim-crawler/test/listing.test.js
git commit -m "feat(crawler): 列表页解析 + 分页 URL 构造"
```

---

## Chunk 3: 降级、图片、对账、编排

### Task 10: Playwright 降级 fallback.js

**Files:**
- Create: `manheim-crawler/src/crawler/fallback.js`
- Test: `manheim-crawler/test/fallback.test.js`

fallback 用 Playwright 抓单条详情 HTML（复用一个共享浏览器实例，抓完可关闭）。测试用 `data:` URL 或本地 fixture 文件路径验证"能取到渲染后的 HTML"，避免依赖外网。

- [ ] **Step 1: 写失败测试（用 file:// 加载本地 fixture，验证能返回 HTML）**

```js
// test/fallback.test.js
import { describe, it, expect, afterAll } from 'vitest';
import { pathToFileURL } from 'node:url';
import { fetchRenderedHtml, closeBrowser } from '../src/crawler/fallback.js';

afterAll(async () => { await closeBrowser(); });

describe('fallback', () => {
  it('returns rendered html for a page', async () => {
    const fileUrl = pathToFileURL(new URL('./fixtures/detail.html', import.meta.url).pathname).href;
    const html = await fetchRenderedHtml(fileUrl);
    expect(typeof html).toBe('string');
    expect(html.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd manheim-crawler && npx vitest run test/fallback.test.js`
Expected: FAIL（模块未定义）。

- [ ] **Step 3: 实现 fallback.js（共享 chromium）**

```js
// src/crawler/fallback.js
import { chromium } from 'playwright';

let browserPromise = null;

function getBrowser() {
  if (!browserPromise) browserPromise = chromium.launch({ headless: true });
  return browserPromise;
}

export async function fetchRenderedHtml(url, { waitSelector } = {}) {
  const browser = await getBrowser();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (waitSelector) await page.waitForSelector(waitSelector, { timeout: 10000 }).catch(() => {});
    return await page.content();
  } finally {
    await ctx.close();
  }
}

export async function closeBrowser() {
  if (browserPromise) {
    const b = await browserPromise;
    await b.close();
    browserPromise = null;
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd manheim-crawler && npx vitest run test/fallback.test.js`
Expected: PASS（1 test）。

- [ ] **Step 5: Commit**

```bash
git add manheim-crawler/src/crawler/fallback.js manheim-crawler/test/fallback.test.js
git commit -m "feat(crawler): Playwright 单条降级补抓"
```

---

### Task 11: 图片下载上传 s3.js

**Files:**
- Create: `manheim-crawler/src/media/s3.js`
- Test: `manheim-crawler/test/s3.test.js`

`uploadImages(images, cfg, deps)` 注入 `fetchFn`（下载）与 `s3Client`（上传），便于纯 mock 测试，不打真实网络/S3。`cfg.s3.enabled=false` 时直接原样返回（`s3_url` 保持 null），不阻断。

- [ ] **Step 1: 写失败测试（全 mock）**

```js
// test/s3.test.js
import { describe, it, expect, vi } from 'vitest';
import { uploadImages } from '../src/media/s3.js';

const cfgOn = { s3: { enabled: true, bucket: 'b', region: 'r', prefix: 'manheim/' } };
const cfgOff = { s3: { enabled: false } };

describe('uploadImages', () => {
  it('skips upload and keeps s3_url null when disabled', async () => {
    const out = await uploadImages([{ url: 'http://a/1.jpg', s3_url: null }], cfgOff, {});
    expect(out[0].s3_url).toBe(null);
  });

  it('downloads and uploads each image when enabled', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(8), headers: new Map([['content-type', 'image/jpeg']]) });
    const send = vi.fn().mockResolvedValue({});
    const out = await uploadImages(
      [{ url: 'http://a/1.jpg', s3_url: null }],
      cfgOn,
      { fetchFn, s3Client: { send } }
    );
    expect(fetchFn).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledOnce();
    expect(out[0].s3_url).toContain('manheim/');
  });

  it('does not throw and keeps null when a download fails', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('net'));
    const out = await uploadImages([{ url: 'http://a/1.jpg', s3_url: null }], cfgOn, { fetchFn, s3Client: { send: vi.fn() } });
    expect(out[0].s3_url).toBe(null);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd manheim-crawler && npx vitest run test/s3.test.js`
Expected: FAIL（模块未定义）。

- [ ] **Step 3: 实现 s3.js**

```js
// src/media/s3.js
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';

export function makeS3Client(cfg) {
  return new S3Client({
    region: cfg.s3.region,
    credentials: cfg.s3.accessKeyId
      ? { accessKeyId: cfg.s3.accessKeyId, secretAccessKey: cfg.s3.secretAccessKey }
      : undefined,
  });
}

function keyFor(cfg, url, contentType) {
  const ext = (contentType && contentType.includes('png')) ? 'png' : 'jpg';
  const hash = createHash('sha1').update(url).digest('hex').slice(0, 16);
  return `${cfg.s3.prefix}${hash}.${ext}`;
}

// deps 可注入 fetchFn / s3Client（测试用）；生产默认全局 fetch + 真实客户端
export async function uploadImages(images, cfg, deps = {}) {
  if (!cfg.s3?.enabled) return images;
  const fetchFn = deps.fetchFn || globalThis.fetch;
  const s3 = deps.s3Client || makeS3Client(cfg);

  const out = [];
  for (const img of images) {
    let s3_url = img.s3_url;
    try {
      const res = await fetchFn(img.url);
      const ok = res.ok ?? true;
      if (!ok) throw new Error(`download ${res.status}`);
      const ct = (res.headers?.get ? res.headers.get('content-type') : '') || 'image/jpeg';
      const buf = Buffer.from(await res.arrayBuffer());
      const key = keyFor(cfg, img.url, ct);
      await s3.send(new PutObjectCommand({ Bucket: cfg.s3.bucket, Key: key, Body: buf, ContentType: ct }));
      s3_url = `https://${cfg.s3.bucket}.s3.${cfg.s3.region}.amazonaws.com/${key}`;
    } catch (e) {
      s3_url = null; // 不阻断入库
    }
    out.push({ ...img, s3_url });
  }
  return out;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd manheim-crawler && npx vitest run test/s3.test.js`
Expected: PASS（3 tests）。

- [ ] **Step 5: Commit**

```bash
git add manheim-crawler/src/media/s3.js manheim-crawler/test/s3.test.js
git commit -m "feat(crawler): 图片下载并上传 S3(可开关/失败不阻断)"
```

---

### Task 12: 对账 reconcile.js

**Files:**
- Create: `manheim-crawler/src/reconcile.js`
- Test: `manheim-crawler/test/reconcile.test.js`

对账：以"列表期望应抓的详情 URL 集合（enqueued）"为基准，对比"实际成功入库的 URL 集合（stored）”，输出 missing 列表。missing 非空即视为漏车。

- [ ] **Step 1: 写失败测试**

```js
// test/reconcile.test.js
import { describe, it, expect } from 'vitest';
import { reconcile } from '../src/reconcile.js';

describe('reconcile', () => {
  it('reports zero missing when all enqueued urls stored', () => {
    const r = reconcile(['a', 'b', 'c'], ['a', 'b', 'c']);
    expect(r.missing).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('lists missing urls and flags not-ok', () => {
    const r = reconcile(['a', 'b', 'c'], ['a', 'c']);
    expect(r.missing).toEqual(['b']);
    expect(r.ok).toBe(false);
    expect(r.expected).toBe(3);
    expect(r.stored).toBe(2);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd manheim-crawler && npx vitest run test/reconcile.test.js`
Expected: FAIL（模块未定义）。

- [ ] **Step 3: 实现 reconcile.js**

```js
// src/reconcile.js
export function reconcile(enqueuedUrls, storedUrls) {
  const stored = new Set(storedUrls);
  const missing = [...new Set(enqueuedUrls)].filter((u) => !stored.has(u));
  return {
    expected: new Set(enqueuedUrls).size,
    stored: stored.size,
    missing,
    ok: missing.length === 0,
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd manheim-crawler && npx vitest run test/reconcile.test.js`
Expected: PASS（2 tests）。

- [ ] **Step 5: Commit**

```bash
git add manheim-crawler/src/reconcile.js manheim-crawler/test/reconcile.test.js
git commit -m "feat(crawler): 对账(列表声明 vs 入库)"
```

---

### Task 13: 编排 main.js

**Files:**
- Create: `manheim-crawler/src/crawler/main.js`
- Test: 无独立单测（编排层）；靠 Task 15 端到端验证。人工冒烟即可。

- [ ] **Step 1: 实现 main.js（Crawlee CheerioCrawler + 路由 + 降级 + 入库 + 对账）**

```js
// src/crawler/main.js
import { CheerioCrawler, Configuration } from 'crawlee';
import { load } from 'cheerio';
import { config } from '../config.js';
import { openDb, upsertVehicle, insertImages, recordFailed } from '../store/db.js';
import { buildListingUrl, parseListing } from './listing.js';
import { parseDetail } from './detail.js';
import { needsFallback } from './selectors.js';
import { fetchRenderedHtml, closeBrowser } from './fallback.js';
import { uploadImages } from '../media/s3.js';
import { reconcile } from '../reconcile.js';
import { syncToMysql } from '../store/mysql-sync.js';

export async function run(cfg = config) {
  const db = openDb(cfg.dbPath);
  const enqueued = new Set();
  const stored = new Set();

  const crawler = new CheerioCrawler({
    maxConcurrency: cfg.maxConcurrency,
    maxRequestRetries: cfg.maxRequestRetries,
    // Crawlee/got-scraping 默认跟随 302 —— 根因修复点
    proxyConfiguration: cfg.proxyUrl
      ? new (await import('crawlee')).ProxyConfiguration({ proxyUrls: [cfg.proxyUrl] })
      : undefined,
    async requestHandler({ request, $, body, enqueueLinks, addRequests }) {
      const label = request.userData.label;

      if (label === 'LIST') {
        const { detailUrls, hasNext } = parseListing($, cfg.baseUrl);
        for (const url of detailUrls) enqueued.add(url);
        await addRequests(detailUrls.map((url) => ({ url, userData: { label: 'DETAIL' } })));
        if (hasNext) {
          const next = buildListingUrl(cfg, (request.userData.page || 1) + 1);
          await addRequests([{ url: next, userData: { label: 'LIST', page: (request.userData.page || 1) + 1 } }]);
        }
        return;
      }

      // DETAIL
      let $doc = $;
      let mode = 'cheerio';
      if (needsFallback(String(body))) {
        const html = await fetchRenderedHtml(request.url, { waitSelector: 'body' });
        $doc = load(html);
        mode = 'playwright';
      }
      const { vehicle, images } = parseDetail($doc, request.url);
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

  if (cfg.mysql.enabled) await syncToMysql(db, cfg);

  db.close();
  return report;
}

// 直接运行入口
if (import.meta.url === `file://${process.argv[1]}`) {
  run().then((r) => process.exit(r.ok ? 0 : 1));
}
```

- [ ] **Step 2: 人工冒烟（小并发跑通，不求抓全，只验证不崩）**

Run: `cd manheim-crawler && MAX_CONCURRENCY=2 npm run crawl`
Expected: 打印 `[reconcile] expected=... stored=... missing=...`，`data/manheim.sqlite` 生成且有行。若崩，按报错定位（多半是 selectors 未从 recon 填全 → 回 Task 6）。

- [ ] **Step 3: Commit**

```bash
git add manheim-crawler/src/crawler/main.js
git commit -m "feat(crawler): 编排(路由/降级/入库/对账)"
```

---

## Chunk 4: MySQL 写回（预留）与端到端验证

### Task 14: MySQL 写回 mysql-sync.js（预留、可开关）

**Files:**
- Create: `manheim-crawler/src/store/mysql-sync.js`
- Modify: `manheim-crawler/package.json`（加 `mysql2` 依赖）
- Test: `manheim-crawler/test/mysql-sync.test.js`

本任务只实现"从 SQLite 读新记录、映射到 MySQL 两表列、按 vin/rego 幂等写入"的逻辑，用注入的假连接测试；不连真库。`cfg.mysql.enabled=false` 时 `syncToMysql` 直接 return（main.js 已判空调用）。

- [ ] **Step 1: 加依赖**

在 `package.json` dependencies 加 `"mysql2": "^3.11.0"`，`npm install`。

- [ ] **Step 2: 写失败测试（注入假 conn）**

```js
// test/mysql-sync.test.js
import { describe, it, expect, vi } from 'vitest';
import { openDb, upsertVehicle } from '../src/store/db.js';
import { syncRows } from '../src/store/mysql-sync.js';

describe('syncRows', () => {
  it('maps sqlite rows to mysql upsert calls', async () => {
    const db = openDb(':memory:');
    upsertVehicle(db, { vin: 'VIN1', registration: 'R1', make: 'Toyota', source_url: 'u', fetch_mode: 'cheerio' });
    const conn = { execute: vi.fn().mockResolvedValue([{}]) };
    const n = await syncRows(db, conn);
    expect(n).toBe(1);
    expect(conn.execute).toHaveBeenCalled();
    const sql = conn.execute.mock.calls[0][0];
    expect(sql).toMatch(/INSERT INTO car_crawler_manheim/i);
    db.close();
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `cd manheim-crawler && npx vitest run test/mysql-sync.test.js`
Expected: FAIL（模块未定义）。

- [ ] **Step 4: 实现 mysql-sync.js**

```js
// src/store/mysql-sync.js
import mysql from 'mysql2/promise';

const MANHEIM_COLS = [
  'uuid','plan_type','year','make','model','body_type','colour','variant',
  'doors','seats','odometer','transmission','engine','fuel_type',
  'registration','vin','no_of_keys','seller_type','comment','damage',
];

// 用注入的 conn 写入（测试注入假 conn；生产用真实连接）
export async function syncRows(db, conn) {
  const rows = db.prepare('SELECT * FROM manheim').all();
  let n = 0;
  for (const row of rows) {
    const cols = MANHEIM_COLS.filter((c) => row[c] != null);
    const placeholders = cols.map(() => '?').join(',');
    const updates = cols.map((c) => `${c}=VALUES(${c})`).join(',');
    const sql = `INSERT INTO car_crawler_manheim (${cols.join(',')}) VALUES (${placeholders})
                 ON DUPLICATE KEY UPDATE ${updates}`;
    await conn.execute(sql, cols.map((c) => row[c]));
    n++;
  }
  return n;
}

export async function syncToMysql(db, cfg) {
  if (!cfg.mysql.enabled) return 0;
  const conn = await mysql.createConnection({
    host: cfg.mysql.host, port: cfg.mysql.port, user: cfg.mysql.user,
    password: cfg.mysql.password, database: cfg.mysql.database,
  });
  try {
    return await syncRows(db, conn);
  } finally {
    await conn.end();
  }
}
```

> 注：生产启用前需确认 MySQL 侧 `car_crawler_manheim` 有 vin/registration 的唯一键，否则 `ON DUPLICATE KEY` 不生效——这一步在启用时于 `docs-recon.md` 记录确认，本期不验证真库。

- [ ] **Step 5: 跑测试确认通过**

Run: `cd manheim-crawler && npx vitest run test/mysql-sync.test.js`
Expected: PASS（1 test）。

- [ ] **Step 6: Commit**

```bash
git add manheim-crawler/src/store/mysql-sync.js manheim-crawler/package.json manheim-crawler/package-lock.json manheim-crawler/test/mysql-sync.test.js
git commit -m "feat(crawler): MySQL 写回(预留/可开关/幂等)"
```

---

### Task 15: 端到端验证（ND060726，missing=0 通过标准）

**Files:**
- Create: `manheim-crawler/scripts/verify-nd060726.md`（验证记录）

- [ ] **Step 1: 全量跑一次真实抓取**

Run: `cd manheim-crawler && npm run crawl 2>&1 | tee scripts/last-run.log`
Expected: 结束打印 `[reconcile] ... missing=N`。

- [ ] **Step 2: 判定通过标准**

通过 = **missing=0**（spec 10 节量化标准：新库 VIN/URL 集合 ⊇ 列表声明集合）。
- 若 `missing>0`：查 `last-run.log` 里列出的 URL 与 `failed_requests` 表，逐条定位（跳转未识别 / 降级失败 / 选择器漏），修复后回归。
- 用 SQL 抽查若干条：`sqlite3 data/manheim.sqlite "SELECT vin,registration,make,model,fetch_mode FROM manheim LIMIT 20"`，确认字段真实非空、`fetch_mode` 分布合理。

- [ ] **Step 3: 与旧结果对比（若能拿到旧库/旧抓取结果）**

若有 Java 版某次抓取的 VIN 集合，做差集：新库应覆盖旧库全部 VIN，且**能多抓到旧版漏掉的**（即修复见效的直接证据）。记录到 `verify-nd060726.md`。

- [ ] **Step 4: 记录验证结论并 Commit**

```bash
git add manheim-crawler/scripts/verify-nd060726.md
git commit -m "test(crawler): ND060726 端到端验证(missing=0)"
```

---

## 完成标准（Definition of Done）

- 所有单测通过（`npm test`）。
- `npm run crawl` 对 ND060726/SALVAGENZ 跑通，**对账 missing=0**。
- recon 已实证"二次跳转"类型并坐实/修正 spec 中的 Hutool 根因结论。
- 无图车辆也入库；单条失败不影响其余车；漏车在对账报告可见。
- MySQL 写回逻辑就绪（默认关），启用前需确认真库唯一键。
