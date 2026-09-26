import { describe, expect, it } from 'vitest';
import type { GeoPoint } from '../domain/models.ts';
import { distanceMeters } from '../shared/geo.ts';
import { DEMO_CITY_CENTER, DEMO_FAR_DISTANCE_M, resolveDemoPoint } from './location.ts';

const MOSCOW: GeoPoint = { lat: 55.7558, lon: 37.6173 };
const KAZAN_ARENA: GeoPoint = { lat: 55.8209, lon: 49.1607 };
const ZELENODOLSK: GeoPoint = { lat: 55.8466, lon: 48.5013 };

describe('resolveDemoPoint', () => {
  it('replaces a point far from Kazan with the demo city centre', () => {
    expect(resolveDemoPoint(MOSCOW, true)).toEqual({ point: DEMO_CITY_CENTER, demoCenterUsed: true });
  });

  it('keeps a point in or near Kazan', () => {
    expect(resolveDemoPoint(KAZAN_ARENA, true)).toEqual({ point: KAZAN_ARENA, demoCenterUsed: false });
    expect(distanceMeters(ZELENODOLSK, DEMO_CITY_CENTER)).toBeLessThan(DEMO_FAR_DISTANCE_M);
    expect(resolveDemoPoint(ZELENODOLSK, true)).toEqual({ point: ZELENODOLSK, demoCenterUsed: false });
  });

  it('keeps a point exactly at the limit and replaces one just beyond it', () => {
    const northBy = (metres: number): GeoPoint => ({
      lat: DEMO_CITY_CENTER.lat + (metres / 6_371_000) * (180 / Math.PI),
      lon: DEMO_CITY_CENTER.lon,
    });
    expect(resolveDemoPoint(northBy(DEMO_FAR_DISTANCE_M - 1), true).demoCenterUsed).toBe(false);
    expect(resolveDemoPoint(northBy(DEMO_FAR_DISTANCE_M + 1), true).demoCenterUsed).toBe(true);
  });

  it('leaves an unknown point unknown', () => {
    expect(resolveDemoPoint(null, true)).toEqual({ point: null, demoCenterUsed: false });
  });

  it('never replaces anything outside demo mode', () => {
    expect(resolveDemoPoint(MOSCOW, false)).toEqual({ point: MOSCOW, demoCenterUsed: false });
    expect(resolveDemoPoint(null, false)).toEqual({ point: null, demoCenterUsed: false });
  });
});
