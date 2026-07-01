// test/listing.test.js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { load } from 'cheerio';
import { buildListingUrl, parseListing } from '../src/crawler/listing.js';

const html = readFileSync(new URL('./fixtures/listing.html', import.meta.url), 'utf8');

describe('listing', () => {
  it('builds a paged listing url', () => {
    const url = buildListingUrl({
      baseUrl: 'https://www.manheim.co.nz', auctionId: 'ND060726', franchiseId: 'SALVAGENZ',
    }, 2);
    expect(url).toBe('https://www.manheim.co.nz/damaged-vehicles/auctions/ND060726/page2?franchiseID=SALVAGENZ');
  });

  it('parses detail urls from a real listing page (non-empty)', () => {
    const { detailUrls } = parseListing(load(html), 'https://www.manheim.co.nz');
    expect(detailUrls.length).toBeGreaterThan(0);
    expect(detailUrls[0]).toMatch(/^https?:\/\//);
  });

  it('reports whether there is a next page', () => {
    const { hasNext } = parseListing(load(html), 'https://www.manheim.co.nz');
    expect(typeof hasNext).toBe('boolean');
  });
});
