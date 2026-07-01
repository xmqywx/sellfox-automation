// test/db.schema.test.js
import { describe, it, expect } from 'vitest';
import { openDb } from '../src/store/db.js';

describe('openDb', () => {
  it('creates the three tables', () => {
    const db = openDb(':memory:');
    const names = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => r.name);
    expect(names).toContain('manheim');
    expect(names).toContain('manheim_image');
    expect(names).toContain('failed_requests');
    db.close();
  });

  it('manheim table has vin and registration columns', () => {
    const db = openDb(':memory:');
    const cols = db.prepare('PRAGMA table_info(manheim)').all().map((c) => c.name);
    expect(cols).toContain('vin');
    expect(cols).toContain('registration');
    expect(cols).toContain('last_seen');
    expect(cols).toContain('fetch_mode');
    db.close();
  });
});
