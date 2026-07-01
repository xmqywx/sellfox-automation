// src/media/s3.js
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';

export function makeS3Client(cfg) {
  return new S3Client({
    region: cfg.s3.region,
    credentials: cfg.s3.accessKeyId
      ? { accessKeyId: cfg.s3.accessKeyId, secretAccessKey: cfg.s3.secretAccessKey }
      : undefined,
  });
}

function keyFor(cfg, url, contentType) {
  const ext = (contentType && contentType.includes('png')) ? 'png' : 'jpg';
  const hash = createHash('sha1').update(url).digest('hex').slice(0, 16);
  return `${cfg.s3.prefix}${hash}.${ext}`;
}

// deps 可注入 fetchFn / s3Client（测试用）；生产默认全局 fetch + 真实客户端
export async function uploadImages(images, cfg, deps = {}) {
  if (!cfg.s3?.enabled) return images;
  const fetchFn = deps.fetchFn || globalThis.fetch;
  const s3 = deps.s3Client || makeS3Client(cfg);

  const out = [];
  for (const img of images) {
    let s3_url = img.s3_url;
    try {
      const res = await fetchFn(img.url);
      const ok = res.ok ?? true;
      if (!ok) throw new Error(`download ${res.status}`);
      const ct = (res.headers?.get ? res.headers.get('content-type') : '') || 'image/jpeg';
      const buf = Buffer.from(await res.arrayBuffer());
      const key = keyFor(cfg, img.url, ct);
      await s3.send(new PutObjectCommand({ Bucket: cfg.s3.bucket, Key: key, Body: buf, ContentType: ct }));
      s3_url = `https://${cfg.s3.bucket}.s3.${cfg.s3.region}.amazonaws.com/${key}`;
    } catch (e) {
      s3_url = null; // 不阻断入库
    }
    out.push({ ...img, s3_url });
  }
  return out;
}
