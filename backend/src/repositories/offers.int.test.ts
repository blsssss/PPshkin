import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestPool, resetDatabase, testPool } from '../../test/database.ts';
import { seedDeal, seedMenuItem, seedUser, seedVenue } from '../../test/venues.ts';
import type { Deal, MenuItem, OfferExplanation } from '../domain/models.ts';
import * as offers from './offers.ts';

const pool = testPool();
const now = new Date('2026-09-26T13:00:00Z');
const DAY = 86_400_000;
const GUEST = 101;
const OTHER = 102;

const daysAgo = (days: number) => new Date(now.getTime() - days * DAY);

const explanation: OfferExplanation = {
  headline: 'Можно позволить десерт',
  facts: ['Сегодня в дневнике ещё нет записей'],
  calculations: [
    'До ориентира 2000 ккал остаётся около 2000 ккал',
    'Скидка 50%: 100 ₽ вместо 200 ₽, до 18:00',
  ],
  assumptions: ['Калорийность приблизительная, это не медицинская рекомендация'],
  factors: [{ factor: 'fit', value: 0.4, weight: 0.3 }],
};

let eclair: MenuItem;
let croissant: MenuItem;
let deal: Deal;

async function show(userId: number, items: readonly MenuItem[], shownAt = now) {
  return offers.insertShown(pool, {
    userId,
    channel: 'miniapp',
    shownAt,
    offers: items.map((item) => ({
      venueId: item.venueId,
      menuItemId: item.id,
      dealId: null,
      score: 0.5,
      explanation,
    })),
  });
}

async function showOne(userId: number, item: MenuItem, shownAt = now) {
  const [offer] = await show(userId, [item], shownAt);
  if (!offer) throw new Error('offer was not stored');
  return offer;
}

async function accept(offerId: number) {
  await pool.query(`update offers set status = 'accepted', responded_at = $2 where id = $1`, [offerId, now]);
}

beforeEach(async () => {
  await resetDatabase(pool);
  await seedUser(pool, GUEST);
  await seedUser(pool, OTHER);
  const venue = await seedVenue(pool, 1);
  eclair = await seedMenuItem(pool, venue.id, { name: 'Эклер' });
  croissant = await seedMenuItem(pool, venue.id, { name: 'Круассан', category: 'bakery' });
  deal = await seedDeal(pool, eclair, { startsAt: daysAgo(0.1), endsAt: new Date(now.getTime() + DAY / 12) });
});

afterAll(async () => {
  await closeTestPool();
});

describe('offers repository', () => {
  it('stores a batch of shown offers in the given order with the whole explanation', async () => {
    const stored = await offers.insertShown(pool, {
      userId: GUEST,
      channel: 'bot',
      shownAt: now,
      offers: [
        { venueId: croissant.venueId, menuItemId: croissant.id, dealId: null, score: 0.61, explanation },
        { venueId: eclair.venueId, menuItemId: eclair.id, dealId: deal.id, score: 0.42, explanation },
      ],
    });
    expect(stored).toEqual([
      {
        id: expect.any(Number) as number,
        userId: GUEST,
        venueId: croissant.venueId,
        menuItemId: croissant.id,
        dealId: null,
        channel: 'bot',
        score: 0.61,
        explanation,
        status: 'shown',
        declineReason: null,
        createdAt: now,
        respondedAt: null,
      },
      expect.objectContaining({ menuItemId: eclair.id, dealId: deal.id, score: 0.42, explanation }),
    ]);
    expect(stored[1]!.id).toBeGreaterThan(stored[0]!.id);
    const { rows } = await pool.query<{ explanation: unknown }>('select explanation from offers order by id');
    expect(rows.map((row) => row.explanation)).toEqual([explanation, explanation]);
  });

  it('stores nothing for an empty batch', async () => {
    expect(await show(GUEST, [])).toEqual([]);
    const { rows } = await pool.query('select id from offers');
    expect(rows).toEqual([]);
  });

  it('declines only own offers that are not accepted and lets a decline be repeated', async () => {
    const offer = await showOne(GUEST, eclair);
    expect(await offers.decline(pool, { id: offer.id, userId: OTHER, reason: 'dislike', at: now })).toBe(
      false,
    );
    expect(await offers.findStatus(pool, OTHER, offer.id)).toBeNull();
    expect(await offers.findStatus(pool, GUEST, offer.id)).toBe('shown');

    expect(await offers.decline(pool, { id: offer.id, userId: GUEST, reason: 'not_today', at: now })).toBe(
      true,
    );
    const later = new Date(now.getTime() + 60_000);
    expect(await offers.decline(pool, { id: offer.id, userId: GUEST, reason: 'dislike', at: later })).toBe(
      true,
    );
    const { rows } = await pool.query(
      'select status, decline_reason, responded_at from offers where id = $1',
      [offer.id],
    );
    expect(rows).toEqual([{ status: 'declined', decline_reason: 'dislike', responded_at: later }]);

    const booked = await showOne(GUEST, croissant);
    await accept(booked.id);
    expect(await offers.decline(pool, { id: booked.id, userId: GUEST, reason: 'dislike', at: now })).toBe(
      false,
    );
    expect(await offers.findStatus(pool, GUEST, booked.id)).toBe('accepted');
    expect(await offers.findStatus(pool, GUEST, booked.id + 100)).toBeNull();
  });

  it('lists distinct items shown to the user since a moment', async () => {
    await showOne(GUEST, eclair, daysAgo(1));
    await show(GUEST, [croissant, eclair], daysAgo(0.25));
    await showOne(GUEST, croissant);
    await showOne(OTHER, eclair);
    expect(await offers.listItemsShownSince(pool, GUEST, daysAgo(0.5))).toEqual([eclair.id, croissant.id]);
    expect(await offers.listItemsShownSince(pool, GUEST, now)).toEqual([croissant.id]);
    expect(await offers.listItemsShownSince(pool, OTHER, daysAgo(2))).toEqual([eclair.id]);
    expect(await offers.listItemsShownSince(pool, GUEST, new Date(now.getTime() + 1))).toEqual([]);
  });

  it('lists items hidden by a decline within the window of its reason', async () => {
    const since = { not_today: daysAgo(3), dislike: daysAgo(30) };
    const declineAt = async (userId: number, item: MenuItem, reason: 'not_today' | 'dislike', at: Date) => {
      const offer = await showOne(userId, item, at);
      await offers.decline(pool, { id: offer.id, userId, reason, at });
      return offer;
    };

    await declineAt(GUEST, eclair, 'not_today', daysAgo(3));
    await declineAt(GUEST, croissant, 'dislike', daysAgo(30));
    await showOne(GUEST, eclair);
    await declineAt(OTHER, eclair, 'dislike', now);
    expect(await offers.listItemsDeclinedSince(pool, GUEST, since)).toEqual([]);

    await declineAt(GUEST, croissant, 'not_today', daysAgo(2.9));
    expect(await offers.listItemsDeclinedSince(pool, GUEST, since)).toEqual([croissant.id]);

    const disliked = await declineAt(GUEST, eclair, 'dislike', daysAgo(29));
    expect(await offers.listItemsDeclinedSince(pool, GUEST, since)).toEqual([eclair.id, croissant.id]);

    await accept(disliked.id);
    expect(await offers.listItemsDeclinedSince(pool, GUEST, since)).toEqual([croissant.id]);
    expect(await offers.listItemsDeclinedSince(pool, OTHER, since)).toEqual([eclair.id]);
  });
});
