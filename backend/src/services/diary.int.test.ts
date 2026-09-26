import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { fixedClock } from '../../test/clock.ts';
import { closeTestPool, resetDatabase, testPool } from '../../test/database.ts';
import { TINY_PNG } from '../../test/multipart.ts';
import { CONSENT_DOCUMENTS } from '../domain/consents.ts';
import { MEAL_LIMITS } from '../domain/meals.ts';
import { TAGS, type Tag } from '../domain/vocabulary.ts';
import type { DishEstimate, DishRecognition, DishRecognizer } from '../ports/recognition.ts';
import * as meals from '../repositories/meals.ts';
import * as users from '../repositories/users.ts';
import { createConsentsService } from './consents.ts';
import { createDiaryService, MIN_CONFIDENCE, type ManualMealInput } from './diary.ts';

const pool = testPool();
const NOW = '2026-09-25T09:00:00.000Z';
const clock = fixedClock(NOW);
const consents = createConsentsService({ pool, clock });

const GUEST = 1;
const STRANGER = 2;
const NO_CONSENT = 3;

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

interface FakeRecognizer extends DishRecognizer {
  calls: { method: 'fromPhoto' | 'fromText'; input: Buffer | string }[];
}

function fakeRecognizer(result: DishRecognition): FakeRecognizer {
  const calls: FakeRecognizer['calls'] = [];
  return {
    calls,
    fromPhoto: (image) => {
      calls.push({ method: 'fromPhoto', input: image });
      return Promise.resolve(result);
    },
    fromText: (description) => {
      calls.push({ method: 'fromText', input: description });
      return Promise.resolve(result);
    },
  };
}

const unavailable: DishRecognition = { status: 'unavailable', reason: 'disabled' };

function diaryWith(dishes: DishRecognizer = fakeRecognizer(unavailable)) {
  return createDiaryService({ pool, dishes, clock, consents });
}

const estimate = (
  title: string,
  confidence: number,
  overrides: Partial<DishEstimate> = {},
): DishEstimate => ({
  title,
  portionG: 250,
  kcalMin: 300,
  kcalMax: 400,
  proteinG: 12,
  fatG: 10,
  carbsG: 40,
  tags: ['grain'],
  confidence,
  ...overrides,
});

const recognized = (items: DishEstimate[]): DishRecognition => ({
  status: 'recognized',
  items,
  basis: 'Видна тарелка с кашей',
  model: 'test-model',
});

const manual = (overrides: Partial<ManualMealInput> = {}): ManualMealInput => ({
  title: 'Сырники',
  kcal: 350,
  ...overrides,
});

async function storedMeals(userId: number) {
  return meals.listSince(pool, userId, new Date(0));
}

beforeEach(async () => {
  await resetDatabase(pool);
  clock.set(NOW);
  for (const id of [GUEST, STRANGER, NO_CONSENT]) {
    await users.upsert(pool, { id, firstName: null, username: null });
  }
  for (const id of [GUEST, STRANGER]) {
    await consents.grant(id, 'personal_data', CONSENT_DOCUMENTS.personal_data.version, 'bot');
  }
});

afterAll(async () => {
  await closeTestPool();
});

