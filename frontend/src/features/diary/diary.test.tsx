import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderApp } from '../../../test/app.tsx';
import { json, problem, TEST_USER } from '../../../test/http.ts';
import { imageFile, useNodeFormData } from '../../../test/multipart.ts';
import type { UserProfile } from '../../api/client.ts';
import type { DiaryDay, Meal } from './queries.ts';

vi.mock('../../api/index.ts', async () => (await import('../../../test/apiModule.ts')).apiModule);
const { server, startSession } = await import('../../../test/apiModule.ts');

const TODAY = '2026-09-26';
const USER: UserProfile = { ...TEST_USER, goal: 'maintain' };

function meal(patch: Partial<Meal>): Meal {
  return {
    id: 1,
    title: 'Сырники',
    kcalMin: 380,
    kcalMax: 450,
    kcal: 415,
    proteinG: 20,
    fatG: 15,
    carbsG: 40,
    tags: [],
    source: 'photo',
    confidence: 0.8,
    eatenAt: '2026-09-26T05:30:00.000Z',
    slot: 'breakfast',
    ...patch,
  };
}

function day(date: string, meals: Meal[] = []): DiaryDay {
  const kcal = meals.reduce((sum, item) => sum + item.kcal, 0);
  return {
    date,
    timezone: 'Europe/Moscow',
    targetKcal: 2000,
    totals: {
      meals: meals.length,
      kcalMin: meals.reduce((sum, item) => sum + item.kcalMin, 0),
      kcalMax: meals.reduce((sum, item) => sum + item.kcalMax, 0),
      kcal,
      proteinG: 20,
      fatG: 15,
      carbsG: 40,
    },
    remainingKcal: Math.max(0, 2000 - kcal),
    meals,
  };
}

let days: Record<string, DiaryDay>;

async function start(user: UserProfile = USER) {
  days = { [TODAY]: day(TODAY, [meal({})]) };
  await startSession({ user });
  server.on('GET', '/api/v1/me', () => json(user));
  server.on('GET', '/api/v1/diary/today', () => json(days[TODAY]));
  server.on('GET', '/api/v1/diary/days/{date}', (call) => {
    const date = call.path.split('/').pop() ?? '';
    return json(days[date] ?? day(date));
  });
  server.on('GET', '/api/v1/diary/summary', (call) => {
    const count = Number(new URLSearchParams(call.search).get('days'));
    return json({
      days: Array.from({ length: count }, (_, index) => ({
        date: `2026-09-${String(27 - count + index).padStart(2, '0')}`,
        meals: index === count - 1 ? 1 : 0,
        kcal: index === count - 1 ? 415 : 0,
        kcalMin: 0,
        kcalMax: 0,
        proteinG: 0,
        fatG: 0,
        carbsG: 0,
      })),
    });
  });
  server.reply('GET', '/api/v1/insights', {
    readiness: 'empty',
    mealsCount: 0,
    mealsUntilReady: 5,
    daysTracked: 0,
    averageDailyKcal: null,
    topTags: [],
    slots: [],
    sweetTooth: { share: 0, typicalHour: null },
    proteinShare: null,
    today: {
      date: TODAY,
      slot: 'lunch',
      targetKcal: 2000,
      meals: 0,
      kcal: 0,
      remainingKcal: 2000,
      proteinG: 0,
      fatG: 0,
      carbsG: 0,
    },
  });
}

function chooseFile() {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]:not([capture])');
  if (input === null) throw new Error('file input missing');
  fireEvent.change(input, { target: { files: [imageFile()] } });
}

beforeEach(async () => {
  await useNodeFormData();
  vi.stubGlobal(
    'URL',
    Object.assign(URL, { createObjectURL: () => 'blob:preview', revokeObjectURL: () => undefined }),
  );
});

