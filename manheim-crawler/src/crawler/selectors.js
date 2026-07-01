// src/crawler/selectors.js
// 所有选择器均由 2026-07-02 recon（见 docs-recon.md）从真实 HTML 确认。
// listing.html / detail.html 为当日真实快照（fixture）。
export const SELECTORS = {
  listItem: '.vehicle-item',        // 列表页每辆车的容器（真实快照 40 命中）
  detailLink: '.card-header a',      // 条目内详情链接（href 为相对路径，需补全）
  listDeclaredKey: '',               // 列表条目不直接暴露 vin/rego，对账退回详情 URL 集合
  pagination: {
    nextLink: 'a.next',              // “Next” 链接（class: searchResultLink next ...）
    totalCountText: '',              // 列表页无稳定总车数文本，留空
  },
  detail: {
    imageContainer: '#vehicle-image',  // 图片容器（15 张 img，data-src）
    imageAttr: 'data-src',
    detailsBlock: '.vehicle-details',  // 车辆规格 dl（Build Year/Make/... dt/dd）
    infoBlock: '.vehicle-info',        // Registration/VIN/No of Keys dl
    comment: '.vehicle-comments p',    // 备注段落
    damageItem: '.vehicle-damage .col-xs-6', // 损伤条目
    dt: 'dt',
    dd: 'dd',
    // presenceMarker：真详情页已渲染才会出现的子串。recon Step 3 确认 detail.html
    // 含 'vehicle-details'（原始 HTML，无需 JS 渲染），列表页/403 壳页均不含。
    presenceMarker: 'vehicle-details',
  },
};

// 判定该详情 HTML 是否需要 Playwright 降级：解析不到关键块或疑似跳转即为 true。
export function needsFallback(html) {
  if (!html) return true;
  const marker = SELECTORS.detail.presenceMarker;
  // marker 未配置时保守降级（宁慢勿漏）；配置后按 recon 确认的子串判断
  const hasDetails = marker ? html.includes(marker) : false;
  const looksRedirect = /<meta[^>]+http-equiv=["']?refresh/i.test(html)
    || /window\.location\s*=/.test(html);
  return !hasDetails || looksRedirect;
}
