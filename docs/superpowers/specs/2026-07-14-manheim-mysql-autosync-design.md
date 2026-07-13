# Manheim 爬虫自动写回 MySQL + 定时替代（过渡期共存）设计

- 日期：2026-07-14
- 状态：已批准（用户确认）
- 目标：让 Node 爬虫自动发现当前所有 salvage 拍卖、抓全、并**自动写回生产 MySQL**，本地定时运行，与旧 Java 爬虫过渡期共存，最终替代之，从根上不再漏车、不再手动对比回填。

## 1. 背景

前序工作已完成：Node/Crawlee 爬虫可对单个拍卖抓取、SQLite 主存、reconcile 不漏、
item-id 兜底无 key 车（见 `2026-07-02-manheim-crawler-rewrite-design.md`）。
但目前"爬最新数据 + 对比 MySQL + 回填"全靠手动，且：
- 爬虫按单个 `AUCTION_ID` 运行，多拍卖靠手工跑多次；
- 爬虫未捕获 `uuid`/`plan_type`（生产 MySQL 这两列 NOT NULL）；
- 无 vin/rego 的车（摩托/ATV）在生产 MySQL 无法去重（无 item_id 列）；
- `mysql-sync.js` 是预留占位，未生产可用。

生产库连接见 Java `application-prod.yml`（AWS RDS `nzcar_recycling_prod`，表
`car_crawler_manheim` / `car_crawler_manheim_image`）。

## 2. 目标 / 非目标

### 目标
- 自动发现当前所有 `franchiseID=SALVAGENZ` 拍卖并全量抓取。
- 爬虫捕获 `uuid`（拍卖代码）与 `plan_type`（'Salvage'）。
- 生产 MySQL 加 `item_id` 列，支持无 vin/rego 车去重。
- `mysql-sync` 生产可用：幂等写回车辆 + 图片，去重键 `vin OR rego OR item_id`。
- 本地定时（macOS cron/launchd）每日自动跑：发现→抓取→写回。
- 与 Java 过渡期共存（都按 vin/rego 去重，不产生重复行）。

### 非目标（YAGNI）
- 不关闭 Java `@Scheduled`（共存，用户后续手动关）。
- 不上服务器部署（本轮本地定时；服务器化以后再说）。
- 不重写后台查询服务。
- 不做 S3 图片上传的改动（沿用现有 s3.js 可开关逻辑）。

## 3. 关键决策（已确认）

- **部署**：本地 cron/launchd 定时跑，写生产 MySQL。
- **Java 去留**：过渡期共存，稳定后用户再关 Java。
- **无 key 车**：给生产 MySQL 加 `item_id` 列，无 vin/rego 时按 item_id 去重。
- **uuid**：= 当前拍卖代码（如 ND130726）。车若出现在多场，取当次抓取的拍卖。
- **plan_type**：= 'Salvage'（SALVAGENZ franchise 恒定，与库中现有数据一致）。

## 4. 架构（新增/改动单元）

```
manheim-crawler/src/
  crawler/
    discover.js      # 【新】Playwright 渲染首页 → 当前 SALVAGENZ 拍卖代码列表
    main.js          # 【改】parseDetail 后补 uuid=cfg.auctionId, plan_type
    fields/detail    # uuid/plan_type 不来自 DOM，由编排注入（见下）
  store/
    db.js            # 【改】manheim 表加 uuid/plan_type 已有列(已存在) → 确认写入
    mysql-sync.js    # 【改】生产可用：全字段映射 + vin/rego/item_id 去重 + 图片
    mysql-migrate.js # 【新】幂等加 item_id 列 + 索引（生产 schema 迁移）
  sync-all.js        # 【新】编排：discover → 逐场 crawl → mysql-sync → 汇总
scripts/
  cron-sync.sh       # 【新】cron 包装脚本（加载 .env、设 PLAYWRIGHT_BROWSERS_PATH）
```

### 单元契约
- `discover.js`：`discoverAuctions()` → `[{code, name, franchise}]`（仅 SALVAGENZ）。
- `main.js run(cfg)`：`cfg.auctionId` 已有；新增在 upsert 前置 `vehicle.uuid=cfg.auctionId`、
  `vehicle.plan_type='Salvage'`。
- `mysql-migrate.js`：`ensureItemIdColumn(conn)` → 幂等加列+索引，返回是否新增。
- `mysql-sync.js`：`syncToMysql(db, cfg)` → 读 SQLite，逐车按 `vin OR rego OR item_id`
  查存在，不存在则插车+图片，返回 `{inserted, skipped}`。
