import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { DEMO_ACCOUNTS, type DemoRole } from '../auth/demo.ts';
import { MEAL_LIMITS } from '../domain/meals.ts';
import { GOALS, MENU_CATEGORIES, TAGS, VENUE_CATEGORIES } from '../domain/vocabulary.ts';
import { isValidTimeZone } from '../shared/time.ts';
import { DEAL_WINDOWS } from './windows.ts';

const DEMO_DATA_DIR = new URL('../../testdata/', import.meta.url);

const DEMO_DATA_FILES = {
  venues: 'venues.json',
  guest: 'demo-guest.json',
  accounts: 'accounts.json',
} as const;

type DataFile = keyof typeof DEMO_DATA_FILES;

const VENUE_ID_BASE = 900_000;
const MENU_ITEM_ID_BASE = 910_000;
const MENU_ITEM_IDS_PER_VENUE = 100;
const MENU_SIZE = { min: 8, max: 12 } as const;

const DEMO_ROLES = Object.keys(DEMO_ACCOUNTS) as DemoRole[];
const MAX_DIARY_DAYS_AGO = 7;

const LocalTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected a time of day HH:MM');
const TimeZone = z.string().refine(isValidTimeZone, 'expected an IANA time zone');
const Point = z.strictObject({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) });
const Name = (max: number) => z.string().trim().min(1).max(max);
const Tags = z
  .array(z.enum(TAGS))
  .max(MEAL_LIMITS.tags)
  .refine((tags) => new Set(tags).size === tags.length, 'tags must not repeat');

function hasOneDecimal(value: number): boolean {
  const tenths = value * 10;
  return Math.abs(tenths - Math.round(tenths)) < 1e-9;
}

const Grams = z
  .number()
  .min(0)
  .max(MEAL_LIMITS.grams)
  .refine(hasOneDecimal, 'expected at most one digit after the decimal point');

export function dealPrice(priceRub: number, discountPercent: number): number {
  return Math.floor((priceRub * (100 - discountPercent)) / 1000) * 10;
}

const MenuItemSchema = z.strictObject({
  id: z.number().int().positive(),
  name: Name(120),
  description: Name(500),
  category: z.enum(MENU_CATEGORIES),
  priceRub: z.number().int().min(1).max(100_000),
  weightG: z.number().int().min(1).max(5000),
  kcal: z.number().int().min(0).max(5000),
  proteinG: Grams,
  fatG: Grams,
  carbsG: Grams,
  tags: Tags.min(1),
});

const DealTemplateSchema = z.strictObject({
  window: z.enum(DEAL_WINDOWS),
  menuItemId: z.number().int().positive(),
  discountPercent: z.number().int().min(5).max(90),
  quantity: z.number().int().min(1).max(100),
});

const VenueSchema = z
  .strictObject({
    id: z
      .number()
      .int()
      .min(VENUE_ID_BASE + 1)
      .max(VENUE_ID_BASE + MENU_ITEM_IDS_PER_VENUE - 1),
    name: Name(120),
    category: z.enum(VENUE_CATEGORIES),
    address: Name(200),
    location: Point,
    opensAt: LocalTime,
    closesAt: LocalTime,
    timezone: TimeZone,
    ownerId: z.literal(DEMO_ACCOUNTS.venue.userId).nullable(),
    menu: z.array(MenuItemSchema).min(MENU_SIZE.min).max(MENU_SIZE.max),
    dealTemplates: z.array(DealTemplateSchema),
  })
  .superRefine((venue, context) => {
    const firstItemId = MENU_ITEM_ID_BASE + (venue.id - VENUE_ID_BASE) * MENU_ITEM_IDS_PER_VENUE + 1;
    const lastItemId = firstItemId + MENU_ITEM_IDS_PER_VENUE - 2;
    venue.menu.forEach((item, index) => {
      if (item.id < firstItemId || item.id > lastItemId) {
        context.addIssue({
          code: 'custom',
          path: ['menu', index, 'id'],
          message: `must be from ${firstItemId} to ${lastItemId}`,
        });
      }
    });
    const items = new Map(venue.menu.map((item) => [item.id, item]));
    const windows = new Set<string>();
    venue.dealTemplates.forEach((template, index) => {
      const item = items.get(template.menuItemId);
      if (!item) {
        context.addIssue({
          code: 'custom',
          path: ['dealTemplates', index, 'menuItemId'],
          message: 'must refer to an item on the menu of this venue',
        });
      } else if (dealPrice(item.priceRub, template.discountPercent) < 1) {
        context.addIssue({
          code: 'custom',
          path: ['dealTemplates', index, 'discountPercent'],
          message: `leaves no deal price for ${item.priceRub} RUB`,
        });
      }
      if (windows.has(template.window)) {
        context.addIssue({
          code: 'custom',
          path: ['dealTemplates', index, 'window'],
          message: 'must not repeat within a venue',
        });
      }
      windows.add(template.window);
    });
  });

