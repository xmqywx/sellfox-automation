// test/mysql-sync.test.js
import { describe, it, expect, vi } from 'vitest';
import { openDb, upsertVehicle } from '../src/store/db.js';
import { syncRows } from '../src/store/mysql-sync.js';

describe('syncRows', () => {
  it('maps sqlite rows to mysql upsert calls', async () => {
    const db = openDb(':memory:');
    upsertVehicle(db, { vin: 'VIN1', registration: 'R1', make: 'Toyota', source_url: 'u', fetch_mode: 'cheerio' });
    const conn = { execute: vi.fn().mockResolvedValue([{}]) };
    const n = await syncRows(db, conn);
    expect(n).toBe(1);
    expect(conn.execute).toHaveBeenCalled();
    const sql = conn.execute.mock.calls[0][0];
    expect(sql).toMatch(/INSERT INTO car_crawler_manheim/i);
    db.close();
  });
});
