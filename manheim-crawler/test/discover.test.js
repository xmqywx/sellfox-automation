import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseAuctionsFromHtml } from '../src/crawler/discover.js';

const rendered = readFileSync(new URL('./fixtures/homepage-rendered.html', import.meta.url), 'utf8');
const broken = readFileSync(new URL('./fixtures/homepage-broken.html', import.meta.url), 'utf8');

describe('parseAuctionsFromHtml', () => {
  it('extracts SALVAGENZ auction codes only (real values from fixture)', () => {
    const list = parseAuctionsFromHtml(rendered);
    const codes = list.map((a) => a.code);
    expect(list.length).toBeGreaterThan(0);
    for (const a of list) expect(a.code).toMatch(/^[A-Z]{2}[0-9]{6}$/);
    // 真值：fixture（2026-10-16 抓取）里真实存在的 SALVAGENZ 代码
    expect(codes).toContain('ND191026');
    // 过滤生效：fixture 里的 passenger 代码不应出现（它不是 SALVAGENZ）
    expect(codes).not.toContain('PS201026');
  });

  it('throws (not returns []) when structure is broken / nothing parsed', () => {
    expect(() => parseAuctionsFromHtml(broken)).toThrow(/structure|no .*auction/i);
  });
});
