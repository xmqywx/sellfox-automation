# 本地定时自动写回（cron）

`sync-all` 自动发现当前所有 SALVAGENZ 拍卖 → 抓全 → 写回生产 MySQL（与 Java 过渡期共存，
两者都按 vin/rego 去重跳过，不重复插）。

## 前置
- `manheim-crawler/.env` 配好：`MYSQL_HOST / MYSQL_PORT / MYSQL_USER / MYSQL_PASSWORD / MYSQL_DATABASE`
  （与 `config.js` 一致；`.env` 已在 .gitignore）。
- Playwright chromium 已装：`PLAYWRIGHT_BROWSERS_PATH=0 npx playwright install chromium`。

## 手动跑一次
```bash
cd manheim-crawler
PLAYWRIGHT_BROWSERS_PATH=0 MYSQL_SYNC=true node src/sync-all.js
```

## 装 cron（每天 09:00 本地，避开 Java 的凌晨窗口）
```bash
(crontab -l 2>/dev/null | grep -v cron-sync.sh; \
 echo "0 9 * * * /Users/ying/Documents/Sunny/manheim-crawler/scripts/cron-sync.sh") | crontab -
```
日志见 `scripts/cron.log`（已被 .gitignore 的 `*.log` 忽略）。

## 与 Java 共存
两者都按 vin/rego 去重跳过，不会产生重复行。稳定一段时间后，可关闭 Java 的
`WebThirdManheimCrawlerCommand` @Scheduled，由本脚本独立承担。

## 停用
`crontab -e` 删除 cron-sync.sh 那行。
