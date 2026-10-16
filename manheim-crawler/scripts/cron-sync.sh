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
