import { describe, expect, it } from 'vitest';
import { addDays } from '../shared/time.ts';
import { demoAccountVenue, loadDemoDataset } from './dataset.ts';
import { ANALYTICS_HISTORY, planHistoryDay, type HistoryOffer } from './history.ts';
import { dealWindows, openingPeriod } from './windows.ts';

const zerno = demoAccountVenue(await loadDemoDataset());
const MINUTE = 60_000;

function planDay(index: number, templates = zerno.dealTemplates): HistoryOffer[] {
  const date = addDays('2026-09-26', index - ANALYTICS_HISTORY.length);
  return planHistoryDay({
    counts: ANALYTICS_HISTORY[index]!,
    dayIndex: index,
    menuItemIds: zerno.menu.map((item) => item.id),
    templates,
    windows: dealWindows(zerno, date),
    opening: openingPeriod(zerno, date),
  });
}

const week = ANALYTICS_HISTORY.map((_, index) => planDay(index));
const bookingsOf = (offers: readonly HistoryOffer[]) =>
  offers.flatMap((offer) => (offer.booking ? [offer] : []));

describe('analytics history', () => {
  it('adds up to the week from the issue', () => {
    const offers = week.flat();
    const booked = bookingsOf(offers);
    const redeemed = booked.filter((offer) => offer.booking?.status === 'redeemed');
    expect({
      shows: offers.length,
      bookings: booked.length,
      redeemed: redeemed.length,
      redeemedWithDeal: redeemed.filter((offer) => offer.deal !== null).length,
      expired: booked.filter((offer) => offer.booking?.status === 'expired').length,
      cancelled: booked.filter((offer) => offer.booking?.status === 'cancelled').length,
    }).toEqual({ shows: 57, bookings: 21, redeemed: 16, redeemedWithDeal: 11, expired: 3, cancelled: 2 });
  });

  it('follows the counts of every day', () => {
    week.forEach((offers, index) => {
      const counts = ANALYTICS_HISTORY[index]!;
      const statuses = bookingsOf(offers).map((offer) => [offer.booking?.status, offer.deal !== null]);
      expect(offers).toHaveLength(counts.shows);
      expect(statuses.filter(([status, deal]) => status === 'redeemed' && deal)).toHaveLength(
        counts.redeemedWithDeal,
      );
      expect(statuses.filter(([status, deal]) => status === 'redeemed' && !deal)).toHaveLength(
        counts.redeemedWithoutDeal,
      );
      expect(statuses.filter(([status]) => status === 'expired')).toHaveLength(counts.expired);
      expect(statuses.filter(([status]) => status === 'cancelled')).toHaveLength(counts.cancelled);
    });
  });

  it('books deal items inside their window and other items without a deal', () => {
    const dealItems = new Map(zerno.dealTemplates.map((template) => [template.window, template.menuItemId]));
    week.forEach((offers, index) => {
      const date = addDays('2026-09-26', index - ANALYTICS_HISTORY.length);
      const windows = new Map(dealWindows(zerno, date).map((window) => [window.name, window]));
      for (const offer of bookingsOf(offers)) {
        const booking = offer.booking!;
        if (offer.deal === null) {
          expect([...dealItems.values()]).not.toContain(offer.menuItemId);
          continue;
        }
        const window = windows.get(offer.deal)!;
        expect(offer.menuItemId).toBe(dealItems.get(offer.deal));
        expect(booking.createdAt >= window.startsAt && booking.createdAt < window.endsAt).toBe(true);
        expect(booking.expiresAt <= window.endsAt).toBe(true);
      }
    });
  });

  it('keeps every offer and booking inside the opening hours with consistent times', () => {
    week.forEach((offers, index) => {
      const opening = openingPeriod(zerno, addDays('2026-09-26', index - ANALYTICS_HISTORY.length));
      for (const offer of offers) {
        expect(offer.createdAt >= opening.from && offer.createdAt < opening.to).toBe(true);
        expect(offer.score).toBeGreaterThan(0.5);
        expect(offer.score).toBeLessThan(0.9);
        const booking = offer.booking;
        if (!booking) continue;
        expect(booking.createdAt.getTime() - offer.createdAt.getTime()).toBe(3 * MINUTE);
        expect(booking.expiresAt.getTime() - booking.createdAt.getTime()).toBe(60 * MINUTE);
        const resolvedAfter = { redeemed: 15, cancelled: 20, expired: 60 }[booking.status];
        expect(booking.resolvedAt.getTime() - booking.createdAt.getTime()).toBe(resolvedAfter * MINUTE);
      }
      const times = offers.map((offer) => offer.createdAt.getTime());
      expect(times).toEqual(times.toSorted((left, right) => left - right));
    });
  });

  it('mixes the bot and the mini app', () => {
    const channels = week.flat().map((offer) => offer.channel);
    expect(channels.filter((channel) => channel === 'bot').length).toBeGreaterThan(20);
    expect(channels.filter((channel) => channel === 'miniapp').length).toBeGreaterThan(20);
  });

  it('books without deals when the venue has no deal templates', () => {
    const offers = planDay(0, []);
    const booked = bookingsOf(offers);
    expect(booked).toHaveLength(3);
    expect(booked.every((offer) => offer.deal === null)).toBe(true);
    expect(offers.every((offer) => offer.deal === null)).toBe(true);
  });
});
