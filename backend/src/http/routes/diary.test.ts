import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { expectContract } from '../../../test/contract.ts';
import { multipart, TINY_PNG } from '../../../test/multipart.ts';
import { bearer, buildTestApp, fakeServices } from '../../../test/services.ts';
import type { DiaryDay, DiaryMeal, DiaryService, MealLogResult } from '../../services/diary.ts';
import { forbidden, notFound, unprocessable } from '../../shared/errors.ts';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

const meal: DiaryMeal = {
  id: 7,
  userId: 101,
  title: 'Сырники',
  kcalMin: 320,
  kcalMax: 381,
  proteinG: 18,
  fatG: null,
  carbsG: 30.5,
  tags: ['dairy', 'breakfast'],
  source: 'photo',
  confidence: 0.82,
  eatenAt: new Date('2026-09-25T05:30:00Z'),
  createdAt: new Date('2026-09-25T05:30:01Z'),
  slot: 'breakfast',
};

const mealJson = {
  id: 7,
  title: 'Сырники',
  kcalMin: 320,
  kcalMax: 381,
  kcal: 351,
  proteinG: 18,
  fatG: null,
  carbsG: 30.5,
  tags: ['dairy', 'breakfast'],
  source: 'photo',
  confidence: 0.82,
  eatenAt: '2026-09-25T05:30:00.000Z',
  slot: 'breakfast',
};

const day: DiaryDay = {
  date: '2026-09-25',
  timezone: 'Europe/Moscow',
  targetKcal: 2000,
  totals: { meals: 1, kcalMin: 320, kcalMax: 381, kcal: 351, proteinG: 18, fatG: 0, carbsG: 30.5 },
  remainingKcal: 1649,
  meals: [meal],
};

const dayJson = {
  date: '2026-09-25',
  timezone: 'Europe/Moscow',
  targetKcal: 2000,
  totals: { meals: 1, kcalMin: 320, kcalMax: 381, kcal: 351, proteinG: 18, fatG: 0, carbsG: 30.5 },
  remainingKcal: 1649,
  meals: [mealJson],
};

function photoUpload(token: string | null, field = 'image', data = TINY_PNG) {
  const body = multipart([{ field, filename: 'dish.png', contentType: 'image/png', data }]);
  return {
    method: 'POST' as const,
    url: '/api/v1/diary/meals/photo',
    payload: body.payload,
    headers: token ? { ...body.headers, ...bearer(token) } : body.headers,
  };
}

function diaryService(overrides: Partial<DiaryService>): { diary: DiaryService } {
  return { diary: { ...fakeServices().diary, ...overrides } };
}

