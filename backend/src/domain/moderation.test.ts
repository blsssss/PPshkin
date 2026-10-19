import { describe, expect, it } from 'vitest';
import { venueSignal, type VenueSignalStats } from './moderation.ts';

const base: VenueSignalStats = { venueId: 1, name: 'Зерно', openComplaints: 0, bookings: 0, redeemed: 0 };

describe('venueSignal', () => {
  it('stays quiet for a healthy venue', () => {
    expect(venueSignal({ ...base, openComplaints: 2, bookings: 20, redeemed: 10 })).toBeNull();
  });

  it('flags three open complaints', () => {
    expect(venueSignal({ ...base, openComplaints: 3 })?.reasons).toEqual(['open_complaints']);
  });

  it('flags a redeem rate below 0.3 from ten bookings', () => {
    expect(venueSignal({ ...base, bookings: 10, redeemed: 2 })?.reasons).toEqual(['low_redeem_rate']);
  });

  it('ignores a low redeem rate on fewer than ten bookings and a rate of exactly 0.3', () => {
    expect(venueSignal({ ...base, bookings: 9, redeemed: 0 })).toBeNull();
    expect(venueSignal({ ...base, bookings: 10, redeemed: 3 })).toBeNull();
  });

  it('reports both reasons together', () => {
    expect(venueSignal({ ...base, openComplaints: 4, bookings: 10, redeemed: 0 })?.reasons).toEqual([
      'open_complaints',
      'low_redeem_rate',
    ]);
  });
});
