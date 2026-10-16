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
