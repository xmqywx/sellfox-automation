import { describe, it, expect, vi } from 'vitest';
import { openDb, upsertVehicle, insertImages } from '../src/store/db.js';
import { syncRows } from '../src/store/mysql-sync.js';

function fakeConn({ existing = false, insertId = 777 }) {
  const calls = [];
  const execute = vi.fn(async (sql, params) => {
    calls.push({ sql, params });
    if (/SELECT id FROM car_crawler_manheim/i.test(sql)) return [existing ? [{ id: 1 }] : []];
    if (/^INSERT INTO car_crawler_manheim \(/i.test(sql)) return [{ insertId }];
    if (/^INSERT INTO car_crawler_manheim_image/i.test(sql)) return [{ insertId: 0 }];
    return [[]];
  });
  return { calls, execute };
}

function seed() {
  const db = openDb(':memory:');
  const { id } = upsertVehicle(db, { uuid: 'ND130726', plan_type: 'Salvage', vin: 'VIN1', registration: 'R1', make: 'Toyota', item_id: 'IT1', source_url: 'u', fetch_mode: 'curl' });
  insertImages(db, id, 'ND130726', [{ url: 'http://a/1.jpg', s3_url: null }]);
  return db;
}

describe('syncRows (SELECT-先查-不存在才插)', () => {
  it('inserts new car + image with the MySQL insertId as manheim_id', async () => {
    const db = seed();
    const conn = fakeConn({ existing: false, insertId: 777 });
    const r = await syncRows(db, conn);
    expect(r).toEqual({ inserted: 1, skipped: 0 });
    const carInsert = conn.calls.find((c) => /^INSERT INTO car_crawler_manheim \(/i.test(c.sql));
    expect(carInsert.sql).toMatch(/item_id/);
    expect(carInsert.sql).toMatch(/'System'/); // create_by/update_by
    const imgInsert = conn.calls.find((c) => /image/i.test(c.sql));
    expect(imgInsert.params[1]).toBe(777); // manheim_id = MySQL insertId, NOT sqlite id
    db.close();
  });

  it('skips existing car (no INSERT) and does not update', async () => {
    const db = seed();
    const conn = fakeConn({ existing: true });
    const r = await syncRows(db, conn);
    expect(r).toEqual({ inserted: 0, skipped: 1 });
    expect(conn.calls.some((c) => /^INSERT INTO/i.test(c.sql))).toBe(false);
    expect(conn.calls.some((c) => /UPDATE/i.test(c.sql))).toBe(false);
    db.close();
  });
});