describe('diary days', () => {
  it('splits days at local midnight in Europe/Moscow', async () => {
    const diary = diaryWith();
    const beforeMidnight = await diary.addManual(
      GUEST,
      manual({ title: 'Кефир', eatenAt: new Date('2026-09-24T20:59:00Z') }),
    );
    const atMidnight = await diary.addManual(
      GUEST,
      manual({ title: 'Печенье', eatenAt: new Date('2026-09-24T21:00:00Z') }),
    );

    const yesterday = await diary.day(GUEST, '2026-09-24');
    expect(yesterday.meals.map((meal) => meal.id)).toEqual([beforeMidnight.id]);
    const today = await diary.day(GUEST, '2026-09-25');
    expect(today.meals.map((meal) => meal.id)).toEqual([atMidnight.id]);
  });

  it('uses today in the user time zone by default and computes totals', async () => {
    const diary = diaryWith();
    await diary.addManual(
      GUEST,
      manual({
        title: 'Сырники',
        kcalMin: 300,
        kcalMax: 401,
        kcal: undefined,
        proteinG: 20,
        eatenAt: new Date('2026-09-25T05:00:00Z'),
      }),
    );
    await diary.addManual(
      GUEST,
      manual({ title: 'Латте', kcal: 180, fatG: 7.25, eatenAt: new Date('2026-09-25T08:30:00Z') }),
    );
    await diary.addManual(
      GUEST,
      manual({ title: 'Вчера', kcal: 900, eatenAt: new Date('2026-09-24T12:00:00Z') }),
    );

    const day = await diary.day(GUEST);
    expect(day).toMatchObject({
      date: '2026-09-25',
      timezone: 'Europe/Moscow',
      targetKcal: 2000,
      totals: { meals: 2, kcalMin: 480, kcalMax: 581, kcal: 531, proteinG: 20, fatG: 7.3, carbsG: 0 },
      remainingKcal: 1469,
    });
    expect(day.meals.map((meal) => [meal.title, meal.slot])).toEqual([
      ['Сырники', 'breakfast'],
      ['Латте', 'lunch'],
    ]);
  });

  it('follows the time zone of the user', async () => {
    await users.updateProfile(pool, GUEST, { timezone: 'Asia/Yekaterinburg', kcalTarget: 1500 });
    const diary = diaryWith();
    const meal = await diary.addManual(GUEST, manual({ eatenAt: new Date('2026-09-24T20:00:00Z') }));
    expect(meal.slot).toBe('snack');
    const day = await diary.day(GUEST);
    expect(day).toMatchObject({ date: '2026-09-25', timezone: 'Asia/Yekaterinburg', targetKcal: 1500 });
    expect(day.meals.map((item) => item.id)).toEqual([meal.id]);
  });

  it('never reports a negative remainder', async () => {
    const diary = diaryWith();
    for (let index = 0; index < 3; index += 1) {
      await diary.addManual(GUEST, manual({ kcal: 900 }));
    }
    expect(await diary.day(GUEST)).toMatchObject({ totals: { kcal: 2700 }, remainingKcal: 0 });
  });

  it('reads days without consent and rejects missing users and bad dates', async () => {
    const diary = diaryWith();
    await expect(diary.day(NO_CONSENT)).resolves.toMatchObject({ meals: [] });
    await expect(diary.day(404)).rejects.toMatchObject({ status: 404, code: 'user_not_found' });
    await expect(diary.day(GUEST, '2026-02-30')).rejects.toMatchObject({
      status: 400,
      code: 'validation_failed',
    });
  });
});

describe('diary summary', () => {
  it('returns every local day oldest first with empty days as zeros', async () => {
    const diary = diaryWith();
    await diary.addManual(GUEST, manual({ kcal: 500, eatenAt: new Date('2026-09-21T09:00:00Z') }));
    await diary.addManual(GUEST, manual({ kcal: 300, eatenAt: new Date('2026-09-22T20:59:00Z') }));
    await diary.addManual(GUEST, manual({ kcal: 200, eatenAt: new Date('2026-09-22T21:00:00Z') }));
    await diary.addManual(GUEST, manual({ kcal: 400, eatenAt: new Date('2026-09-25T06:00:00Z') }));
    await diary.addManual(STRANGER, manual({ kcal: 999, eatenAt: new Date('2026-09-24T06:00:00Z') }));

    const summary = await diary.summary(GUEST, 3);
    expect(summary).toEqual([
      {
        date: '2026-09-23',
        meals: 1,
        kcalMin: 200,
        kcalMax: 200,
        kcal: 200,
        proteinG: 0,
        fatG: 0,
        carbsG: 0,
      },
      { date: '2026-09-24', meals: 0, kcalMin: 0, kcalMax: 0, kcal: 0, proteinG: 0, fatG: 0, carbsG: 0 },
      {
        date: '2026-09-25',
        meals: 1,
        kcalMin: 400,
        kcalMax: 400,
        kcal: 400,
        proteinG: 0,
        fatG: 0,
        carbsG: 0,
      },
    ]);
    expect((await diary.summary(GUEST, 31)).map((day) => day.date).slice(-2)).toEqual([
      '2026-09-24',
      '2026-09-25',
    ]);
    expect(await diary.summary(GUEST, 1)).toEqual([
      expect.objectContaining({ date: '2026-09-25', kcal: 400 }),
    ]);
  });

  it('accepts only 1 to 31 days', async () => {
    const diary = diaryWith();
    for (const days of [0, 32, 1.5]) {
      await expect(diary.summary(GUEST, days)).rejects.toMatchObject({
        status: 400,
        code: 'validation_failed',
        details: [{ path: 'days' }],
      });
    }
  });
});

