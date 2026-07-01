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
  $(SELECTORS.listItem).each((_, item) => {
    const href = $(item).find(SELECTORS.detailLink).first().attr('href');
    const url = abs(baseUrl, href);
    if (url) detailUrls.push(url);
  });

  const hasNext = SELECTORS.pagination.nextLink
    ? $(SELECTORS.pagination.nextLink).length > 0
    : false;

  return { detailUrls, hasNext };
}
// 对账以详情 URL 集合为准：request.url 跨 302 保持不变，比列表页声明的 vin/rego 更稳。
// selectors.listDeclaredKey 保留为预留字段，本期不用于对账。
