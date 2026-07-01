// test/reconcile.test.js
import { describe, it, expect } from 'vitest';
import { reconcile } from '../src/reconcile.js';

describe('reconcile', () => {
  it('reports zero missing when all enqueued urls stored', () => {
    const r = reconcile(['a', 'b', 'c'], ['a', 'b', 'c']);
    expect(r.missing).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('lists missing urls and flags not-ok', () => {
    const r = reconcile(['a', 'b', 'c'], ['a', 'c']);
    expect(r.missing).toEqual(['b']);
    expect(r.ok).toBe(false);
    expect(r.expected).toBe(3);
    expect(r.stored).toBe(2);
  });
});