describe('manual meals', () => {
  it('stores a single calorie value as an exact range with known tags only', async () => {
    const meal = await diaryWith().addManual(
      GUEST,
      manual({ title: '  Сырники  ', proteinG: 18, tags: ['dairy', 'dairy', 'unknown' as Tag] }),
    );
    expect(meal).toMatchObject({
      userId: GUEST,
      title: 'Сырники',
      kcalMin: 350,
      kcalMax: 350,
      proteinG: 18,
      fatG: null,
      carbsG: null,
      tags: ['dairy'],
      source: 'manual',
      confidence: null,
      eatenAt: new Date(NOW),
      slot: 'lunch',
    });
  });

  it('stores a calorie range', async () => {
    const meal = await diaryWith().addManual(GUEST, { title: 'Борщ', kcalMin: 250, kcalMax: 320 });
    expect(meal).toMatchObject({ kcalMin: 250, kcalMax: 320 });
  });

  it('validates fields when called without HTTP', async () => {
    const diary = diaryWith();
    const cases: [Partial<ManualMealInput>, string][] = [
      [{ title: '   ' }, 'title'],
      [{ title: 'x'.repeat(201) }, 'title'],
      [{ kcal: undefined }, 'kcal'],
      [{ kcalMin: 300 }, 'kcal'],
      [{ kcal: undefined, kcalMin: 400, kcalMax: 300 }, 'kcalMax'],
      [{ kcal: undefined, kcalMin: 400 }, 'kcalMax'],
      [{ kcal: 5001 }, 'kcal'],
      [{ kcal: 10.5 }, 'kcal'],
      [{ fatG: 501 }, 'fatG'],
      [
        {
          tags: [
            'sweet',
            'dessert',
            'pastry',
            'chocolate',
            'fruit',
            'berries',
            'dairy',
            'cheese',
            'eggs',
            'meat',
            'fish',
          ],
        },
        'tags',
      ],
      [{ eatenAt: new Date('invalid') }, 'eatenAt'],
    ];
    for (const [overrides, path] of cases) {
      await expect(diary.addManual(GUEST, manual(overrides))).rejects.toMatchObject({
        status: 400,
        code: 'validation_failed',
        details: expect.arrayContaining([expect.objectContaining({ path })]) as unknown,
      });
    }
    expect(await storedMeals(GUEST)).toEqual([]);
  });

  it('accepts eatenAt from 7 days ago up to 5 minutes ahead', async () => {
    const diary = diaryWith();
    const now = new Date(NOW).getTime();
    for (const eatenAt of [now - 7 * DAY_MS, now + 5 * MINUTE_MS]) {
      await expect(diary.addManual(GUEST, manual({ eatenAt: new Date(eatenAt) }))).resolves.toMatchObject({
        eatenAt: new Date(eatenAt),
      });
    }
    for (const eatenAt of [now - 7 * DAY_MS - 1, now + 5 * MINUTE_MS + 1]) {
      await expect(diary.addManual(GUEST, manual({ eatenAt: new Date(eatenAt) }))).rejects.toMatchObject({
        status: 422,
        code: 'eaten_at_out_of_range',
      });
    }
    expect(await storedMeals(GUEST)).toHaveLength(2);
  });

  it('requires the personal data consent and an existing user', async () => {
    const diary = diaryWith();
    await expect(diary.addManual(NO_CONSENT, manual())).rejects.toMatchObject({
      status: 403,
      code: 'consent_required',
    });
    await expect(diary.addManual(404, manual())).rejects.toMatchObject({
      status: 404,
      code: 'user_not_found',
    });
    expect(await storedMeals(NO_CONSENT)).toEqual([]);
  });
});

