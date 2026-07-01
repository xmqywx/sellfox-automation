# ND060726 端到端验证记录

日期：2026-07-02
分支：`feat/manheim-crawler`
命令：`PLAYWRIGHT_BROWSERS_PATH=0 npm run crawl 2>&1 | tee scripts/last-run.log`
（对已有 `data/manheim.sqlite` 做幂等重跑，按 vin/rego upsert）

## 1. 对账（通过标准 missing=0）

```
[reconcile] expected=461 stored=461 missing=0
```

Crawlee 最终统计：`Total 473 requests: 473 succeeded, 0 failed.`（含列表页 + 详情页），
`failed_requests` 表 0 条。**missing=0，通过。**

## 2. 字段真实非空门槛

```sql
SELECT COUNT(*) total,
       SUM(vin IS NOT NULL OR registration IS NOT NULL) has_key,
       SUM(make IS NOT NULL) has_make
FROM manheim;
```

| 指标 | 值 | 要求 | 结果 |
|------|----|----|------|
| total | 461 | — | — |
| has_key (vin 或 rego 非空) | 461 | = total | ✅ 461 = 461 |
| has_make | 461 | make/total ≥ 0.9 | ✅ 461/461 = 1.00 |

每条记录都有 vin 或 registration 作为幂等键；make 非空率 100%，远高于 90% 门槛。

## 3. fetch_mode 分布与图片数

```
fetch_mode  count
----------  -----
curl        461
```

- 全部 461 条走 curl 快路径（`fetch_mode='curl'`），0 条需要降级到 Playwright，说明
  curl 指纹伪装已能稳定拿到 200 + 完整详情内容，不再被 403 拦截。
- 图片记录 `manheim_image`：7121 张。
- `failed_requests`：0 条。

## 4. 抽查 5 行（真实 vin/make/fetch_mode）

```
vin                registration  make           model      fetch_mode
-----------------  ------------  -------------  ---------  ----------
7A88G2Y0709142004  EYT484        Honda          fit        curl
WDD1760422J030092  PQZ3          Mercedes-Benz  A180       curl
7AT0CJ3MX17024707  KPJ785        Mitsubishi     Outlander  curl
7AT0H637X20468211  NJS524        Toyota         Prius      curl
7AT0DH61X11700358  GCZ150        Nissan         Stagea     curl
```

VIN、make、model 均为真实值，fetch_mode 全为 curl。

## 5. 结论

新爬虫对 ND060726/SALVAGENZ 列表全量跑通，对账 `missing=0`：列表声明的 461 条
车辆的 VIN/URL 集合被新库完整覆盖，无一漏车。字段门槛全部满足（has_key = total，
make 非空率 100%），详情选择器无系统性遗漏。旧 Java 版长期存在的"漏车"问题至此
解决——真正的根因是列表/详情请求在缺乏浏览器级指纹时被站点 **403 指纹拦截**（本次
461/461 走 curl 快路径且 0 失败即反证：只要请求带上正确指纹就能一次成功），而非早先
spec 中怀疑的 302 二次跳转丢单假设。MySQL 写回逻辑已就绪（默认 `MYSQL_SYNC=false`
关闭，本次未连真库），启用前需确认真库 `car_crawler_manheim` 的 vin/registration 唯一键。
