// test/s3.test.js
import { describe, it, expect, vi } from 'vitest';
import { uploadImages } from '../src/media/s3.js';

const cfgOn = { s3: { enabled: true, bucket: 'b', region: 'r', prefix: 'manheim/' } };
const cfgOff = { s3: { enabled: false } };

describe('uploadImages', () => {
  it('skips upload and keeps s3_url null when disabled', async () => {
    const out = await uploadImages([{ url: 'http://a/1.jpg', s3_url: null }], cfgOff, {});
    expect(out[0].s3_url).toBe(null);
  });

  it('downloads and uploads each image when enabled', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(8), headers: new Map([['content-type', 'image/jpeg']]) });
    const send = vi.fn().mockResolvedValue({});
    const out = await uploadImages(
      [{ url: 'http://a/1.jpg', s3_url: null }],
      cfgOn,
      { fetchFn, s3Client: { send } }
    );
    expect(fetchFn).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledOnce();
    expect(out[0].s3_url).toContain('manheim/');
  });

  it('does not throw and keeps null when a download fails', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('net'));
    const out = await uploadImages([{ url: 'http://a/1.jpg', s3_url: null }], cfgOn, { fetchFn, s3Client: { send: vi.fn() } });
    expect(out[0].s3_url).toBe(null);
  });
});
