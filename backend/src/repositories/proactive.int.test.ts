import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestPool, resetDatabase, testPool } from '../../test/database.ts';
import { BAUMANA, seedMenuItem, seedVenue } from '../../test/venues.ts';
import { CONSENT_DOCUMENTS } from '../domain/consents.ts';
import type { MenuItem, OfferExplanation } from '../domain/models.ts';
import type { ConsentKind, OfferChannel } from '../domain/vocabulary.ts';
import * as consents from './consents.ts';
import * as offers from './offers.ts';
import { discardUnsentOffer, findProactiveCandidates } from './proactive.ts';
import * as users from './users.ts';

const pool = testPool();
const now = new Date('2026-09-26T13:00:00Z');
const HOUR = 3_600_000;
const ago = (ms: number) => new Date(now.getTime() - ms);
const consentVersions = {
  personal_data: CONSENT_DOCUMENTS.personal_data.version,
  personalized_offers: CONSENT_DOCUMENTS.personalized_offers.version,
};

const explanation: OfferExplanation = {
  headline: 'Можно позволить десерт',
  facts: [],
  calculations: [],
  assumptions: [],
  factors: [],
};

let eclair: MenuItem;

interface GuestSeed {
  consents?: readonly ConsentKind[];
  locatedAt?: Date | null;
  timezone?: string;
}

async function seedGuest(id: number, seed: GuestSeed = {}): Promise<void> {
  await users.upsert(pool, { id, firstName: null, username: null });
  if (seed.timezone) await users.updateProfile(pool, id, { timezone: seed.timezone });
  const locatedAt = seed.locatedAt === undefined ? ago(HOUR) : seed.locatedAt;
  if (locatedAt) await users.setLocation(pool, id, BAUMANA, locatedAt);
  for (const kind of seed.consents ?? ['personal_data', 'personalized_offers']) {
    await consents.grant(pool, id, kind, CONSENT_DOCUMENTS[kind].version, 'bot', ago(48 * HOUR));
  }
}

async function showOffer(userId: number, channel: OfferChannel, shownAt: Date): Promise<number> {
  const [offer] = await offers.insertShown(pool, {
    userId,
    channel,
    shownAt,
    offers: [{ venueId: eclair.venueId, menuItemId: eclair.id, dealId: null, score: 0.7, explanation }],
  });
  if (!offer) throw new Error('offer was not stored');
  return offer.id;
}

const candidates = (limit = 50, afterUserId?: number) =>
  findProactiveCandidates(pool, {
    now,
    consentVersions,
    limit,
    ...(afterUserId === undefined ? {} : { afterUserId }),
  });

const ids = async (limit?: number, afterUserId?: number) =>
  (await candidates(limit, afterUserId)).map((candidate) => candidate.userId);

beforeEach(async () => {
  await resetDatabase(pool);
  const venue = await seedVenue(pool, 1);
  eclair = await seedMenuItem(pool, venue.id);
});

afterAll(async () => {
  await closeTestPool();
});

describe('findProactiveCandidates', () => {
  it('returns guests who agreed to both current consents with a fresh location', async () => {
    await seedGuest(101, { timezone: 'Asia/Yekaterinburg' });

    expect(await candidates()).toEqual([{ userId: 101, timezone: 'Asia/Yekaterinburg' }]);
  });

  it('needs both consents in their current versions and not withdrawn', async () => {
    await seedGuest(101);
    await seedGuest(102, { consents: ['personal_data'] });
    await seedGuest(103, { consents: ['personalized_offers'] });
    await seedGuest(104, { consents: ['personal_data'] });
    await consents.grant(pool, 104, 'personalized_offers', '2020-01-01', 'bot', ago(48 * HOUR));
    await seedGuest(105);
    await consents.revoke(pool, 105, 'personalized_offers', ago(HOUR));
    await seedGuest(106, { consents: ['personalized_offers'] });
    await consents.grant(pool, 106, 'personal_data', '2020-01-01', 'bot', ago(48 * HOUR));

    expect(await ids()).toEqual([101]);
  });

  it('never picks demo accounts', async () => {
    await seedGuest(-1001);
    await seedGuest(101);

    expect(await ids()).toEqual([101]);
  });

  it('needs a location updated within the last 12 hours', async () => {
    await seedGuest(101, { locatedAt: ago(12 * HOUR) });
    await seedGuest(102, { locatedAt: ago(12 * HOUR + 1_000) });
    await seedGuest(103, { locatedAt: null });

    expect(await ids()).toEqual([101]);
  });

  it('skips guests who got a proactive offer within 24 hours', async () => {
    await seedGuest(101);
    await seedGuest(102);
    await seedGuest(103);
    await seedGuest(104);
    await showOffer(101, 'push', ago(24 * HOUR - 1_000));
    await showOffer(102, 'push', ago(24 * HOUR));
    await showOffer(103, 'bot', ago(HOUR));
    await showOffer(104, 'miniapp', ago(HOUR));

    expect(await ids()).toEqual([102, 103, 104]);
  });

  it('pages through the candidates by user id', async () => {
    for (const id of [104, 101, 103, 102]) await seedGuest(id);

    expect(await ids(2)).toEqual([101, 102]);
    expect(await ids(2, 102)).toEqual([103, 104]);
    expect(await ids(2, 104)).toEqual([]);
  });
});

describe('discardUnsentOffer', () => {
  it('deletes only a push offer nobody has answered', async () => {
    await seedGuest(101);
    const unsent = await showOffer(101, 'push', now);
    const accepted = await showOffer(101, 'push', now);
    await pool.query(`update offers set status = 'accepted', responded_at = $2 where id = $1`, [
      accepted,
      now,
    ]);
    const pulled = await showOffer(101, 'bot', now);

    for (const id of [unsent, accepted, pulled]) await discardUnsentOffer(pool, id);

    const { rows } = await pool.query<{ id: number }>('select id from offers order by id');
    expect(rows.map((row) => row.id)).toEqual([accepted, pulled]);
  });
});