describe('GET /api/v1/diary/today and /api/v1/diary/days/{date}', () => {
  it('returns today when no date is given', async () => {
    const requested: (string | undefined)[] = [];
    app = await buildTestApp({
      services: diaryService({
        day: (_id, date) => {
          requested.push(date);
          return Promise.resolve(day);
        },
      }),
    });
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/diary/today',
      headers: bearer('guest-token'),
    });
    expect(response.statusCode).toBe(200);
    expectContract(response, 'GET', '/api/v1/diary/today');
    expect(response.json()).toEqual(dayJson);
    expect(requested).toEqual([undefined]);
  });

  it('returns the requested day', async () => {
    const requested: (string | undefined)[] = [];
    app = await buildTestApp({
      services: diaryService({
        day: (_id, date) => {
          requested.push(date);
          return Promise.resolve({ ...day, date: date ?? day.date, meals: [], remainingKcal: 2000 });
        },
      }),
    });
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/diary/days/2026-09-24',
      headers: bearer('guest-token'),
    });
    expect(response.statusCode).toBe(200);
    expectContract(response, 'GET', '/api/v1/diary/days/{date}');
    expect(response.json()).toMatchObject({ date: '2026-09-24', meals: [] });
    expect(requested).toEqual(['2026-09-24']);
  });

  it('rejects dates that are not calendar dates', async () => {
    app = await buildTestApp();
    for (const date of ['2026-02-30', '25.09.2026', '0999-01-01']) {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/diary/days/${date}`,
        headers: bearer('guest-token'),
      });
      expect(response.statusCode, date).toBe(400);
      expectContract(response, 'GET', '/api/v1/diary/days/{date}');
      expect(response.json()).toMatchObject({ code: 'validation_failed', errors: [{ path: 'params.date' }] });
    }
  });

  it('answers 404 for a deleted account', async () => {
    app = await buildTestApp({
      services: diaryService({ day: () => Promise.reject(notFound('user_not_found', 'User not found')) }),
    });
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/diary/today',
      headers: bearer('guest-token'),
    });
    expect(response.statusCode).toBe(404);
    expectContract(response, 'GET', '/api/v1/diary/today');
  });

  it('requires authentication', async () => {
    app = await buildTestApp();
    for (const url of ['/api/v1/diary/today', '/api/v1/diary/days/2026-09-25']) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(401);
      expectContract(response, 'GET', url.endsWith('today') ? url : '/api/v1/diary/days/{date}');
    }
  });
});

describe('GET /api/v1/diary/summary', () => {
  it('asks for 7 days by default', async () => {
    const requested: number[] = [];
    app = await buildTestApp({
      services: diaryService({
        summary: (_id, days) => {
          requested.push(days);
          return Promise.resolve([
            {
              date: '2026-09-24',
              meals: 0,
              kcalMin: 0,
              kcalMax: 0,
              kcal: 0,
              proteinG: 0,
              fatG: 0,
              carbsG: 0,
            },
            { date: '2026-09-25', ...day.totals },
          ]);
        },
      }),
    });
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/diary/summary',
      headers: bearer('guest-token'),
    });
    expect(response.statusCode).toBe(200);
    expectContract(response, 'GET', '/api/v1/diary/summary');
    expect(response.json()).toEqual({
      days: [
        { date: '2026-09-24', meals: 0, kcal: 0, kcalMin: 0, kcalMax: 0, proteinG: 0, fatG: 0, carbsG: 0 },
        {
          date: '2026-09-25',
          meals: 1,
          kcal: 351,
          kcalMin: 320,
          kcalMax: 381,
          proteinG: 18,
          fatG: 0,
          carbsG: 30.5,
        },
      ],
    });
    expect(requested).toEqual([7]);
  });

  it('passes the requested number of days and rejects values outside 1 to 31', async () => {
    const requested: number[] = [];
    app = await buildTestApp({
      services: diaryService({
        summary: (_id, days) => {
          requested.push(days);
          return Promise.resolve([]);
        },
      }),
    });
    const ok = await app.inject({
      method: 'GET',
      url: '/api/v1/diary/summary?days=31',
      headers: bearer('guest-token'),
    });
    expect(ok.statusCode).toBe(200);
    expect(requested).toEqual([31]);
    for (const days of ['0', '32', 'week', '2.5']) {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/diary/summary?days=${days}`,
        headers: bearer('guest-token'),
      });
      expect(response.statusCode, days).toBe(400);
      expectContract(response, 'GET', '/api/v1/diary/summary');
      expect(response.json()).toMatchObject({ errors: [{ path: 'querystring.days' }] });
    }
  });
});

