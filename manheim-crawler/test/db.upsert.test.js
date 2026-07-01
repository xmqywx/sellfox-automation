// test/db.upsert.test.js
import { describe, it, expect } from 'vitest';
import { openDb, upsertVehicle } from '../src/store/db.js';

const car = (o) => ({
  vin: null, registration: null, make: 'Toyota', model: 'Corolla',
  source_url: 'u', fetch_mode: 'cheerio', ...o,
});

describe('upsertVehicle', () => {
  it('inserts a new vehicle and returns isNew=true', () => {
    const db = openDb(':memory:');
    const r = upsertVehicle(db, car({ vin: 'VIN1' }));
    expect(r.isNew).toBe(true);
    expect(typeof r.id).toBe('number');
    db.close();
  });

  it('matches existing by vin and updates (no duplicate row)', () => {
    const db = openDb(':memory:');
    upsertVehicle(db, car({ vin: 'VIN1', odometer: '100' }));
    const r2 = upsertVehicle(db, car({ vin: 'VIN1', odometer: '200' }));
    expect(r2.isNew).toBe(false);
    const count = db.prepare("SELECT COUNT(*) n FROM manheim WHERE vin='VIN1'").get().n;
    expect(count).toBe(1);
    const row = db.prepare("SELECT odometer FROM manheim WHERE vin='VIN1'").get();
    expect(row.odometer).toBe('200'); // 已更新
    db.close();
  });

  it('falls back to registration when vin is null', () => {
    const db = openDb(':memory:');
    upsertVehicle(db, car({ vin: null, registration: 'ABC123' }));
    const r2 = upsertVehicle(db, car({ vin: null, registration: 'ABC123' }));
    expect(r2.isNew).toBe(false);
    const count = db.prepare("SELECT COUNT(*) n FROM manheim WHERE registration='ABC123'").get().n;
    expect(count).toBe(1);
    db.close();
  });

  it('logs field_conflict when both keys present but map to different vin', () => {
    const db = openDb(':memory:');
    upsertVehicle(db, car({ vin: 'VINX', registration: 'REGX' }));
    // 新记录 rego 相同但 vin 不同 → 以 vin 为准新增，并告警
    upsertVehicle(db, car({ vin: 'VINY', registration: 'REGX' }));
    const conflicts = db.prepare("SELECT COUNT(*) n FROM failed_requests WHERE kind='field_conflict'").get().n;
    expect(conflicts).toBeGreaterThanOrEqual(1);
    db.close();
  });
});
