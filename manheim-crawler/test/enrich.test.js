import { describe, it, expect } from 'vitest';
import { enrichVehicle } from '../src/crawler/enrich.js';

describe('enrichVehicle', () => {
  it('sets uuid to the auction id and plan_type to Salvage', () => {
    const v = { vin: 'X', make: 'Toyota' };
    enrichVehicle(v, { auctionId: 'ND130726' });
    expect(v.uuid).toBe('ND130726');
    expect(v.plan_type).toBe('Salvage');
  });

  it('does not overwrite an existing non-null uuid/plan_type', () => {
    const v = { uuid: 'KEEP', plan_type: 'Other' };
    enrichVehicle(v, { auctionId: 'ND130726' });
    expect(v.uuid).toBe('KEEP');
    expect(v.plan_type).toBe('Other');
  });
});
