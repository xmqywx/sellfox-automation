# Manheim NZ 车源爬虫

Node.js + Crawlee 重写版。复制 `.env.example` 为 `.env` 后：

    npm install
    npx playwright install chromium
    npm run crawl     # 抓取
    npm test          # 单测

数据落 `data/manheim.sqlite`。详见 `docs/superpowers/specs/2026-07-02-manheim-crawler-rewrite-design.md`。
