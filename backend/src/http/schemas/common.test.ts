import { describe, expect, it } from 'vitest';
import { AnalyticsQuery } from './analytics.ts';
import { VenueBookingListQuery } from './bookings.ts';
import { LocalDate, queryPoint } from './common.ts';
import { DiaryDateParams } from './diary.ts';
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

const LOCAL_DATE_INPUTS = [
  ['diary date', DiaryDateParams.shape.date],
  ['venue bookings date', VenueBookingListQuery.shape.date],
  ['analytics from', AnalyticsQuery.shape.from],
  ['analytics to', AnalyticsQuery.shape.to],
] as const;

describe('local date', () => {
  it.each(LOCAL_DATE_INPUTS)('accepts a calendar date as the %s', (_name, schema) => {
    expect(schema.parse('2028-02-29')).toBe('2028-02-29');
  });

  it.each(LOCAL_DATE_INPUTS)('rejects anything else as the %s', (_name, schema) => {
    for (const value of ['2026-02-30', '25.09.2026', '']) {
      expect(schema.safeParse(value).error?.issues).toMatchObject([
        { message: 'expected a calendar date in YYYY-MM-DD format' },
      ]);
    }
  });

  it('keeps query dates optional and path dates required', () => {
    for (const schema of [VenueBookingListQuery, AnalyticsQuery]) {
      expect(schema.safeParse({}).success).toBe(true);
    }
    expect(DiaryDateParams.safeParse({}).success).toBe(false);
  });

  it('checks local dates in responses', () => {
    expect(LocalDate.parse('2026-09-25')).toBe('2026-09-25');
    expect(LocalDate.safeParse('2026-02-30').success).toBe(false);
  });
});
