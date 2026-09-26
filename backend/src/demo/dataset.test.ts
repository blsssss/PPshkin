import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEMO_ACCOUNTS } from '../auth/demo.ts';
import { TAGS } from '../domain/vocabulary.ts';
import { distanceMeters } from '../shared/geo.ts';
import {
  dealPrice,
  DemoDatasetError,
  demoAccountVenue,
  loadDemoDataset,
  parseDemoDataset,
} from './dataset.ts';
import { DEMO_CITY_CENTER } from './location.ts';

const testdata = new URL('../../testdata/', import.meta.url);
const files = ['venues.json', 'demo-guest.json', 'accounts.json'];
const dataset = await loadDemoDataset();

async function rawFiles() {
  const [venues, guest, accounts] = await Promise.all(
    files.map(async (file) => JSON.parse(await readFile(new URL(file, testdata), 'utf8')) as unknown),
  );
  return { venues, guest, accounts } as {
    venues: Record<string, unknown>[];
    guest: unknown;
    accounts: unknown;
  };
}

type RawVenue = Record<string, unknown> & {
  menu: Record<string, unknown>[];
  dealTemplates: Record<string, unknown>[];
};

async function withChangedVenue(change: (venue: RawVenue) => void) {
  const raw = await rawFiles();
  change(raw.venues[0] as RawVenue);
  return raw;
}

function issuesOf(parse: () => unknown): string[] {
  try {
    parse();
  } catch (error) {
    if (error instanceof DemoDatasetError) return error.issues.map((issue) => `${error.file} ${issue}`);
    throw error;
  }
  throw new Error('Expected the dataset to be rejected');
}