- `sync-all.js`：`runAll(cfg)` → discover → 每场 `run()` 累积到同一 SQLite → 迁移 →
  `syncToMysql` → 打印汇总（每场 reconcile + 本轮写回 N）。

## 5. 数据流

```
discoverAuctions()  → [ND.., NR.., NM.., ...]（当前 SALVAGENZ）
  └─ 每场: run({auctionId})  → 抓取写 SQLite（uuid/plan_type 注入, item_id 兜底）
迁移: ensureItemIdColumn(prod)   （首次加列, 幂等）
syncToMysql(SQLite → prod)
  └─ 每车: 存在(vin|rego|item_id)? 否→插车+图片; 是→跳过
汇总: 每场 reconcile missing + 本轮写回 inserted
```

## 6. 生产 MySQL schema 变更（最高风险项）

```sql
ALTER TABLE car_crawler_manheim ADD COLUMN item_id VARCHAR(50) NULL;
CREATE INDEX idx_manheim_item ON car_crawler_manheim (item_id);
```
- **纯加可空列 + 索引，不改/不删现有 44k+ 行**，最低风险。
- 幂等：迁移脚本先查 `information_schema.COLUMNS`，已存在则跳过（MySQL 无
  `ADD COLUMN IF NOT EXISTS`，用信息模式判断）。
- 回滚：`ALTER TABLE car_crawler_manheim DROP COLUMN item_id;`（列可空，删除安全）。
- 执行前**干跑打印 SQL + 用户确认**再执行。

## 7. mysql-sync 去重与共存

- 去重（存在即跳过，不 UPDATE，避免覆盖 Java 写的行）：
  `SELECT id WHERE vin=? OR registration=? OR (item_id IS NOT NULL AND item_id=?)`。
- Java 也按 vin/rego 去重插入 → 两者对同一车都不会重复插。
- 无 vin/rego 车：Java 会跳过（旧 bug），新爬虫按 item_id 插入 → 只有新爬虫会写它们，
  不冲突。
- `create_by/update_by='System'`，`create_time/update_time=NOW()`，与 Java 一致。

## 8. 错误处理

- 单场抓取失败 → 记录并继续其余场（不中断全批）。
- 单车写回失败 → 记 `failed_requests`，继续。
- 迁移失败（无权限等）→ 中止 sync 并明确报错（不静默跳过写回）。
- discover 失败（首页结构变）→ 中止并报错，不用空列表当"无拍卖"。

## 9. 测试

- `discover.js`：用真实首页渲染快照 fixture，断言能抽出 SALVAGENZ 代码、过滤掉其他 franchise。
- `mysql-migrate.js`：注入假 conn，断言"列不存在→执行 ADD；已存在→跳过"。
- `mysql-sync.js`：注入假 conn，覆盖三分支去重（vin 命中/rego 命中/item_id 命中→跳过；
  全不命中→插入），断言 SQL 含 item_id 与全字段；图片写入。
- `main.js` 注入：断言 upsert 的 vehicle 带 uuid=auctionId、plan_type='Salvage'。
- 端到端：本地对当前拍卖跑一次 `sync-all`，确认生产库新增数 = 对比缺口数。

## 10. 实现顺序

1. 生产 schema 迁移脚本 `mysql-migrate.js`（幂等）+ 测试；干跑确认后对生产执行加列。
2. 爬虫捕获 uuid/plan_type（main.js 注入）+ 测试。
3. `discover.js`（Playwright 首页）+ fixture 测试。
4. `mysql-sync.js` 生产可用（全字段 + 三键去重 + 图片）+ 注入测试。
5. `sync-all.js` 编排 + 汇总。
6. `scripts/cron-sync.sh` + 本地 cron/launchd 配置说明。
7. 端到端：跑一次，确认写回数 = 对比缺口，且无重复行。

## 11. 待确认 / 风险

- 生产库写权限：`admin` 账号可 ALTER/INSERT（已用 INSERT 回填过，ALTER 需确认权限）。
- 首页渲染依赖 Playwright（本地已 `PLAYWRIGHT_BROWSERS_PATH=0` 安装 chromium）。
- 本地机器需常开才能定时跑（本轮接受；服务器化以后再说）。
- 共存期 uuid 语义：同一车跨多场时 MySQL 可能已有旧 uuid 行 → 按 vin/rego 命中即跳过，
  不更新 uuid（可接受，uuid 非查询键）。
