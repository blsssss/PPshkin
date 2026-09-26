import { describe, expect, it } from 'vitest';
import { coarsePoint, distanceMeters, pointProblems, roundCoordinate } from './geo.ts';

describe('geo helpers', () => {
  it('measures distances between points in Kazan', () => {
    const baumana = { lat: 55.7887, lon: 49.1221 };
    const kremlin = { lat: 55.7983, lon: 49.1064 };
    expect(distanceMeters(baumana, kremlin)).toBeGreaterThan(1300);
    expect(distanceMeters(baumana, kremlin)).toBeLessThan(1500);
    expect(distanceMeters(baumana, baumana)).toBe(0);
  });

  it('coarsens coordinates to about a kilometre', () => {
    expect(roundCoordinate(55.78874)).toBe(55.79);
    expect(roundCoordinate(49.12213, 3)).toBe(49.122);
    expect(coarsePoint({ lat: 55.78874, lon: 49.12213 })).toEqual({ lat: 55.79, lon: 49.12 });
  });

  it('accepts coordinates within the WGS 84 bounds', () => {
    expect(pointProblems({ lat: 55.7887, lon: 49.1221 })).toEqual([]);
    expect(pointProblems({ lat: -90, lon: 180 })).toEqual([]);
    expect(pointProblems({ lat: 90, lon: -180 })).toEqual([]);
  });

  it('reports each coordinate out of bounds', () => {
    expect(pointProblems({ lat: 91, lon: -181 })).toEqual([
      { path: 'lat', message: 'must be from -90 to 90' },
      { path: 'lon', message: 'must be from -180 to 180' },
    ]);
    expect(pointProblems({ lat: 55.79, lon: Number.NaN })).toEqual([
      { path: 'lon', message: 'must be from -180 to 180' },
    ]);
  });
});