describe('demo dataset', () => {
  it('has six venues and menu items with fixed ids in their ranges', () => {
    expect(dataset.venues.map((venue) => venue.id)).toEqual([900001, 900002, 900003, 900004, 900005, 900006]);
    for (const venue of dataset.venues) {
      const first = 910_000 + (venue.id - 900_000) * 100 + 1;
      expect(venue.menu.length, venue.name).toBeGreaterThanOrEqual(8);
      expect(venue.menu.length, venue.name).toBeLessThanOrEqual(12);
      expect(venue.menu.map((item) => item.id)).toEqual(venue.menu.map((_, index) => first + index));
    }
    const ids = dataset.venues.flatMap((venue) => [venue.id, ...venue.menu.map((item) => item.id)]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('places every venue on a real street of central Kazan within 2 km of the demo centre', () => {
    const streets = dataset.venues.map((venue) => /^Казань, ул\. (.+), \d+$/.exec(venue.address)?.[1]);
    expect(streets).toEqual([
      'Баумана',
      'Петербургская',
      'Пушкина',
      'Кремлёвская',
      'Профсоюзная',
      'Право-Булачная',
    ]);
    for (const venue of dataset.venues) {
      expect(distanceMeters(venue.location, DEMO_CITY_CENTER), venue.name).toBeLessThanOrEqual(2000);
      expect(venue.timezone).toBe('Europe/Moscow');
    }
  });

  it('gives the demo venue account the coffee shop «Зерно»', () => {
    expect(demoAccountVenue(dataset)).toMatchObject({ id: 900001, name: 'Кофейня «Зерно»', ownerId: -1002 });
    expect(dataset.venues.filter((venue) => venue.ownerId !== null)).toHaveLength(1);
  });

  it('uses known tags and plausible prices and calories', () => {
    for (const item of dataset.venues.flatMap((venue) => venue.menu)) {
      expect(
        item.tags.every((tag) => TAGS.includes(tag)),
        item.name,
      ).toBe(true);
      expect(item.priceRub, item.name).toBeGreaterThanOrEqual(60);
      expect(item.priceRub, item.name).toBeLessThanOrEqual(650);
      const macrosKcal = item.proteinG * 4 + item.fatG * 9 + item.carbsG * 4;
      expect(Math.abs(macrosKcal - item.kcal), item.name).toBeLessThanOrEqual(Math.max(20, item.kcal * 0.1));
      if (item.category === 'dessert')
        expect(item.tags, item.name).toEqual(expect.arrayContaining(['dessert', 'sweet']));
      if (/рыб|лосос|минтай/i.test(`${item.name} ${item.description}`))
        expect(item.tags, item.name).toContain('fish');
    }
  });

  it('builds deal templates from items of the same venue with a lower price', () => {
    for (const venue of dataset.venues) {
      expect(venue.dealTemplates.length, venue.name).toBeGreaterThanOrEqual(2);
      for (const template of venue.dealTemplates) {
        const item = venue.menu.find((candidate) => candidate.id === template.menuItemId);
        expect(item, `${venue.name} ${template.window}`).toBeDefined();
        const price = dealPrice(item!.priceRub, template.discountPercent);
        expect(price).toBeLessThan(item!.priceRub);
        expect(price).toBeGreaterThanOrEqual(1);
        expect(price % 10).toBe(0);
      }
    }
  });

  it('prices deals down to 10 roubles', () => {
    expect(dealPrice(150, 40)).toBe(90);
    expect(dealPrice(330, 30)).toBe(230);
    expect(dealPrice(290, 40)).toBe(170);
    expect(dealPrice(15, 5)).toBe(10);
  });

  it('keeps an afternoon dessert habit in 4 of the 5 days of the demo diary', () => {
    const { profile, diary } = dataset.guest;
    expect(profile).toEqual({
      kcalTarget: 1800,
      goal: 'maintain',
      timezone: 'Europe/Moscow',
      dislikedTags: ['fish'],
      location: DEMO_CITY_CENTER,
    });
    expect(diary).toHaveLength(26);
    const sweetDays = new Set(
      diary
        .filter((meal) => meal.tags.includes('sweet') && meal.time >= '15:00' && meal.time < '17:00')
        .map((meal) => meal.daysAgo),
    );
    expect([...sweetDays].sort()).toEqual([1, 3, 4, 5]);
    expect(new Set(diary.map((meal) => meal.daysAgo))).toEqual(new Set([1, 2, 3, 4, 5]));
  });

  it('describes both demo accounts without their tokens', () => {
    expect(dataset.accounts.map(({ role, userId, tokenEnv }) => ({ role, userId, tokenEnv }))).toEqual([
      { role: 'guest', userId: DEMO_ACCOUNTS.guest.userId, tokenEnv: 'DEMO_GUEST_TOKEN' },
      { role: 'venue', userId: DEMO_ACCOUNTS.venue.userId, tokenEnv: 'DEMO_VENUE_TOKEN' },
    ]);
  });

  it('contains no long dashes', async () => {
    const longDashes = [String.fromCodePoint(0x2013), String.fromCodePoint(0x2014)];
    for (const file of files) {
      const text = await readFile(new URL(file, testdata), 'utf8');
      expect(
        longDashes.filter((dash) => text.includes(dash)),
        file,
      ).toEqual([]);
    }
  });
});

describe('demo dataset validation', () => {
  it('rejects unknown tags, foreign deal items, ids out of range and repeated ids', async () => {
    const unknownTag = await withChangedVenue((venue) => {
      venue.menu[0]!.tags = ['coffee', 'caffeine'];
    });
    expect(issuesOf(() => parseDemoDataset(unknownTag))).toEqual([
      expect.stringMatching(/^venues\.json 0\.menu\.0\.tags\.1: /) as string,
    ]);

    const foreignItem = await withChangedVenue((venue) => {
      venue.dealTemplates[0]!.menuItemId = 910201;
    });
    expect(issuesOf(() => parseDemoDataset(foreignItem))).toEqual([
      'venues.json 0.dealTemplates.0.menuItemId: must refer to an item on the menu of this venue',
    ]);

    const outOfRange = await withChangedVenue((venue) => {
      venue.menu[0]!.id = 910201;
    });
    expect(issuesOf(() => parseDemoDataset(outOfRange))).toEqual(
      expect.arrayContaining([
        'venues.json 0.menu.0.id: must be from 910101 to 910199',
        'venues.json 1.menu.0.id: id 910201 is used twice',
      ]),
    );
  });

  it('rejects a second owned venue, repeated deal windows and free deals', async () => {
    const raw = await rawFiles();
    (raw.venues[1] as RawVenue).ownerId = -1002;
    const second = raw.venues[0] as RawVenue;
    second.dealTemplates[1]!.window = 'morning';
    second.dealTemplates[2]!.discountPercent = 90;
    second.menu[9]!.priceRub = 10;
    expect(issuesOf(() => parseDemoDataset(raw))).toEqual([
      'venues.json 0.dealTemplates.1.window: must not repeat within a venue',
      'venues.json 0.dealTemplates.2.discountPercent: leaves no deal price for 10 RUB',
      'venues.json (root): the demo venue account must own exactly one venue, owns 2',
    ]);
  });

  it('rejects accounts that do not match the demo accounts of the server', async () => {
    const raw = await rawFiles();
    raw.accounts = [
      { role: 'guest', userId: -1001, tokenEnv: 'DEMO_VENUE_TOKEN', description: 'Гость' },
      { role: 'guest', userId: -5, tokenEnv: 'DEMO_GUEST_TOKEN', description: 'Гость' },
    ];
    expect(issuesOf(() => parseDemoDataset(raw))).toEqual([
      'accounts.json 0.tokenEnv: must be DEMO_GUEST_TOKEN',
      'accounts.json 1.userId: must be -1001 for the guest account',
      'accounts.json (root): must list each of guest, venue exactly once',
    ]);
  });

  it('rejects diary entries with unknown fields, too precise macros or an upside down range', async () => {
    const raw = await rawFiles();
    const guest = raw.guest as { diary: Record<string, unknown>[] };
    const [first] = guest.diary;
    const withDiary = (entry: Record<string, unknown>) => ({
      ...raw,
      guest: { ...guest, diary: [entry, ...guest.diary.slice(1)] },
    });
    expect(issuesOf(() => parseDemoDataset(withDiary({ ...first, source: 'demo' })))).toEqual([
      'demo-guest.json diary.0: Unrecognized key: "source"',
    ]);
    expect(issuesOf(() => parseDemoDataset(withDiary({ ...first, proteinG: 10.25 })))).toEqual([
      'demo-guest.json diary.0.proteinG: expected at most one digit after the decimal point',
    ]);
    expect(issuesOf(() => parseDemoDataset(withDiary({ ...first, kcalMin: 400, kcalMax: 300 })))).toEqual([
      'demo-guest.json diary.0.kcalMax: must not be less than kcalMin',
    ]);
  });

  it('names the file that is not valid JSON', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ppshkin-demo-'));
    try {
      for (const file of files) {
        await writeFile(join(dir, file), await readFile(new URL(file, testdata), 'utf8'));
      }
      await writeFile(join(dir, 'accounts.json'), '[{"role": "guest",');
      await expect(loadDemoDataset(pathToFileURL(dir))).rejects.toMatchObject({
        name: 'DemoDatasetError',
        file: 'accounts.json',
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