describe('POST /api/v1/diary/meals', () => {
  it('creates a manual meal and converts eatenAt to a date', async () => {
    const received: unknown[] = [];
    app = await buildTestApp({
      services: diaryService({
        addManual: (_id, input) => {
          received.push(input);
          return Promise.resolve({ ...meal, source: 'manual', confidence: null });
        },
      }),
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/diary/meals',
      headers: bearer('guest-token'),
      payload: { title: ' Сырники ', kcal: 350, tags: ['dairy'], eatenAt: '2026-09-25T08:30:00+03:00' },
    });
    expect(response.statusCode).toBe(201);
    expectContract(response, 'POST', '/api/v1/diary/meals');
    expect(response.json()).toEqual({ ...mealJson, source: 'manual', confidence: null });
    expect(received).toEqual([
      { title: 'Сырники', kcal: 350, tags: ['dairy'], eatenAt: new Date('2026-09-25T05:30:00Z') },
    ]);
  });

  it('accepts a calorie range', async () => {
    app = await buildTestApp({ services: diaryService({ addManual: () => Promise.resolve(meal) }) });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/diary/meals',
      headers: bearer('guest-token'),
      payload: { title: 'Сырники', kcalMin: 320, kcalMax: 381, proteinG: 18 },
    });
    expect(response.statusCode).toBe(201);
  });

  it('validates the body including both calorie forms', async () => {
    app = await buildTestApp();
    const cases = [
      [{ kcal: 350 }, 'body.title'],
      [{ title: '', kcal: 350 }, 'body.title'],
      [{ title: 'x'.repeat(201), kcal: 350 }, 'body.title'],
      [{ title: 'Сырники' }, 'body.kcal'],
      [{ title: 'Сырники', kcal: 350, kcalMin: 300, kcalMax: 400 }, 'body.kcal'],
      [{ title: 'Сырники', kcalMin: 300 }, 'body.kcalMax'],
      [{ title: 'Сырники', kcalMin: 400, kcalMax: 300 }, 'body.kcalMax'],
      [{ title: 'Сырники', kcal: 5001 }, 'body.kcal'],
      [{ title: 'Сырники', kcal: -1 }, 'body.kcal'],
      [{ title: 'Сырники', kcal: 350, proteinG: 501 }, 'body.proteinG'],
      [{ title: 'Сырники', kcal: 350, tags: ['unknown'] }, 'body.tags.0'],
      [{ title: 'Сырники', kcal: 350, eatenAt: 'yesterday' }, 'body.eatenAt'],
    ] as const;
    for (const [payload, path] of cases) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/diary/meals',
        headers: bearer('guest-token'),
        payload,
      });
      expect(response.statusCode, JSON.stringify(payload)).toBe(400);
      expectContract(response, 'POST', '/api/v1/diary/meals');
      expect(response.json(), JSON.stringify(payload)).toMatchObject({
        code: 'validation_failed',
        errors: [{ path }],
      });
    }
  });

  it('passes consent, account and time window errors through', async () => {
    for (const error of [
      forbidden('consent_required', 'Consent is required'),
      notFound('user_not_found', 'User not found'),
      unprocessable('eaten_at_out_of_range', 'Too old'),
    ]) {
      app = await buildTestApp({ services: diaryService({ addManual: () => Promise.reject(error) }) });
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/diary/meals',
        headers: bearer('guest-token'),
        payload: { title: 'Сырники', kcal: 350 },
      });
      expect(response.statusCode).toBe(error.status);
      expectContract(response, 'POST', '/api/v1/diary/meals');
      expect(response.json()).toMatchObject({ code: error.code });
      await app.close();
      app = undefined;
    }
  });

  it('requires authentication before validating the body', async () => {
    app = await buildTestApp();
    const response = await app.inject({ method: 'POST', url: '/api/v1/diary/meals', payload: {} });
    expect(response.statusCode).toBe(401);
    expectContract(response, 'POST', '/api/v1/diary/meals');
  });
});

const results: MealLogResult[] = [
  { status: 'logged', meals: [meal], basis: 'Видны сырники со сметаной', day },
  {
    status: 'uncertain',
    candidates: [
      {
        title: 'Суп',
        portionG: null,
        kcalMin: 150,
        kcalMax: 250,
        proteinG: 6,
        fatG: 5,
        carbsG: 20,
        tags: ['soup'],
        confidence: 0.3,
      },
    ],
    basis: 'Похоже на суп',
  },
  { status: 'not_food', basis: 'На фото кошка' },
  { status: 'unavailable', reason: 'disabled' },
];

