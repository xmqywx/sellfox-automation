import { describe, it, expect, vi } from 'vitest';
import { ensureItemIdColumn } from '../src/store/mysql-migrate.js';

// 按 SQL 内容分派返回值的假 conn
function fakeConn({ columnExists, indexDuplicate = false }) {
  const calls = [];
  const query = vi.fn(async (sql) => {
    calls.push({ sql });
    if (/information_schema/i.test(sql)) return [columnExists ? [{ COLUMN_NAME: 'item_id' }] : []];
    if (/CREATE INDEX/i.test(sql)) {
      if (indexDuplicate) throw new Error("Duplicate key name 'idx_manheim_item'");
      return [{}];
    }
    return [{}]; // ALTER
  });
  return { calls, query };
}

describe('ensureItemIdColumn', () => {
  it('does not ALTER when column exists, but still ensures the index', async () => {
    const conn = fakeConn({ columnExists: true });
    const r = await ensureItemIdColumn(conn, { dbName: 'nzcar_recycling_prod' });
    expect(r.added).toBe(false);
    expect(conn.calls.some((c) => /ALTER TABLE/i.test(c.sql))).toBe(false);
    expect(conn.calls.some((c) => /CREATE INDEX idx_manheim_item/i.test(c.sql))).toBe(true);
  });

  it('runs ALTER + CREATE INDEX when column is absent', async () => {
    const conn = fakeConn({ columnExists: false });
    const r = await ensureItemIdColumn(conn, { dbName: 'nzcar_recycling_prod' });
    expect(r.added).toBe(true);
    expect(conn.calls.some((c) => /ALTER TABLE car_crawler_manheim ADD COLUMN item_id/i.test(c.sql))).toBe(true);
    expect(conn.calls.some((c) => /CREATE INDEX idx_manheim_item/i.test(c.sql))).toBe(true);
  });

  it('swallows duplicate-index error (partial prior run)', async () => {
    const conn = fakeConn({ columnExists: true, indexDuplicate: true });
    const r = await ensureItemIdColumn(conn, { dbName: 'x' });
    expect(r.added).toBe(false); // no throw
  });
});
