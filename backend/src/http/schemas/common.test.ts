import { describe, expect, it } from 'vitest';
import { queryPoint } from './common.ts';
import { RecommendationsQuery } from './recommendations.ts';
import { NearbyQuery } from './venues.ts';

const POINT_QUERIES = [
  ['catalog', NearbyQuery],
  ['recommendations', RecommendationsQuery],
] as const;

describe('point query', () => {
  it.each(POINT_QUERIES)('reads the %s point the same way', (_name, schema) => {
    expect(schema.parse({ lat: '55.79', lon: '49.12' })).toMatchObject({ lat: 55.79, lon: 49.12 });
    const blank = schema.parse({ lat: '', lon: '' });
    expect([blank.lat, blank.lon]).toEqual([undefined, undefined]);
  });

  it.each(POINT_QUERIES)('requires lat and lon together in the %s query', (_name, schema) => {
    for (const query of [{ lat: '55.79' }, { lon: '49.12' }, { lat: '', lon: '49.12' }]) {
      expect(schema.safeParse(query).error?.issues).toMatchObject([
        { path: ['lon'], message: 'Pass lat and lon together' },
      ]);
    }
  });

  it.each(POINT_QUERIES)('keeps the %s coordinates within WGS 84 bounds', (_name, schema) => {
    expect(schema.safeParse({ lat: '91', lon: '49.12' }).error?.issues).toMatchObject([{ path: ['lat'] }]);
    expect(schema.safeParse({ lat: '55.79', lon: '-181' }).error?.issues).toMatchObject([{ path: ['lon'] }]);
  });

  it('turns a parsed query into a point only when both coordinates are present', () => {
    expect(queryPoint({ lat: 55.79, lon: 49.12 })).toEqual({ lat: 55.79, lon: 49.12 });
    expect(queryPoint({ lat: 0, lon: 0 })).toEqual({ lat: 0, lon: 0 });
    expect(queryPoint({ lat: 55.79 })).toBeNull();
    expect(queryPoint({})).toBeNull();
  });
});
