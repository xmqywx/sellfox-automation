// test/fetcher.test.js
import { describe, it, expect, vi } from 'vitest';
import { fetchHtml, curlFetch } from '../src/crawler/fetcher.js';

describe('fetchHtml (降级逻辑, 注入 deps)', () => {
  it('uses curl result when status 200 and content ok', async () => {
    const deps = {
      curlFetch: vi.fn().mockResolvedValue({ html: '<html>vehicle-details ok</html>', status: 200 }),
      fetchRenderedHtml: vi.fn(),
    };
    const r = await fetchHtml('http://x/detail', { isDetail: true, deps });
    expect(r.mode).toBe('curl');
    expect(deps.fetchRenderedHtml).not.toHaveBeenCalled();
  });

  it('falls back to playwright when curl returns non-200', async () => {
    const deps = {
      curlFetch: vi.fn().mockResolvedValue({ html: '', status: 403 }),
      fetchRenderedHtml: vi.fn().mockResolvedValue('<html>rendered vehicle-details</html>'),
    };
    const r = await fetchHtml('http://x/detail', { isDetail: true, deps });
    expect(r.mode).toBe('playwright');
    expect(deps.fetchRenderedHtml).toHaveBeenCalledOnce();
  });

  it('falls back when detail content lacks presence marker', async () => {
    const deps = {
      curlFetch: vi.fn().mockResolvedValue({ html: '<html>empty shell</html>', status: 200 }),
      fetchRenderedHtml: vi.fn().mockResolvedValue('<html>rendered vehicle-details</html>'),
    };
    const r = await fetchHtml('http://x/detail', { isDetail: true, deps });
    expect(r.mode).toBe('playwright');
  });
});

describe('curlFetch (网络冒烟)', () => {
  it('fetches the real listing page (200 + vehicle-item)', async () => {
    const { html, status } = await curlFetch(
      'https://www.manheim.co.nz/damaged-vehicles/auctions/ND060726/page1?franchiseID=SALVAGENZ'
    );
    expect(status).toBe(200);
    expect(html).toContain('vehicle-item');
  });
});
