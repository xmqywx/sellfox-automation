// test/detail.test.js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { load } from 'cheerio';
import { parseDetail } from '../src/crawler/detail.js';

const html = readFileSync(new URL('./fixtures/detail.html', import.meta.url), 'utf8');

describe('parseDetail', () => {
  it('extracts real vin/make/registration from the recon detail page', () => {
    const { vehicle } = parseDetail(load(html), 'http://example/detail');
    // 真实值来自 test/fixtures/detail.html（2002 Honda Fit），见 docs-recon.md
    expect(vehicle.vin).toBe('7A88G2Y0709142004');
    expect(vehicle.registration).toBe('EYT484');
    expect(vehicle.make).toBe('Honda');
    expect(vehicle.source_url).toBe('http://example/detail');
  });

  it('extracts image urls (may be empty but must be an array)', () => {
    const { images } = parseDetail(load(html), 'http://example/detail');
    expect(Array.isArray(images)).toBe(true);
    expect(images.length).toBeGreaterThan(0);
    expect(images[0].url).toMatch(/^https?:\/\//);
  });
});
