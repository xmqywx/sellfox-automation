// test/config.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('applies defaults when env is empty', () => {
    const c = loadConfig({});
    expect(c.auctionId).toBe('ND060726');
    expect(c.franchiseId).toBe('SALVAGENZ');
    expect(c.maxConcurrency).toBe(4);
    expect(c.s3.enabled).toBe(false);
    expect(c.mysql.enabled).toBe(false);
  });

  it('reads overrides and coerces numbers/booleans', () => {
    const c = loadConfig({
      AUCTION_ID: 'ND999999',
      MAX_CONCURRENCY: '8',
      S3_ENABLED: 'true',
      S3_BUCKET: 'my-bucket',
    });
    expect(c.auctionId).toBe('ND999999');
    expect(c.maxConcurrency).toBe(8);
    expect(c.s3.enabled).toBe(true);
    expect(c.s3.bucket).toBe('my-bucket');
  });
});
