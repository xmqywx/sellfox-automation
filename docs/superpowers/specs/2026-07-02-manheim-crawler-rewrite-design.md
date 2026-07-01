# Manheim NZ 车源爬虫重写设计（Node.js / Crawlee）

- 日期：2026-07-02
- 状态：已批准（用户确认）
- 目标：用 Node.js + Crawlee 完整替换 Java 版 `WebThirdManheimCrawlerCommand`，根治线上"漏车"问题。

## 1. 背景与问题

现有 Java 爬虫 `car-recycl-admin/.../modules/run/WebThirdManheimCrawlerCommand.java`
从 Manheim.co.nz 抓取车源，存入 MySQL `car_crawler_manheim` / `car_crawler_manheim_image`
两张表，供后台按 VIN/车牌查询。

线上表现：每次抓取都会**随机漏车**（有的车抓到、有的没抓到，时好时坏）。

### 根因（已定位，高置信度，静态分析）

主因在详情页请求：

```java
HttpResponse responseDetail = HttpRequest.get(detailUrl).timeout(20000).execute();
```

Hutool 的 `HttpRequest` **默认不跟随 302/301 重定向**（`maxRedirectCount` 默认 = 0）。
Manheim 有些车的详情链接返回的是一个中转地址（302 / 或 JS/meta 跳转），
Hutool 拿到的是跳转壳页，解析不出 `vehicle-details` → VIN/车牌全空 →
命中 `empty item, skip` 被静默丢弃。走直连(200)的车抓到、走中转的车漏掉，
完全吻合"随机漏车"。三处 `HttpRequest.get`（首页/列表/详情）都未设跟随重定向。

### 顺带放大漏车的次要隐患

1. `ThreadUtil.execute` 的 lambda 内**异常被吞**：详情请求一旦超时/连接重置抛异常，
   会中断整条 for 循环 → 该拍卖计划后续所有车全丢，且无日志。
2. **无图不入库**（`if(CollUtil.isNotEmpty(manheimImages))` 才 insert）：
   没图的车即使 VIN/车牌齐全也永不保存。
3. `getElementsByAttributeValueContaining("WT.z_aucid").get(0)`：页面结构变动取不到即
   `IndexOutOfBounds`，整条计划线程直接挂掉。
4. 详情请求无重试、无 User-Agent，易被限流。

## 2. 目标与非目标

### 目标
- 完整替换 Java Manheim 爬虫的抓取能力。
- 根治漏车：能对 `damaged-vehicles/auctions/ND060726/page1?franchiseID=SALVAGENZ`
  这类列表页把车**抓全**，并能与旧结果对比证明不再漏。
- 满足四项诉求：**性能、速度、准确性（长期可靠不漏）、不被原站封锁**。
- 图片下载并上传 S3（复刻 Java 行为，但去掉"无图不入库"）。

### 非目标（本期不做，YAGNI）
- 不重写后台查询服务（`CarCrawlerManheimServiceImpl` 保持不动）。
- 不做前端/管理界面。
- MySQL 写回作为**预留、可开关**的步骤，不作为本期验证目标。
- 不抓 Turners / carjam（仅 Manheim）。

## 3. 技术选型

