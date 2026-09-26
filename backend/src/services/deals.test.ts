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

describe('dealStatus', () => {
  it('is scheduled until the start and active from the start', () => {
    expect(dealStatus(deal, at('2026-09-25T09:59:59.999Z'))).toBe('scheduled');
    expect(dealStatus(deal, at('2026-09-25T10:00:00Z'))).toBe('active');
    expect(dealStatus(deal, at('2026-09-25T11:59:59.999Z'))).toBe('active');
  });

  it('ends exactly at the end time', () => {
    expect(dealStatus(deal, at('2026-09-25T12:00:00Z'))).toBe('ended');
  });

  it('is sold out when no portions are left, even after the end', () => {
    const soldOut = { ...deal, quantityLeft: 0 };
    expect(dealStatus(soldOut, at('2026-09-25T11:00:00Z'))).toBe('sold_out');
    expect(dealStatus(soldOut, at('2026-09-25T13:00:00Z'))).toBe('sold_out');
  });

  it('reports cancellation before anything else', () => {
    const cancelled = { ...deal, quantityLeft: 0, cancelledAt: at('2026-09-25T10:30:00Z') };
    expect(dealStatus(cancelled, at('2026-09-25T09:00:00Z'))).toBe('cancelled');
    expect(dealStatus(cancelled, at('2026-09-25T13:00:00Z'))).toBe('cancelled');
  });
});
