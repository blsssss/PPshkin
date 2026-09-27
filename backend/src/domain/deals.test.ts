import { describe, expect, it } from 'vitest';
import { dealOverAt } from './deals.ts';

const at = (iso: string) => new Date(iso);
const ZERNO = { opensAt: '08:00', closesAt: '22:00', timezone: 'Europe/Moscow' };

describe('dealOverAt', () => {
  it('keeps the end of a deal that ends before the closing', () => {
    const deal = { startsAt: at('2026-09-27T15:00:00Z'), endsAt: at('2026-09-27T17:00:00Z') };
    expect(dealOverAt(deal, ZERNO)).toEqual(deal.endsAt);
  });

  it('ends a deal at the closing when its end time is later', () => {
    const deal = { startsAt: at('2026-09-27T18:48:00Z'), endsAt: at('2026-09-27T19:50:00Z') };
    expect(dealOverAt(deal, ZERNO)).toEqual(at('2026-09-27T19:00:00Z'));
  });

  it('ends a deal that starts while the venue is closed right at its start', () => {
    const afterClosing = { startsAt: at('2026-09-27T19:30:00Z'), endsAt: at('2026-09-27T20:30:00Z') };
    expect(dealOverAt(afterClosing, ZERNO)).toEqual(afterClosing.startsAt);
    const beforeOpening = { startsAt: at('2026-09-27T04:00:00Z'), endsAt: at('2026-09-27T19:00:00Z') };
    expect(dealOverAt(beforeOpening, ZERNO)).toEqual(beforeOpening.startsAt);
  });

  it('ends at a closing after midnight', () => {
    const deal = { startsAt: at('2026-09-27T20:30:00Z'), endsAt: at('2026-09-28T01:00:00Z') };
    const bar = { ...ZERNO, opensAt: '18:00', closesAt: '02:00' };
    expect(dealOverAt(deal, bar)).toEqual(at('2026-09-27T23:00:00Z'));
  });

  it('has no closing round the clock', () => {
    const deal = { startsAt: at('2026-09-27T21:30:00Z'), endsAt: at('2026-09-28T20:00:00Z') };
    expect(dealOverAt(deal, { ...ZERNO, opensAt: '00:00', closesAt: '00:00' })).toEqual(deal.endsAt);
  });
});
