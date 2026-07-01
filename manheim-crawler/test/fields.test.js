// test/fields.test.js
import { describe, it, expect } from 'vitest';
import { applyPair, FIELD_MAP } from '../src/crawler/fields.js';

describe('fields', () => {
  it('maps known labels (strips trailing colon) to columns', () => {
    const v = {};
    applyPair(v, 'Build Year:', '2015');
    applyPair(v, 'Make', 'Toyota');
    applyPair(v, 'VIN', 'JT123');
    expect(v.year).toBe('2015');
    expect(v.make).toBe('Toyota');
    expect(v.vin).toBe('JT123');
  });

  it('ignores unknown labels', () => {
    const v = {};
    applyPair(v, 'Totally Unknown', 'x');
    expect(v).toEqual({});
  });

  it('FIELD_MAP covers all labels the legacy Java switch handled', () => {
    for (const label of ['Build Year','Make','Body Type','Model','Body Colour',
      'Variant','Doors','Seats','Odometer','Transmission','Engine','Fuel Type',
      'Registration','VIN','No of Keys','Seller Type']) {
      expect(FIELD_MAP[label]).toBeTruthy();
    }
  });
});
