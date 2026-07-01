// src/crawler/fetcher.js
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fetchRenderedHtml as defaultRender } from './fallback.js';
import { needsFallback } from './selectors.js';

const execFileAsync = promisify(execFile);
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// 用系统 curl 抓取（当前放行网站的指纹拦截；-L 跟随重定向）。返回 { html, status }。
export async function curlFetch(url, { timeoutMs = 20000 } = {}) {
  const tmp = join(tmpdir(), `mh-${randomBytes(8).toString('hex')}.html`);
  try {
    const { stdout } = await execFileAsync('curl', [
      '-sL', '-A', UA, '--compressed',
      '--max-time', String(Math.ceil(timeoutMs / 1000)),
      '-o', tmp, '-w', '%{http_code}', url,
    ], { maxBuffer: 32 * 1024 * 1024 });
    const status = parseInt(String(stdout).trim(), 10) || 0;
    const html = await readFile(tmp, 'utf8').catch(() => '');
    return { html, status };
  } finally {
    await unlink(tmp).catch(() => {});
  }
}

// 统一 fetch：curl 快路径；非 200 或（详情页）内容不完整 → Playwright 兜底。
// deps 可注入 curlFetch / fetchRenderedHtml（测试用）。
export async function fetchHtml(url, { isDetail = false, deps = {} } = {}) {
  const _curl = deps.curlFetch || curlFetch;
  const _render = deps.fetchRenderedHtml || defaultRender;
  try {
    const { html, status } = await _curl(url);
    if (status === 200 && !(isDetail && needsFallback(html))) {
      return { html, status, mode: 'curl' };
    }
  } catch {
    // 落到 Playwright
  }
  const html = await _render(url, { waitSelector: 'body' });
  return { html, status: 200, mode: 'playwright' };
}