describe('day screen', () => {
  it('shows totals, the remaining target and meals by slot', async () => {
    await start();
    await renderApp('/diary');
    expect(await screen.findByText(/^Осталось около 1585.ккал$/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Сегодня' })).toBeTruthy();
    const breakfast = screen.getByRole('region', { name: 'Завтрак' });
    expect(within(breakfast).getByText('Сырники')).toBeTruthy();
    expect(within(breakfast).getByText('Фото')).toBeTruthy();
    expect(screen.getByText('Калорийность приблизительная, это не медицинская рекомендация.')).toBeTruthy();
  });

  it('does not judge an exceeded target', async () => {
    await start();
    days[TODAY] = day(TODAY, [meal({ kcal: 2120, kcalMin: 2100, kcalMax: 2140 })]);
    await renderApp('/diary');
    expect(await screen.findByText(/^Ориентир превышен на 120.ккал$/)).toBeTruthy();
  });

  it('asks for a goal when none is set', async () => {
    await start({ ...USER, goal: null });
    await renderApp('/diary');
    expect(await screen.findByRole('link', { name: 'Укажите цель и дневной ориентир' })).toBeTruthy();
  });

  it('hides photo and text on past days and adding on old days', async () => {
    await start();
    const { router } = await renderApp('/diary/2026-09-24');
    await screen.findByRole('heading', { name: 'чт, 24 сентября' });
    expect(screen.queryByRole('button', { name: 'Сфотографировать еду' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Ввести вручную' })).toBeTruthy();
    expect(screen.getByText('За этот день записей нет')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Следующий день' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/diary/2026-09-25');
    });

    await router.navigate('/diary/2026-09-10');
    expect(await screen.findByText('Добавлять записи можно за последние 7 дней.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Ввести вручную' })).toBeNull();
  });

  it('sends future dates back to today', async () => {
    await start();
    const { router } = await renderApp('/diary/2026-12-01');
    await screen.findByRole('heading', { name: 'Сегодня' });
    expect(router.state.location.pathname).toBe('/diary');
  });

  it('does not go past today', async () => {
    await start();
    await renderApp('/diary');
    const next = await screen.findByRole('button', { name: 'Следующий день' });
    expect(next.hasAttribute('disabled')).toBe(true);
  });

  it('refetches the day when the user returns to the app', async () => {
    await start();
    await renderApp('/diary');
    await screen.findByText('Сырники');
    const before = server.callsTo('GET', '/api/v1/diary/today').length;
    document.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() => {
      expect(server.callsTo('GET', '/api/v1/diary/today').length).toBeGreaterThan(before);
    });
  });
});

describe('photo', () => {
  it('sends the image as multipart and updates the day from the response', async () => {
    await start();
    const logged = meal({
      id: 2,
      title: 'Борщ',
      kcal: 250,
      kcalMin: 220,
      kcalMax: 280,
      slot: 'lunch',
      eatenAt: '2026-09-26T10:00:00.000Z',
    });
    server.on('POST', '/api/v1/diary/meals/photo', () =>
      json({
        status: 'logged',
        meals: [logged],
        basis: 'Тарелка супа около 300 мл',
        day: day(TODAY, [meal({}), logged]),
      }),
    );
    await renderApp('/diary');
    fireEvent.click(await screen.findByRole('button', { name: 'Сфотографировать еду' }));
    chooseFile();
    expect(await screen.findByText('Записали')).toBeTruthy();
    expect(screen.getByText('Как оценили: Тарелка супа около 300 мл')).toBeTruthy();
    expect(await screen.findByText(/^Осталось около 1335.ккал$/)).toBeTruthy();
    const call = server.callsTo('POST', '/api/v1/diary/meals/photo')[0];
    expect(call?.contentType).toMatch(/^multipart\/form-data/);
    expect(String(call?.body)).toContain('name="image"');
  });

  it('lets the user pick a candidate when unsure', async () => {
    await start();
    server.reply('POST', '/api/v1/diary/meals/photo', {
      status: 'uncertain',
      basis: 'Похоже на выпечку',
      candidates: [
        {
          title: 'Круассан',
          portionG: 70,
          kcalMin: 260,
          kcalMax: 300,
          proteinG: 5,
          fatG: 14,
          carbsG: 30,
          tags: ['pastry'],
          confidence: 0.3,
        },
      ],
    });
    const { router } = await renderApp('/diary');
    fireEvent.click(await screen.findByRole('button', { name: 'Сфотографировать еду' }));
    chooseFile();
    fireEvent.click(await screen.findByRole('button', { name: /Круассан/ }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/diary/meals/new');
    });
    expect(screen.getByLabelText<HTMLInputElement>('Название').value).toBe('Круассан');
    expect(screen.getByLabelText<HTMLInputElement>('От, ккал').value).toBe('260');
  });

  it('offers other ways when there is no food', async () => {
    await start();
    server.reply('POST', '/api/v1/diary/meals/photo', { status: 'not_food', basis: 'На фото клавиатура' });
    await renderApp('/diary');
    fireEvent.click(await screen.findByRole('button', { name: 'Сфотографировать еду' }));
    chooseFile();
    expect(await screen.findByText('На фото не нашли еду')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Сфотографировать ещё раз' })).toBeTruthy();
  });

  it.each([
    ['disabled', 'Распознавание фото сейчас выключено. Опишите блюдо словами или введите вручную'],
    ['timeout', 'Не успели распознать фото. Попробуйте ещё раз или опишите блюдо словами'],
    ['provider_error', 'Сервис распознавания не ответил. Попробуйте позже или введите блюдо вручную'],
    ['invalid_response', 'Сервис распознавания не ответил. Попробуйте позже или введите блюдо вручную'],
    ['quota_exceeded', 'Сервис распознавания не ответил. Попробуйте позже или введите блюдо вручную'],
    ['unsupported_image', 'Не удалось прочитать изображение. Пришлите фото в JPEG или PNG'],
  ])('explains unavailable reason %s', async (reason, text) => {
    await start();
    server.reply('POST', '/api/v1/diary/meals/photo', { status: 'unavailable', reason });
    await renderApp('/diary');
    fireEvent.click(await screen.findByRole('button', { name: 'Сфотографировать еду' }));
    chooseFile();
    const panel = (await screen.findByText(text)).closest('section');
    expect(panel).not.toBeNull();
    expect(within(panel!).getByRole('button', { name: 'Ввести вручную' })).toBeTruthy();
    expect(within(panel!).getByRole('button', { name: 'Описать словами' })).toBeTruthy();
  });

  it('changes the waiting text after 10 seconds of photo recognition', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await start();
    server.on('POST', '/api/v1/diary/meals/photo', () => new Promise<Response>(() => undefined));
    await renderApp('/diary');
    fireEvent.click(await screen.findByRole('button', { name: 'Сфотографировать еду' }));
    chooseFile();
    expect(await screen.findByText('Распознаём блюдо, обычно 5-10 секунд')).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    const panel = screen.getByText('Ещё немного, фото иногда распознаётся до минуты').closest('section');
    vi.useRealTimers();
    expect(panel).not.toBeNull();
    expect(within(panel!).getByRole('button', { name: 'Описать словами' })).toBeTruthy();
  });

  it('refetches the day after a lost response', async () => {
    await start();
    server.on('POST', '/api/v1/diary/meals/photo', () => {
      throw new TypeError('Failed to fetch');
    });
    await renderApp('/diary');
    await screen.findByText('Сырники');
    const before = server.callsTo('GET', '/api/v1/diary/today').length;
    fireEvent.click(screen.getByRole('button', { name: 'Сфотографировать еду' }));
    chooseFile();
    expect(await screen.findByText(/Не дождались ответа/)).toBeTruthy();
    await waitFor(() => {
      expect(server.callsTo('GET', '/api/v1/diary/today').length).toBeGreaterThan(before);
    });
  });

  it('shows the countdown on 429', async () => {
    await start();
    server.on('POST', '/api/v1/diary/meals/photo', () =>
      problem(429, 'rate_limited', { headers: { 'Retry-After': '20' } }),
    );
    await renderApp('/diary');
    fireEvent.click(await screen.findByRole('button', { name: 'Сфотографировать еду' }));
    chooseFile();
    expect(await screen.findByText('Слишком много фото подряд, попробуйте через 20 с')).toBeTruthy();
  });
});

describe('write errors', () => {
  it('opens the consent screen when a write needs consent', async () => {
    await start();
    server.on('POST', '/api/v1/diary/meals/photo', () => problem(403, 'consent_required'));
    server.reply('GET', '/api/v1/consents', { items: [] });
    const { router } = await renderApp('/diary');
    fireEvent.click(await screen.findByRole('button', { name: 'Сфотографировать еду' }));
    chooseFile();
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/onboarding/consent');
    });
  });

  it('treats a meal deleted elsewhere as deleted', async () => {
    await start();
    const logged = meal({ id: 2, title: 'Борщ' });
    server.reply('POST', '/api/v1/diary/meals/photo', {
      status: 'logged',
      meals: [logged],
      basis: 'Суп',
      day: day(TODAY, [meal({}), logged]),
    });
    server.on('DELETE', '/api/v1/diary/meals/{id}', () => problem(404, 'meal_not_found'));
    await renderApp('/diary');
    fireEvent.click(await screen.findByRole('button', { name: 'Сфотографировать еду' }));
    chooseFile();
    await screen.findByText('Записали');
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Удалить' }));
    expect(await screen.findByText('Запись уже удалена')).toBeTruthy();
  });
});