describe('POST /api/v1/diary/meals/photo', () => {
  it('returns every recognition outcome in the contract shape', async () => {
    for (const result of results) {
      const images: Buffer[] = [];
      app = await buildTestApp({
        services: diaryService({
          logFromPhoto: (_id, image) => {
            images.push(image);
            return Promise.resolve(result);
          },
        }),
      });
      const response = await app.inject(photoUpload('guest-token'));
      expect(response.statusCode, result.status).toBe(200);
      expectContract(response, 'POST', '/api/v1/diary/meals/photo');
      expect(response.json()).toMatchObject({ status: result.status });
      expect(images).toEqual([TINY_PNG]);
      await app.close();
      app = undefined;
    }
  });

  it('maps a logged result to meals and the refreshed day', async () => {
    app = await buildTestApp({
      services: diaryService({ logFromPhoto: () => Promise.resolve(results[0]!) }),
    });
    const response = await app.inject(photoUpload('guest-token'));
    expect(response.json()).toEqual({
      status: 'logged',
      meals: [mealJson],
      basis: 'Видны сырники со сметаной',
      day: dayJson,
    });
  });

  it('rejects uploads that are not images before recognition', async () => {
    app = await buildTestApp();
    const notImage = await app.inject(photoUpload('guest-token', 'image', Buffer.from('text')));
    expect(notImage.statusCode).toBe(415);
    expectContract(notImage, 'POST', '/api/v1/diary/meals/photo');
    expect(notImage.json()).toMatchObject({ code: 'unsupported_image_type' });

    const noImage = await app.inject(photoUpload('guest-token', 'photo'));
    expect(noImage.statusCode).toBe(400);
    expectContract(noImage, 'POST', '/api/v1/diary/meals/photo');
    expect(noImage.json()).toMatchObject({ code: 'image_required' });

    const json = await app.inject({
      method: 'POST',
      url: '/api/v1/diary/meals/photo',
      headers: bearer('guest-token'),
      payload: { image: 'x' },
    });
    expect(json.statusCode).toBe(415);
    expectContract(json, 'POST', '/api/v1/diary/meals/photo');
  });

  it('answers 403 without consent', async () => {
    app = await buildTestApp({
      services: diaryService({
        logFromPhoto: () => Promise.reject(forbidden('consent_required', 'Consent')),
      }),
    });
    const response = await app.inject(photoUpload('guest-token'));
    expect(response.statusCode).toBe(403);
    expectContract(response, 'POST', '/api/v1/diary/meals/photo');
  });

  it('requires authentication', async () => {
    app = await buildTestApp();
    const response = await app.inject(photoUpload(null));
    expect(response.statusCode).toBe(401);
    expectContract(response, 'POST', '/api/v1/diary/meals/photo');
  });
});

describe('POST /api/v1/diary/meals/text', () => {
  it('returns every recognition outcome in the contract shape', async () => {
    for (const result of results) {
      const descriptions: string[] = [];
      app = await buildTestApp({
        services: diaryService({
          logFromText: (_id, description) => {
            descriptions.push(description);
            return Promise.resolve(result);
          },
        }),
      });
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/diary/meals/text',
        headers: bearer('guest-token'),
        payload: { description: '  сырники со сметаной ' },
      });
      expect(response.statusCode, result.status).toBe(200);
      expectContract(response, 'POST', '/api/v1/diary/meals/text');
      expect(response.json()).toMatchObject({ status: result.status });
      expect(descriptions).toEqual(['сырники со сметаной']);
      await app.close();
      app = undefined;
    }
  });

  it('validates the description', async () => {
    app = await buildTestApp();
    for (const description of ['   ', 'x'.repeat(501)]) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/diary/meals/text',
        headers: bearer('guest-token'),
        payload: { description },
      });
      expect(response.statusCode).toBe(400);
      expectContract(response, 'POST', '/api/v1/diary/meals/text');
      expect(response.json()).toMatchObject({ errors: [{ path: 'body.description' }] });
    }
  });

  it('limits recognition to 20 requests a minute per user', async () => {
    app = await buildTestApp({ services: diaryService({ logFromText: () => Promise.resolve(results[3]!) }) });
    const send = () =>
      app!.inject({
        method: 'POST',
        url: '/api/v1/diary/meals/text',
        headers: bearer('guest-token'),
        payload: { description: 'сырники' },
      });
    for (let index = 0; index < 20; index += 1) {
      expect((await send()).statusCode).toBe(200);
    }
    const limited = await send();
    expect(limited.statusCode).toBe(429);
    expectContract(limited, 'POST', '/api/v1/diary/meals/text');
    const otherUser = await app.inject({
      method: 'POST',
      url: '/api/v1/diary/meals/text',
      headers: bearer('venue-token'),
      payload: { description: 'сырники' },
    });
    expect(otherUser.statusCode).toBe(200);
  });
});

