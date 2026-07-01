# Recon 记录 — Manheim NZ 爬虫（2026-07-02）

拍板依据：对真实抓取的 `test/fixtures/listing.html`、`test/fixtures/detail.html` 快照实证。

## 1. 列表页

- URL: `https://www.manheim.co.nz/damaged-vehicles/auctions/ND060726/page1?franchiseID=SALVAGENZ`
- 抓取结果：
  - `curl`（默认 UA）: **HTTP 200**，423,648 bytes（用作 fixture）。
  - Crawlee `gotScraping`（默认）: **HTTP 403**，520 bytes（被机器人指纹拦截）。
- DOM 实证（cheerio）：
  - 车辆条目容器 `listItem = .vehicle-item` → 40 命中（= 本页 40 辆车）。
  - 条目内详情链接 `detailLink = .card-header a`（每条 2 个 a，`find` 共 80 命中）。
    href 为**相对路径**，例：`/damaged-vehicles/000000000007378560/2002-honda-fit-hatch?referringPage=AuctionListing`，需补全为绝对 URL。
  - 分页：`nextLink = a.next`（class `searchResultLink next ...`）；末页 `page12`，共 12 页。
  - 列表条目**不直接暴露** VIN/rego → `listDeclaredKey = ''`，对账退回“详情 URL 集合”。

## 2. 详情页 —— “二次跳转”判定（本次 recon 的核心结论）

对列表解析出的第一个详情 URL（2002 Honda Fit）实测：

| 请求方式 | 结果 |
|---|---|
| `curl -I`（不跟随重定向） | **HTTP 200**，`redirect_url` 为空 |
| `curl -L`（跟随） | HTTP 200，`num_redirects=0`，最终 URL 未变，178,898 bytes |
| 裸 id URL `/damaged-vehicles/000000000007378560`（不跟随） | **HTTP 200**，无 Location |
| Crawlee `gotScraping`（跟随/不跟随） | **HTTP 403**（同样被指纹拦截） |

原始 HTML（未经 JS 渲染）即含全部关键块：
`vehicle-details`(1) / `vehicle-info`(1) / `#vehicle-image`(1, 15 张 `img[data-src]`) /
`vehicle-comments p`(1) / `vehicle-damage .col-xs-6`(3)。
唯一 `<meta http-equiv>` 是 `X-UA-Compatible=IE=edge`（**非** meta refresh）；
页面内出现的 `window.location` 是 `window.location.origin`（**非**跳转赋值，`needsFallback`
的 `/window\.location\s*=/` 正则实测 **不匹配**）。

**结论（跳转类型）：既不是 HTTP 302，也不是 JS/meta 跳转。**
从列表 href 直连详情页返回 HTTP 200、`num_redirects=0`，且 `vehicle-details` 就在原始 HTML 里。
本 auction 的详情页**没有二次跳转**，普通 HTTP 抓取即可解析，**不需要 Playwright 渲染**。

## 3. 对 spec “Hutool 根因（302 漏车）”假设的实证结论

**修正，不坐实。** 原假设“漏车根因是 HTTP 302 二次跳转、Crawlee 默认 followRedirect 即可修复”
在本次实测中**不成立**——详情 URL 根本不发生 30x 跳转（`num_redirects=0`）。

recon 中真正复现出来的可观测阻断是：
**Crawlee 默认 `gotScraping` 对列表页与详情页都返回 403（TLS/HTTP 指纹机器人拦截），而普通
`curl` 默认 UA 返回 200。** 这更可能是旧 Hutool 客户端“漏车/失败”的真实根因（HTTP 客户端被
指纹识别拦截、间歇 403），而非 302 重定向。

处置建议（留给后续 Chunk）：
- 抓取层需绕过 403——`gotScraping` 配置更真实的浏览器指纹/请求头，或直接走 Playwright 降级抓取，
  而不是依赖 followRedirect。
- 因原始 HTML 已含 `vehicle-details`，一旦拿到 200 响应体，解析路径（Task 8/9）无需渲染。
- fixture 本次经 `curl` 采集（因 `gotScraping` 403），选择器/marker 均已对真实 HTML 坐实。

## 4. 定稿选择器（见 `src/crawler/selectors.js`）

| 键 | 值 | 依据 |
|---|---|---|
| listItem | `.vehicle-item` | 列表页 40 命中 |
| detailLink | `.card-header a` | 条目内详情链接（相对路径） |
| listDeclaredKey | `''` | 列表不暴露 vin/rego |
| pagination.nextLink | `a.next` | “Next” 链接，共 12 页 |
| detail.imageContainer | `#vehicle-image` | 15 张 `img[data-src]` |
| detail.imageAttr | `data-src` | 图片真实地址在 data-src |
| detail.detailsBlock | `.vehicle-details` | 规格 dl，dt/dd ×10 |
| detail.infoBlock | `.vehicle-info` | Registration/VIN/No of Keys，dt/dd ×3 |
| detail.comment | `.vehicle-comments p` | 备注段落 |
| detail.damageItem | `.vehicle-damage .col-xs-6` | 损伤条目 ×3 |
| detail.presenceMarker | `vehicle-details` | 真详情页原始 HTML 才有 |

## 5. Step 5 硬 gate 结果

```
{ listItem: 40, detailLink: 80, detailsBlock: 1, imageContainer: 1, markerPresent: true }
GATE PASSED, exit 0
```

## 6. 本条 fixture 的真实车值（供 Task 8 精确断言）

- VIN: `7A88G2Y0709142004`
- Registration: `EYT484`
- Make: `Honda`, Build Year: `2002`, Body Type: `4D Hatch`, Model: `fit`, Body Colour: `Pink`