describe('meal changes', () => {
  it('updates only the passed fields and resets macros to null', async () => {
    const diary = diaryWith();
    const created = await diary.addManual(GUEST, manual({ proteinG: 18, fatG: 9, tags: ['dairy'] }));
    const updated = await diary.update(GUEST, created.id, {
      title: ' Творог ',
      kcalMin: 200,
      kcalMax: 260,
      proteinG: null,
      eatenAt: new Date('2026-09-25T04:00:00Z'),
    });
    expect(updated).toMatchObject({
      id: created.id,
      title: 'Творог',
      kcalMin: 200,
      kcalMax: 260,
      proteinG: null,
      fatG: 9,
      tags: ['dairy'],
      slot: 'breakfast',
    });
    expect(await diary.update(GUEST, created.id, { kcal: 300 })).toMatchObject({
      kcalMin: 300,
      kcalMax: 300,
    });
  });

  it('answers 404 for a meal of another user or a missing meal', async () => {
    const diary = diaryWith();
    const foreign = await diary.addManual(STRANGER, manual());
    await expect(diary.update(GUEST, foreign.id, { title: 'Моё' })).rejects.toMatchObject({
      status: 404,
      code: 'meal_not_found',
    });
    await expect(diary.remove(GUEST, foreign.id)).rejects.toMatchObject({
      status: 404,
      code: 'meal_not_found',
    });
    await expect(diary.update(GUEST, 999_999, { title: 'Нет' })).rejects.toMatchObject({
      status: 404,
      code: 'meal_not_found',
    });
    expect(await storedMeals(STRANGER)).toEqual([expect.objectContaining({ title: 'Сырники' })]);
  });

  it('validates patches', async () => {
    const diary = diaryWith();
    const created = await diary.addManual(GUEST, manual());
    await expect(diary.update(GUEST, created.id, {})).rejects.toMatchObject({
      status: 400,
      details: [{ path: '' }],
    });
    await expect(diary.update(GUEST, created.id, { kcalMin: 100 })).rejects.toMatchObject({
      status: 400,
      details: [{ path: 'kcalMax' }],
    });
    await expect(diary.update(GUEST, created.id, { kcal: 100, kcalMax: 200 })).rejects.toMatchObject({
      status: 400,
      details: [{ path: 'kcal' }],
    });
    await expect(
      diary.update(GUEST, created.id, { eatenAt: new Date(new Date(NOW).getTime() - 8 * DAY_MS) }),
    ).rejects.toMatchObject({ status: 422, code: 'eaten_at_out_of_range' });
  });

  it('requires consent to change a meal but not to delete it', async () => {
    const diary = diaryWith();
    const created = await meals.insert(pool, {
      userId: NO_CONSENT,
      title: 'Старое',
      kcalMin: 100,
      kcalMax: 100,
      proteinG: null,
      fatG: null,
      carbsG: null,
      tags: [],
      source: 'manual',
      confidence: null,
      eatenAt: new Date(NOW),
    });
    await expect(diary.update(NO_CONSENT, created.id, { title: 'Новое' })).rejects.toMatchObject({
      status: 403,
      code: 'consent_required',
    });
    await diary.remove(NO_CONSENT, created.id);
    await expect(diary.remove(NO_CONSENT, created.id)).rejects.toMatchObject({ status: 404 });
  });
});

