import { describe, it, expect } from 'vitest';
import { load } from 'cheerio';
import { openDb, upsertVehicle } from '../src/store/db.js';
import { parseDetail } from '../src/crawler/detail.js';

describe('item_id fallback (no vin/rego vehicles)', () => {
  it('parseDetail extracts item_id from the source url', () => {
    const url = 'https://www.manheim.co.nz/damaged-vehicles/000000000007406563/2023-honda-trx520fm2-quad-bike?referringPage=AuctionListing';
    const { vehicle } = parseDetail(load('<html><body></body></html>'), url);
    expect(vehicle.item_id).toBe('000000000007406563');
  });

  it('upsert dedups by item_id when vin and rego are both absent', () => {
    const db = openDb(':memory:');
    const car = { item_id: 'ITEM123', make: 'Honda', model: 'TRX520', source_url: 'u', fetch_mode: 'curl' };
    const r1 = upsertVehicle(db, car);
    expect(r1.isNew).toBe(true);
    const r2 = upsertVehicle(db, { ...car, odometer: '10' });
    expect(r2.isNew).toBe(false);
    const n = db.prepare("SELECT COUNT(*) n FROM manheim WHERE item_id='ITEM123'").get().n;
    expect(n).toBe(1);
    const row = db.prepare("SELECT odometer FROM manheim WHERE item_id='ITEM123'").get();
    expect(row.odometer).toBe('10');
    db.close();
  });
});