describe('logged result after switching day', () => {
  it('opens the meal on its own day', async () => {
    await start();
    const logged = meal({ id: 2, title: 'Борщ', slot: 'lunch', eatenAt: '2026-09-26T10:00:00.000Z' });
    server.on('POST', '/api/v1/diary/meals/photo', () =>
      json({ status: 'logged', meals: [logged], basis: 'по фото', day: day(TODAY, [meal({}), logged]) }),
    );
    const { router } = await renderApp('/diary');
    fireEvent.click(await screen.findByRole('button', { name: 'Сфотографировать еду' }));
    chooseFile();
    expect(await screen.findByText('Записали')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Предыдущий день' }));
    await waitFor(() => {
      expect(router.state.location.pathname).not.toBe('/diary');
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Исправить' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/diary/meals/2');
    });
    expect(router.state.location.search).toBe(`?date=${TODAY}`);
  });
});

describe('text', () => {
  it('logs a description', async () => {
    await start();
    server.on('POST', '/api/v1/diary/meals/text', () =>
      json({
        status: 'logged',
        meals: [meal({ id: 3, title: 'Капучино' })],
        basis: 'По справочнику',
        day: days[TODAY],
      }),
    );
    await renderApp('/diary');
    fireEvent.click(await screen.findByRole('button', { name: 'Описать словами' }));
    fireEvent.change(screen.getByLabelText('Что вы съели'), { target: { value: 'сырники и капучино' } });
    expect(screen.getByText('18 из 500')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Записать' }));
    expect(await screen.findByText('Капучино')).toBeTruthy();
    expect(server.callsTo('POST', '/api/v1/diary/meals/text')[0]?.body).toEqual({
      description: 'сырники и капучино',
    });
  });
});

describe('manual entry', () => {
  it('creates a meal with a range and returns to the day', async () => {
    await start();
    server.on('POST', '/api/v1/diary/meals', (call) =>
      json({ ...meal({ id: 9 }), ...(call.body as object) }),
    );
    const { router } = await renderApp('/diary/meals/new?date=2026-09-26');
    fireEvent.change(await screen.findByLabelText('Название'), { target: { value: 'Омлет' } });
    fireEvent.click(screen.getByRole('switch'));
    fireEvent.change(screen.getByLabelText('От, ккал'), { target: { value: '300' } });
    fireEvent.change(screen.getByLabelText('До, ккал'), { target: { value: '200' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить запись' }));
    expect(screen.getByText('Верхняя граница не может быть меньше нижней')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('До, ккал'), { target: { value: '360' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить запись' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/diary/2026-09-26');
    });
    expect(server.callsTo('POST', '/api/v1/diary/meals')[0]?.body).toMatchObject({
      title: 'Омлет',
      kcalMin: 300,
      kcalMax: 360,
    });
  });

  it('shows the 422 at the time field', async () => {
    await start();
    server.on('POST', '/api/v1/diary/meals', () => problem(422, 'eaten_at_out_of_range'));
    await renderApp('/diary/meals/new');
    fireEvent.change(await screen.findByLabelText('Название'), { target: { value: 'Омлет' } });
    fireEvent.change(screen.getByLabelText('Калорийность, ккал'), { target: { value: '300' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить запись' }));
    expect(await screen.findByText('Можно указать время за последние 7 дней')).toBeTruthy();
  });

  it('edits only changed fields and deletes with confirmation', async () => {
    await start();
    server.on('PATCH', '/api/v1/diary/meals/{id}', (call) => json({ ...meal({}), ...(call.body as object) }));
    server.on('DELETE', '/api/v1/diary/meals/{id}', () => new Response(null, { status: 204 }));
    const { router } = await renderApp(`/diary/meals/1?date=${TODAY}`);
    fireEvent.change(await screen.findByLabelText('Название'), { target: { value: 'Сырники со сметаной' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => {
      expect(server.callsTo('PATCH', '/api/v1/diary/meals/1')[0]?.body).toEqual({
        title: 'Сырники со сметаной',
      });
    });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/diary');
    });

    await router.navigate(`/diary/meals/1?date=${TODAY}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Удалить запись' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Удалить' }));
    expect(await screen.findByText('Запись удалена')).toBeTruthy();
    expect(server.callsTo('DELETE', '/api/v1/diary/meals/1')).toHaveLength(1);
  });

  it('handles a meal that is already gone', async () => {
    await start();
    server.on('PATCH', '/api/v1/diary/meals/{id}', () => problem(404, 'meal_not_found'));
    const { router } = await renderApp(`/diary/meals/1?date=${TODAY}`);
    fireEvent.change(await screen.findByLabelText('Название'), { target: { value: 'Другое' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByText('Запись уже удалена')).toBeTruthy();
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/diary/${TODAY}`);
    });
  });
});

describe('insights', () => {
  it('draws the week with zeros and labels and opens a day', async () => {
    await start();
    const { router } = await renderApp('/insights');
    const bar = await screen.findByRole('button', { name: /^сб, 26 сентября: 415.ккал$/ });
    expect(screen.getByRole('button', { name: /^пт, 25 сентября: 0.ккал$/ })).toBeTruthy();
    expect(screen.getByText(/^Среднее за дни с записями: 415.ккал$/)).toBeTruthy();
    fireEvent.click(bar);
    expect(router.state.location.pathname).toBe('/diary/2026-09-26');
  });

  it('switches the period', async () => {
    await start();
    await renderApp('/insights');
    await screen.findByRole('button', { name: /26 сентября/ });
    fireEvent.click(screen.getByRole('button', { name: '30 дней' }));
    await waitFor(() => {
      expect(
        server.calls.some((call) => call.path === '/api/v1/diary/summary' && call.search === '?days=30'),
      ).toBe(true);
    });
  });

  it.each([
    ['empty', 'Запишите первый приём пищи, и здесь появятся ваши привычки'],
    ['collecting', /Ещё 2 приёма пищи/],
    ['ready', /Сладкое в 80% дней, обычно около 16:00/],
  ] as const)('shows the %s profile', async (readiness, text) => {
    await start();
    server.reply('GET', '/api/v1/insights', {
      readiness,
      mealsCount: 3,
      mealsUntilReady: 2,
      daysTracked: 1,
      averageDailyKcal: readiness === 'ready' ? 1850 : null,
      topTags: readiness === 'ready' ? [{ tag: 'dessert', label: 'десерт' }] : [],
      slots:
        readiness === 'ready'
          ? [{ slot: 'snack', label: 'перекус', share: 0.8, averageKcal: 350, typicalHour: 16 }]
          : [],
      sweetTooth: { share: readiness === 'ready' ? 0.8 : 0, typicalHour: readiness === 'ready' ? 16 : null },
      proteinShare: readiness === 'ready' ? 0.18 : null,
      today: {
        date: TODAY,
        slot: 'lunch',
        targetKcal: 2000,
        meals: 0,
        kcal: 0,
        remainingKcal: 2000,
        proteinG: 0,
        fatG: 0,
        carbsG: 0,
      },
    });
    await renderApp('/insights');
    expect(await screen.findByText(text)).toBeTruthy();
    if (readiness === 'ready') {
      expect(screen.getByText(/Перекус в 80% дней, обычно около 16:00, примерно 350.ккал/)).toBeTruthy();
    }
  });
});