describe('meal recognition', () => {
  it('stores confident items from a photo and returns the refreshed day', async () => {
    const dishes = fakeRecognizer(
      recognized([
        estimate('Овсянка', 0.9, { tags: ['grain', 'breakfast'] }),
        estimate('Непонятный соус', 0.2),
        estimate('Кофе', MIN_CONFIDENCE, { kcalMin: 5, kcalMax: 10, tags: ['coffee'] }),
      ]),
    );
    const result = await diaryWith(dishes).logFromPhoto(GUEST, TINY_PNG);

    expect(dishes.calls).toEqual([{ method: 'fromPhoto', input: TINY_PNG }]);
    expect(result.status).toBe('logged');
    if (result.status !== 'logged') return;
    expect(result.basis).toBe('Видна тарелка с кашей');
    expect(result.meals.map((meal) => [meal.title, meal.confidence, meal.source])).toEqual([
      ['Овсянка', 0.9, 'photo'],
      ['Кофе', 0.35, 'photo'],
    ]);
    expect(result.meals.every((meal) => meal.eatenAt.getTime() === new Date(NOW).getTime())).toBe(true);
    expect(result.day).toMatchObject({ date: '2026-09-25', totals: { meals: 2, kcal: 358 } });
    expect(await storedMeals(GUEST)).toHaveLength(2);
  });

  it('returns candidates without storing anything when every item is uncertain', async () => {
    const items = [estimate('Суп', 0.34), estimate('Салат', 0.1)];
    const result = await diaryWith(fakeRecognizer(recognized(items))).logFromPhoto(GUEST, TINY_PNG);
    expect(result).toEqual({ status: 'uncertain', candidates: items, basis: 'Видна тарелка с кашей' });
    expect(await storedMeals(GUEST)).toEqual([]);
  });

  it('treats an empty recognition as uncertain', async () => {
    const result = await diaryWith(fakeRecognizer(recognized([]))).logFromText(GUEST, 'что-то съел');
    expect(result).toEqual({ status: 'uncertain', candidates: [], basis: 'Видна тарелка с кашей' });
  });

  it('passes not food and unavailable outcomes through without storing', async () => {
    const notFood = await diaryWith(
      fakeRecognizer({ status: 'not_food', basis: 'На фото кошка', model: 'test-model' }),
    ).logFromPhoto(GUEST, TINY_PNG);
    expect(notFood).toEqual({ status: 'not_food', basis: 'На фото кошка' });

    const failed = await diaryWith(
      fakeRecognizer({ status: 'unavailable', reason: 'unsupported_image' }),
    ).logFromPhoto(GUEST, TINY_PNG);
    expect(failed).toEqual({ status: 'unavailable', reason: 'unsupported_image' });
    expect(await storedMeals(GUEST)).toEqual([]);
  });

  it('logs text descriptions with the text source', async () => {
    const dishes = fakeRecognizer(recognized([estimate('Гречка с курицей', 0.8)]));
    const result = await diaryWith(dishes).logFromText(GUEST, '  гречка с курицей  ');
    expect(dishes.calls).toEqual([{ method: 'fromText', input: 'гречка с курицей' }]);
    expect(result).toMatchObject({
      status: 'logged',
      meals: [{ source: 'text', title: 'Гречка с курицей' }],
    });
  });

  it('fits recognized values into the manual entry limits', async () => {
    const dishes = fakeRecognizer(
      recognized([
        estimate('  ', 0.9, {
          kcalMin: -40.4,
          kcalMax: -10,
          proteinG: -1,
          fatG: Number.NaN,
          tags: ['grain', 'unknown' as Tag, 'grain'],
        }),
        estimate('Т'.repeat(300), 0.9, {
          kcalMin: 12000.6,
          kcalMax: 15000,
          proteinG: 520,
          fatG: 700.5,
          carbsG: 1200,
          tags: TAGS,
          confidence: 1.4,
        }),
      ]),
    );
    const result = await diaryWith(dishes).logFromPhoto(GUEST, TINY_PNG);
    expect(result.status).toBe('logged');
    if (result.status !== 'logged') return;
    expect(result.meals[0]).toMatchObject({
      title: 'Блюдо',
      kcalMin: 0,
      kcalMax: 0,
      proteinG: 0,
      fatG: 0,
      tags: ['grain'],
    });
    expect(result.meals[1]).toMatchObject({
      kcalMin: MEAL_LIMITS.kcal,
      kcalMax: MEAL_LIMITS.kcal,
      proteinG: MEAL_LIMITS.grams,
      fatG: MEAL_LIMITS.grams,
      carbsG: MEAL_LIMITS.grams,
      tags: TAGS.slice(0, MEAL_LIMITS.tags),
      confidence: 1,
    });
    expect(result.meals[1]?.title).toHaveLength(MEAL_LIMITS.titleLength);
  });

  it('returns uncertain candidates that can be confirmed unchanged as manual entries', async () => {
    const dishes = fakeRecognizer(
      recognized([
        estimate('Большой сет', 0.3, {
          kcalMin: 4800,
          kcalMax: 5600,
          proteinG: 520,
          fatG: 510,
          carbsG: 900,
          tags: TAGS,
        }),
      ]),
    );
    const diary = diaryWith(dishes);
    const result = await diary.logFromPhoto(GUEST, TINY_PNG);
    expect(result.status).toBe('uncertain');
    if (result.status !== 'uncertain') return;
    const [candidate] = result.candidates;
    expect(candidate).toEqual({
      title: 'Большой сет',
      portionG: 250,
      kcalMin: 4800,
      kcalMax: MEAL_LIMITS.kcal,
      proteinG: MEAL_LIMITS.grams,
      fatG: MEAL_LIMITS.grams,
      carbsG: MEAL_LIMITS.grams,
      tags: TAGS.slice(0, MEAL_LIMITS.tags),
      confidence: 0.3,
    });
    if (!candidate) return;
    const { title, kcalMin, kcalMax, proteinG, fatG, carbsG, tags } = candidate;
    const confirmed = await diary.addManual(GUEST, { title, kcalMin, kcalMax, proteinG, fatG, carbsG, tags });
    expect(confirmed).toMatchObject({
      title,
      kcalMin,
      kcalMax,
      proteinG,
      fatG,
      carbsG,
      tags,
      source: 'manual',
    });
  });

  it('does not call the recognizer without consent or for a missing user', async () => {
    const dishes = fakeRecognizer(recognized([estimate('Овсянка', 0.9)]));
    const diary = diaryWith(dishes);
    await expect(diary.logFromPhoto(NO_CONSENT, TINY_PNG)).rejects.toMatchObject({
      status: 403,
      code: 'consent_required',
    });
    await expect(diary.logFromText(NO_CONSENT, 'овсянка')).rejects.toMatchObject({
      status: 403,
      code: 'consent_required',
    });
    await expect(diary.logFromPhoto(404, TINY_PNG)).rejects.toMatchObject({ status: 404 });
    expect(dishes.calls).toEqual([]);
  });

  it('validates the description before calling the recognizer', async () => {
    const dishes = fakeRecognizer(recognized([estimate('Овсянка', 0.9)]));
    const diary = diaryWith(dishes);
    for (const description of ['   ', 'x'.repeat(501)]) {
      await expect(diary.logFromText(GUEST, description)).rejects.toMatchObject({
        status: 400,
        details: [{ path: 'description' }],
      });
    }
    expect(dishes.calls).toEqual([]);
  });
});