- **语言/框架**：Node.js + [Crawlee](https://github.com/apify/crawlee)。
  - 准确性：请求队列 + 默认跟随 302 + 默认失败自动重试退避 → 根因消除。
  - 抗封：默认 HTTP 引擎 `got-scraping` 模拟真实浏览器 TLS 指纹 + 请求头；
    内置 SessionPool 轮换、可插代理、429/403 自动退避。
  - 速度：静态页用 `CheerioCrawler` 纯 HTTP + 自动伸缩并发。
  - 长期可用：疑难条无缝降级 Playwright，扛住网站偶尔上 JS 反爬。
- **抓取引擎（方案 B：Cheerio + Playwright 降级）**：
  默认 `CheerioCrawler` 抓 HTML；当某条详情页关键字段(VIN/rego)解析不到、
  或检测到 meta-refresh / JS 跳转时，**只对该条**降级到 Playwright 真浏览器补抓。
  99% 走快路径，疑难条走稳路径。
- **存储**：SQLite（`better-sqlite3`）作为主存储与对账真相源；
  MySQL 写回为可开关的预留步骤。
- **图片**：下载后上传 S3（`@aws-sdk/client-s3`），存最终 S3 URL。

### 被否决的备选
- 纯 Cheerio（方案 A）：JS 渲染/JS 跳转页会漏。
- 全 Playwright（方案 C）：慢、重、易触发频率风控。
- crawl4ai / Scrapy：结构化字段抽取 + 抗封 + 混合浏览器降级的组合不如 Crawlee 顺手；
  got-scraping 抗封生态在 Node 侧更成熟。

## 4. 架构

单一职责拆分，各单元可独立理解与测试：

```
src/
  main.js            # 入口：编排 + 对账 + 退出码
  config.js          # 目标 auction/franchise、并发、延迟、代理、S3、DB 路径（.env）
  crawler/
    listing.js       # 列表页：分页抓取，产出每辆车详情 URL 入队
    detail.js        # 详情页：Cheerio 解析字段 + 图片 URL；缺字段→标记降级
    fallback.js      # Playwright 补抓单条
    fields.js        # DOM→字段映射（对应原 convertInfoFromWeb 的 switch）
  store/
    db.js            # SQLite：建表、按 vin/rego 去重、upsert
    mysql-sync.js    # 【预留、可开关】写回 car_crawler_manheim / _image
  media/
    s3.js            # 下载图片→上传 S3，返回最终 URL
  reconcile.js       # 列表车数 vs 入库数 对账，漏的列出来 + 报警
test/
  fixtures/          # 真实列表页/详情页 HTML 快照
  *.test.js
```

### 单元契约
- `listing.js`：输入 auction/franchise/页码，输出该页所有车的详情 URL（含分页翻页）。
- `detail.js`：输入详情页 HTML，输出结构化车辆对象 + 图片 URL 列表 + `needsFallback` 标记。
- `fields.js`：输入 (dt 文本, dd 文本)，映射到车辆字段；集中管理选择器与字段名。
- `db.js`：输入车辆对象，按 vin/rego upsert；输出是否新增。
- `s3.js`：输入图片 URL，输出 S3 URL（失败返回 null 并记录，不阻断入库）。
- `reconcile.js`：输入列表声明车数与入库车数，输出漏车 URL 列表。

## 5. 数据流

```
列表页(分页, 跟随 302)
  → 每辆车详情 URL 入 RequestQueue
    → 详情页(Cheerio 解析)
      → 字段齐? ── 是 ─→ 入库流程
                └─ 否/检测到跳转 ─→ Playwright 补抓 ─→ 入库流程
入库流程: 图片 URL 列表 → S3 上传 → SQLite upsert(按 vin/rego 去重)
全部完成 → reconcile 对账 → 漏车报告
```

## 6. 存储 Schema（SQLite，对齐原 MySQL 两表）

`manheim` 表（字段对齐原 `CarCrawlerManheim`）：
`id, uuid, plan_type, year, make, model, body_type, colour, variant, doors, seats,
odometer, transmission, engine, fuel_type, registration, vin, no_of_keys, seller_type,
comment, damage` + 新增运维字段
`first_seen, last_seen, source_url, fetch_mode('cheerio'|'playwright')`。

`manheim_image` 表：`id, manheim_id, uuid, url(原始), s3_url`。

`failed_requests` 表：`url, kind('listing'|'detail'), error, attempts, ts`。

- **去重键**：vin 或 registration。
- **策略改动**：原版命中即 `skip`（存在即丢弃，埋掉更新）；本设计改为 **upsert**，
  更新 `last_seen` 与可能变化的字段，避免丢失数据更新。

## 7. 关键改进（对应第 1 节 4 个隐患）

1. 自动跟随 302 + 自动重试退避 → 解决二次跳转漏车（根因）。
2. 每辆车独立 Request，单条失败不拖垮整批。
3. **无图也入库**（删除"images 非空才存"的判断）。
4. `reconcile` 对账：列表声明 N 辆、实际入库 M 辆，`N≠M` 就打印漏的 URL 并以非零退出码/告警提示——漏车从"静默"变"可见可报警"。

## 8. 抗封策略

- got-scraping 真实浏览器指纹 + 请求头。
- `maxConcurrency` 保守（默认 3–5，可配）。
- 请求间 `minDelay`（可配）。
- SessionPool 会话轮换；可选代理开关（本地默认关）。
- 429 / 403 自动退避重试；重试耗尽的 URL 进对账报告，不静默丢。

## 9. 错误处理

- `failedRequestHandler` 把失败请求落 `failed_requests` 表。
- 重试耗尽的详情 URL 一律进对账报告。
- S3 上传失败：记录并置 `s3_url = null`，**不阻断**车辆入库。
- 解析异常隔离在单条 Request，不影响其他车。

## 10. 测试策略

- **解析单测**：把真实列表页/详情页 HTML 存为 fixture，测 `listing.js` / `detail.js` /
  `fields.js` 的字段映射与图片提取。
- **对账单测**：构造"列表 N 辆、入库 M 辆"场景，验证漏车 URL 正确列出。
- **去重/upsert 单测**：同 vin/rego 二次抓取应更新而非重复插入。
- **端到端验证**：对 `ND060726` / `SALVAGENZ` 小样真实跑通，人工核对不漏。

## 11. 实现顺序（含必做的 recon）

> 选择器风险披露：列表项、详情字段、图片、详情链接、"二次跳转"的具体形态
> 目前基于原 Java 代码 + 对 Manheim 新版 URL 结构的推断，**尚未实测**。
> 为保证选择器不是猜的，实现第一步必须做真实页面 recon，不得跳过、不得用猜的选择器充数。

1. **Recon（必做，第一步）**：真实抓一次列表页 + 一条详情页，确认 DOM 结构，
   并确认"二次跳转"到底是 HTTP 302 还是 JS/meta 跳转；据此定稿选择器与降级触发条件。
2. 脚手架 + config + SQLite 建表。
3. `listing.js` 分页抓取 + 入队。
4. `detail.js` + `fields.js` 字段/图片解析（Cheerio）。
5. `fallback.js` Playwright 降级。
6. `s3.js` 图片下载上传。
7. `db.js` upsert/去重 + `reconcile.js` 对账。
8. 单测 + 端到端验证（ND060726 小样，与旧结果对比证明不漏）。
9. `mysql-sync.js` 预留写回（可开关，本期不作为验证目标）。

## 12. 待确认/风险

- 新版 Manheim 站点结构与 Java 版（首页 `data-state="ni"` 计划）可能不同；
  用户给的 URL 是 `damaged-vehicles/auctions/{eventId}/page{n}?franchiseID=...` 新结构，
  以 recon 结果为准。
- SQLite 主存 vs "完整替换 Java 爬虫"存在集成缺口：Java 前台从 MySQL 读，
  最终替换需启用 MySQL 写回。本期以 SQLite 为真相源先跑通。
- S3 需凭证；缺凭证时图片步骤应可跳过而不阻断数据抓取。
