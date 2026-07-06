// src/crawler/detail.js
import { SELECTORS } from './selectors.js';
import { applyPair } from './fields.js';

const S = SELECTORS.detail;

// 解析一个 <dl> 区块的 dt/dd 成对喂给 applyPair
function applyBlock($, blockSel, vehicle) {
  const block = $(blockSel).first();
  if (!block.length) return;
  const dts = block.find(S.dt);
  const dds = block.find(S.dd);
  dts.each((i, dt) => {
    const label = $(dt).text();
    const value = $(dds.get(i)).text();
    applyPair(vehicle, label, value);
  });
}

export function parseDetail($, sourceUrl) {
  const vehicle = { source_url: sourceUrl, fetch_mode: 'cheerio' };

  // Manheim 详情 URL 的第一段是稳定的 item id：/damaged-vehicles/<item_id>/<slug>
  // 摩托/ATV 等无 vin/rego 的车用它做兜底唯一键，避免被跳过漏车。
  const m = String(sourceUrl).match(/\/damaged-vehicles\/([^/?#]+)/);
  if (m) vehicle.item_id = m[1];

  applyBlock($, S.detailsBlock, vehicle);
  applyBlock($, S.infoBlock, vehicle);

  // comment
  if (S.comment) {
    const c = $(S.comment).first().text().trim();
    if (c) vehicle.comment = c;
  }

  // damage：逗号拼接（对齐 Java StrUtil.join）
  if (S.damageItem) {
    const parts = $(S.damageItem).map((_, el) => $(el).text().trim()).get().filter(Boolean);
    if (parts.length) vehicle.damage = parts.join(',');
  }

  // images：读 imageAttr（默认 data-src）
  const images = [];
  if (S.imageContainer) {
    $(`${S.imageContainer} img`).each((_, img) => {
      const url = $(img).attr(S.imageAttr) || $(img).attr('src');
      if (url) images.push({ url, s3_url: null });
    });
  }

  return { vehicle, images };
}
