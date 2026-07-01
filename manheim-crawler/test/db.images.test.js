// test/db.images.test.js
import { describe, it, expect } from 'vitest';
import { openDb, upsertVehicle, insertImages } from '../src/store/db.js';

describe('insertImages', () => {
  it('inserts images linked to a vehicle', () => {
    const db = openDb(':memory:');
    const { id } = upsertVehicle(db, {
      vin: 'VIN1', registration: null, source_url: 'u', fetch_mode: 'cheerio',
    });
    insertImages(db, id, 'uuid1', [
      { url: 'http://a/1.jpg', s3_url: null },
      { url: 'http://a/2.jpg', s3_url: 's3://x/2.jpg' },
    ]);
    const n = db.prepare('SELECT COUNT(*) n FROM manheim_image WHERE manheim_id=?').get(id).n;
    expect(n).toBe(2);
    db.close();
  });

  it('is idempotent per (manheim_id,url) — re-run does not duplicate', () => {
    const db = openDb(':memory:');
    const { id } = upsertVehicle(db, { vin: 'VIN1', source_url: 'u', fetch_mode: 'cheerio' });
    insertImages(db, id, 'uuid1', [{ url: 'http://a/1.jpg', s3_url: null }]);
    insertImages(db, id, 'uuid1', [{ url: 'http://a/1.jpg', s3_url: 's3://x/1.jpg' }]);
    const n = db.prepare('SELECT COUNT(*) n FROM manheim_image WHERE manheim_id=?').get(id).n;
    expect(n).toBe(1);
    db.close();
  });
});
