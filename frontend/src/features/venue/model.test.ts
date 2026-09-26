import { afterEach, describe, expect, it } from 'vitest';
import { isOpenNow } from '../../shared/openNow.ts';
import {
  applyPayload,
  buildRows,
  clearImportDraft,
  mapApplyErrors,
  readImportDraft,
  rowErrors,
  saveImportDraft,
} from './importDraft.ts';
import {
  emptyItemForm,
  emptyVenueForm,
  groupMenu,
  itemPatch,
  normalizeName,
  parseCoordinates,
  validateItem,
  validateVenue,
  venueFieldFromPath,
  type MenuImport,
  type MenuItem,
} from './model.ts';

const ITEM: MenuItem = {
  id: 1,
  name: 'Капучино',
  description: null,
  category: 'drink',
  priceRub: 190,
  weightG: 250,
  kcal: 120,
  proteinG: 6,
  fatG: 5,
  carbsG: 10,
  nutritionSource: 'venue',
  tags: ['coffee'],
  isAvailable: true,
};

type Parsed = MenuImport['items'][number];

function parsed(patch: Partial<Parsed> = {}): Parsed {
  return {
    name: 'Сырники',
    description: null,
    category: 'breakfast',
    priceRub: 320,
    weightG: 210,
    kcal: 480,
    proteinG: 20,
    fatG: 18,
    carbsG: 55,
    tags: ['breakfast'],
    ...patch,
  };
}

afterEach(() => {
  localStorage.clear();
});

describe('isOpenNow', () => {
  const at = (iso: string) => new Date(iso);

  it('handles regular hours in the venue time zone', () => {
    expect(isOpenNow('08:00', '22:00', 'Europe/Moscow', at('2026-09-26T05:00:00Z'))).toBe(true);
    expect(isOpenNow('08:00', '22:00', 'Europe/Moscow', at('2026-09-26T04:59:00Z'))).toBe(false);
    expect(isOpenNow('08:00', '22:00', 'Europe/Moscow', at('2026-09-26T19:00:00Z'))).toBe(false);
  });

  it('handles closing after midnight', () => {
    expect(isOpenNow('18:00', '02:00', 'Europe/Moscow', at('2026-09-26T22:30:00Z'))).toBe(true);
    expect(isOpenNow('18:00', '02:00', 'Europe/Moscow', at('2026-09-26T23:30:00Z'))).toBe(false);
    expect(isOpenNow('18:00', '02:00', 'Europe/Moscow', at('2026-09-26T10:00:00Z'))).toBe(false);
  });

  it('treats equal times as open around the clock', () => {
    expect(isOpenNow('00:00', '00:00', 'Europe/Moscow', at('2026-09-26T03:00:00Z'))).toBe(true);
  });

  it('uses the venue time zone, not the device one', () => {
    const now = at('2026-09-26T01:30:00Z');
    expect(isOpenNow('08:00', '22:00', 'Asia/Vladivostok', now)).toBe(true);
    expect(isOpenNow('08:00', '22:00', 'Europe/Kaliningrad', now)).toBe(false);
  });
});

describe('parseCoordinates', () => {
  it.each([
    ['55.7963, 49.1088', { lat: 55.7963, lon: 49.1088 }],
    ['55.7963 49.1088', { lat: 55.7963, lon: 49.1088 }],
    ['  -33.9,18.4 ', { lat: -33.9, lon: 18.4 }],
    ['90, -180', { lat: 90, lon: -180 }],
  ])('reads %s', (text, point) => {
    expect(parseCoordinates(text)).toEqual(point);
  });

  it.each(['', '55,79 49,10', '91, 10', '10, 181', 'abc', '55.7963', '1, 2, 3'])('rejects %s', (text) => {
    expect(parseCoordinates(text)).toBeNull();
  });
});