const VenuesSchema = z
  .array(VenueSchema)
  .min(1)
  .superRefine((venues, context) => {
    const seen = new Set<number>();
    const ids = venues.flatMap((venue, index) => [
      { id: venue.id, path: [index, 'id'] },
      ...venue.menu.map((item, itemIndex) => ({ id: item.id, path: [index, 'menu', itemIndex, 'id'] })),
    ]);
    for (const { id, path } of ids) {
      if (seen.has(id)) context.addIssue({ code: 'custom', path, message: `id ${id} is used twice` });
      seen.add(id);
    }
    const owned = venues.filter((venue) => venue.ownerId !== null).length;
    if (owned !== 1) {
      context.addIssue({
        code: 'custom',
        path: [],
        message: `the demo venue account must own exactly one venue, owns ${owned}`,
      });
    }
  });

const DiaryEntrySchema = z
  .strictObject({
    daysAgo: z.number().int().min(1).max(MAX_DIARY_DAYS_AGO),
    time: LocalTime,
    title: Name(MEAL_LIMITS.titleLength),
    kcalMin: z.number().int().min(0).max(MEAL_LIMITS.kcal),
    kcalMax: z.number().int().min(0).max(MEAL_LIMITS.kcal),
    proteinG: Grams,
    fatG: Grams,
    carbsG: Grams,
    tags: Tags,
  })
  .refine((entry) => entry.kcalMax >= entry.kcalMin, {
    path: ['kcalMax'],
    message: 'must not be less than kcalMin',
  });

const GuestSchema = z.strictObject({
  profile: z.strictObject({
    kcalTarget: z.number().int().min(1000).max(5000),
    goal: z.enum(GOALS),
    timezone: TimeZone,
    dislikedTags: Tags,
    location: Point,
  }),
  diary: z.array(DiaryEntrySchema).min(1),
});

const AccountsSchema = z
  .array(
    z.strictObject({
      role: z.enum(DEMO_ROLES),
      userId: z.number().int(),
      tokenEnv: z.string(),
      description: Name(500),
    }),
  )
  .superRefine((accounts, context) => {
    accounts.forEach((account, index) => {
      if (account.userId !== DEMO_ACCOUNTS[account.role].userId) {
        context.addIssue({
          code: 'custom',
          path: [index, 'userId'],
          message: `must be ${DEMO_ACCOUNTS[account.role].userId} for the ${account.role} account`,
        });
      }
      const tokenEnv = `DEMO_${account.role.toUpperCase()}_TOKEN`;
      if (account.tokenEnv !== tokenEnv) {
        context.addIssue({ code: 'custom', path: [index, 'tokenEnv'], message: `must be ${tokenEnv}` });
      }
    });
    const roles = accounts.map((account) => account.role);
    if (roles.length !== DEMO_ROLES.length || DEMO_ROLES.some((role) => !roles.includes(role))) {
      context.addIssue({
        code: 'custom',
        path: [],
        message: `must list each of ${DEMO_ROLES.join(', ')} exactly once`,
      });
    }
  });

export type DemoMenuItem = z.infer<typeof MenuItemSchema>;
export type DealTemplate = z.infer<typeof DealTemplateSchema>;
export type DemoVenue = z.infer<typeof VenueSchema>;
export type DiaryTemplateEntry = z.infer<typeof DiaryEntrySchema>;
export type DemoGuest = z.infer<typeof GuestSchema>;
export type DemoAccount = z.infer<typeof AccountsSchema>[number];

export interface DemoDataset {
  venues: DemoVenue[];
  guest: DemoGuest;
  accounts: DemoAccount[];
}

export type DemoDataFiles = Record<DataFile, unknown>;

export class DemoDatasetError extends Error {
  readonly file: string;
  readonly issues: string[];

  constructor(file: string, issues: string[]) {
    super(`Invalid demo data in ${file}: ${issues.join('; ')}`);
    this.name = 'DemoDatasetError';
    this.file = file;
    this.issues = issues;
  }
}

function parseFile<Schema extends z.ZodType>(
  file: DataFile,
  schema: Schema,
  value: unknown,
): z.output<Schema> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new DemoDatasetError(
      DEMO_DATA_FILES[file],
      result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    );
  }
  return result.data;
}

export function parseDemoDataset(files: DemoDataFiles): DemoDataset {
  return {
    venues: parseFile('venues', VenuesSchema, files.venues),
    guest: parseFile('guest', GuestSchema, files.guest),
    accounts: parseFile('accounts', AccountsSchema, files.accounts),
  };
}

async function readJson(dir: URL, file: DataFile): Promise<unknown> {
  const name = DEMO_DATA_FILES[file];
  const text = await readFile(new URL(name, dir), 'utf8');
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new DemoDatasetError(name, [error instanceof Error ? error.message : 'not valid JSON']);
  }
}

export async function loadDemoDataset(dir: URL = DEMO_DATA_DIR): Promise<DemoDataset> {
  const base = dir.href.endsWith('/') ? dir : new URL(`${dir.href}/`);
  const [venues, guest, accounts] = await Promise.all([
    readJson(base, 'venues'),
    readJson(base, 'guest'),
    readJson(base, 'accounts'),
  ]);
  return parseDemoDataset({ venues, guest, accounts });
}

export function demoAccountVenue(dataset: DemoDataset): DemoVenue {
  const venue = dataset.venues.find(({ ownerId }) => ownerId === DEMO_ACCOUNTS.venue.userId);
  if (!venue) throw new Error('The demo dataset has no venue of the demo venue account');
  return venue;
}
