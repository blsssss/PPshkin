import { describe, expect, it } from 'vitest';
import type { Deal } from '../domain/models.ts';
import { dealStatus } from './deals.ts';

const deal: Deal = {
  id: 1,
  venueId: 1,
  menuItemId: 1,
  priceRub: 120,
  quantityTotal: 5,
  quantityLeft: 3,
  startsAt: new Date('2026-09-25T10:00:00Z'),
  endsAt: new Date('2026-09-25T12:00:00Z'),
  cancelledAt: null,
  createdAt: new Date('2026-09-25T09:00:00Z'),
};

const at = (iso: string) => new Date(iso);
const ZERNO = { opensAt: '08:00', closesAt: '22:00', timezone: 'Europe/Moscow' };

describe('dealStatus', () => {
  it('is scheduled until the start and active from the start', () => {
    expect(dealStatus(deal, ZERNO, at('2026-09-25T09:59:59.999Z'))).toBe('scheduled');
    expect(dealStatus(deal, ZERNO, at('2026-09-25T10:00:00Z'))).toBe('active');
    expect(dealStatus(deal, ZERNO, at('2026-09-25T11:59:59.999Z'))).toBe('active');
  });

  it('ends exactly at the end time', () => {
    expect(dealStatus(deal, ZERNO, at('2026-09-25T12:00:00Z'))).toBe('ended');
  });

  it('ends at the closing of the venue when the end time is later', () => {
    const late = { ...deal, startsAt: at('2026-09-25T18:48:00Z'), endsAt: at('2026-09-25T19:50:00Z') };
    expect(dealStatus(late, ZERNO, at('2026-09-25T18:59:59.999Z'))).toBe('active');
    expect(dealStatus(late, ZERNO, at('2026-09-25T19:00:00Z'))).toBe('ended');
    const allDay = { ...ZERNO, opensAt: '00:00', closesAt: '00:00' };
    expect(dealStatus(late, allDay, at('2026-09-25T19:30:00Z'))).toBe('active');
  });

  it('is sold out when no portions are left, even after the end', () => {
    const soldOut = { ...deal, quantityLeft: 0 };
    expect(dealStatus(soldOut, ZERNO, at('2026-09-25T11:00:00Z'))).toBe('sold_out');
    expect(dealStatus(soldOut, ZERNO, at('2026-09-25T13:00:00Z'))).toBe('sold_out');
  });

  it('reports cancellation before anything else', () => {
    const cancelled = { ...deal, quantityLeft: 0, cancelledAt: at('2026-09-25T10:30:00Z') };
    expect(dealStatus(cancelled, ZERNO, at('2026-09-25T09:00:00Z'))).toBe('cancelled');
    expect(dealStatus(cancelled, ZERNO, at('2026-09-25T13:00:00Z'))).toBe('cancelled');
  });
});