describe('venue form', () => {
  it('requires every field and builds the input', () => {
    expect(Object.keys(validateVenue(emptyVenueForm()).errors).sort()).toEqual([
      'address',
      'category',
      'coordinates',
      'name',
    ]);
    const { input } = validateVenue({
      ...emptyVenueForm(),
      name: ' Зерно ',
      address: 'Казань, Баумана, 36',
      category: 'coffee',
      coordinates: '55.7963, 49.1088',
    });
    expect(input).toEqual({
      name: 'Зерно',
      address: 'Казань, Баумана, 36',
      category: 'coffee',
      location: { lat: 55.7963, lon: 49.1088 },
      opensAt: '08:00',
      closesAt: '22:00',
      timezone: 'Europe/Moscow',
    });
  });

  it('maps server paths to fields', () => {
    expect(venueFieldFromPath('location.lat')).toBe('coordinates');
    expect(venueFieldFromPath('name')).toBe('name');
    expect(venueFieldFromPath('unknown')).toBeNull();
  });
});

describe('menu item form', () => {
  it('checks the server rules', () => {
    const { errors } = validateItem({
      ...emptyItemForm(),
      name: 'x'.repeat(121),
      priceRub: '0',
      weightG: '6000',
      kcal: '5001',
      proteinG: '1,25',
    });
    expect(errors).toMatchObject({
      name: 'Не длиннее 120 символов',
      category: 'Выберите категорию',
      priceRub: 'От 1 до 100000',
      weightG: 'От 1 до 5000',
      kcal: 'От 0 до 5000',
      proteinG: 'Число, не больше одного знака после запятой',
    });
  });

  it('accepts decimals with a comma and optional fields', () => {
    const { input } = validateItem({
      ...emptyItemForm(),
      name: 'Суп',
      category: 'soup',
      priceRub: '250',
      kcal: '0',
      fatG: '3,5',
    });
    expect(input).toMatchObject({ priceRub: 250, kcal: 0, fatG: 3.5, weightG: null, description: null });
  });

  it('sends only changed fields', () => {
    const { input } = validateItem({
      ...emptyItemForm(),
      name: 'Капучино',
      category: 'drink',
      priceRub: '210',
      weightG: '250',
      kcal: '120',
      proteinG: '6',
      fatG: '5',
      carbsG: '10',
      tags: ['coffee'],
    });
    expect(input === null ? null : itemPatch(input, ITEM)).toEqual({ priceRub: 210 });
  });
});

describe('menu', () => {
  it('groups by category in the menu order', () => {
    const groups = groupMenu([
      { ...ITEM, id: 2, category: 'dessert' },
      ITEM,
      { ...ITEM, id: 3, category: 'breakfast' },
    ]);
    expect(groups.map((group) => group.category)).toEqual(['breakfast', 'dessert', 'drink']);
  });

  it('matches names without case, spaces and ё', () => {
    expect(normalizeName('  Ёжик В Тумане ')).toBe(normalizeName('ежик в тумане'));
  });
});

describe('import review', () => {
  it('unchecks duplicates and blocks a missing price', () => {
    const rows = buildRows(
      [parsed(), parsed({ name: ' капучино ' }), parsed({ name: 'Морс', priceRub: null })],
      [ITEM],
    );
    expect(rows.map((row) => [row.selected, row.duplicate])).toEqual([
      [true, false],
      [false, true],
      [true, false],
    ]);
    expect(rowErrors(rows)).toEqual(new Map([[2, { priceRub: 'Укажите цену' }]]));
  });

  it('maps server errors back to the original rows', () => {
    const rows = buildRows([parsed(), parsed({ name: 'Капучино' }), parsed({ name: 'Морс' })], [ITEM]);
    const payload = applyPayload(rows);
    expect(payload.keys).toEqual([0, 2]);
    expect(payload.items[1]).not.toHaveProperty('isAvailable');
    expect(mapApplyErrors({ 'items.1.priceRub': 'Слишком дорого', other: 'x' }, payload.keys)).toEqual(
      new Map([[2, { priceRub: 'Слишком дорого' }]]),
    );
  });

  it('keeps the draft between launches', () => {
    const rows = buildRows([parsed()], []);
    saveImportDraft({ venueId: 7, importId: 11, rows });
    expect(readImportDraft()).toEqual({ venueId: 7, importId: 11, rows });
    clearImportDraft(12);
    expect(readImportDraft()).not.toBeNull();
    clearImportDraft(11);
    expect(readImportDraft()).toBeNull();
    localStorage.setItem('ppshkin.menuImport', '{broken');
    expect(readImportDraft()).toBeNull();
  });
});
