// test/fallback.test.js
import { describe, it, expect, afterAll } from 'vitest';
import { pathToFileURL } from 'node:url';
import { fetchRenderedHtml, closeBrowser } from '../src/crawler/fallback.js';

afterAll(async () => { await closeBrowser(); });

describe('fallback', () => {
  it('returns rendered html for a page', async () => {
    const fileUrl = pathToFileURL(new URL('./fixtures/detail.html', import.meta.url).pathname).href;
    const html = await fetchRenderedHtml(fileUrl);
    expect(typeof html).toBe('string');
    expect(html.length).toBeGreaterThan(0);
  });
});