describe('PATCH /api/v1/diary/meals/{id}', () => {
  it('updates a meal', async () => {
    const received: unknown[] = [];
    app = await buildTestApp({
      services: diaryService({
        update: (_id, mealId, patch) => {
          received.push([mealId, patch]);
          return Promise.resolve({ ...meal, title: 'Творог', proteinG: null });
        },
      }),
    });
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/diary/meals/7',
      headers: bearer('guest-token'),
      payload: { title: 'Творог', proteinG: null },
    });
    expect(response.statusCode).toBe(200);
    expectContract(response, 'PATCH', '/api/v1/diary/meals/{id}');
    expect(response.json()).toMatchObject({ id: 7, title: 'Творог', proteinG: null });
    expect(received).toEqual([[7, { title: 'Творог', proteinG: null }]]);
  });

  it('validates the id and the patch', async () => {
    app = await buildTestApp();
    const cases = [
      ['/api/v1/diary/meals/abc', { title: 'Творог' }, 'params.id'],
      ['/api/v1/diary/meals/0', { title: 'Творог' }, 'params.id'],
      ['/api/v1/diary/meals/7', {}, 'body'],
      ['/api/v1/diary/meals/7', { kcalMin: 100 }, 'body.kcalMax'],
      ['/api/v1/diary/meals/7', { kcal: 100, kcalMin: 50, kcalMax: 150 }, 'body.kcal'],
    ] as const;
    for (const [url, payload, path] of cases) {
      const response = await app.inject({ method: 'PATCH', url, headers: bearer('guest-token'), payload });
      expect(response.statusCode, url + JSON.stringify(payload)).toBe(400);
      expectContract(response, 'PATCH', '/api/v1/diary/meals/{id}');
      expect(response.json()).toMatchObject({ errors: [{ path }] });
    }
  });

  it('passes service errors through', async () => {
    for (const error of [
      forbidden('consent_required', 'Consent is required'),
      notFound('meal_not_found', 'Meal not found'),
      unprocessable('eaten_at_out_of_range', 'Too old'),
    ]) {
      app = await buildTestApp({ services: diaryService({ update: () => Promise.reject(error) }) });
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/v1/diary/meals/7',
        headers: bearer('guest-token'),
        payload: { eatenAt: '2026-09-01T10:00:00Z' },
      });
      expect(response.statusCode).toBe(error.status);
      expectContract(response, 'PATCH', '/api/v1/diary/meals/{id}');
      expect(response.json()).toMatchObject({ code: error.code });
      await app.close();
      app = undefined;
    }
  });
});

describe('DELETE /api/v1/diary/meals/{id}', () => {
  it('deletes a meal', async () => {
    const removed: [number, number][] = [];
    app = await buildTestApp({
      services: diaryService({
        remove: (id, mealId) => {
          removed.push([id, mealId]);
          return Promise.resolve();
        },
      }),
    });
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/v1/diary/meals/7',
      headers: bearer('guest-token'),
    });
    expect(response.statusCode).toBe(204);
    expectContract(response, 'DELETE', '/api/v1/diary/meals/{id}');
    expect(removed).toEqual([[101, 7]]);
  });

  it('answers 404 for a foreign meal and 400 for a bad id', async () => {
    app = await buildTestApp({
      services: diaryService({ remove: () => Promise.reject(notFound('meal_not_found', 'Meal not found')) }),
    });
    const foreign = await app.inject({
      method: 'DELETE',
      url: '/api/v1/diary/meals/8',
      headers: bearer('guest-token'),
    });
    expect(foreign.statusCode).toBe(404);
    expectContract(foreign, 'DELETE', '/api/v1/diary/meals/{id}');
    expect(foreign.json()).toMatchObject({ code: 'meal_not_found' });

    const bad = await app.inject({
      method: 'DELETE',
      url: '/api/v1/diary/meals/x',
      headers: bearer('guest-token'),
    });
    expect(bad.statusCode).toBe(400);
    expectContract(bad, 'DELETE', '/api/v1/diary/meals/{id}');
  });

  it('requires authentication', async () => {
    app = await buildTestApp();
    const response = await app.inject({ method: 'DELETE', url: '/api/v1/diary/meals/7' });
    expect(response.statusCode).toBe(401);
    expectContract(response, 'DELETE', '/api/v1/diary/meals/{id}');
  });
});
