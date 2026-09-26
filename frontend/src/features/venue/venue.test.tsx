import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderApp } from '../../../test/app.tsx';
import { json, problem } from '../../../test/http.ts';
import { readImportDraft, saveImportDraft } from './importDraft.ts';
import type { MenuImport, MenuItem, Venue } from './model.ts';

vi.mock('../../api/index.ts', async () => (await import('../../../test/apiModule.ts')).apiModule);
const { server, startSession } = await import('../../../test/apiModule.ts');

const VENUE: Venue = {
  id: 7,
  name: 'Кофейня «Зерно»',
  address: 'Казань, ул. Баумана, 36',
  category: 'coffee',
  location: { lat: 55.7963, lon: 49.1088 },
  opensAt: '00:00',
  closesAt: '00:00',
  timezone: 'Europe/Moscow',
  isDemo: true,
};

function item(id: number, patch: Partial<MenuItem> = {}): MenuItem {
  return {
    id,
    name: `Позиция ${String(id)}`,
    description: null,
    category: 'drink',
    priceRub: 190,
    weightG: 250,
    kcal: 120,
    proteinG: null,
    fatG: null,
    carbsG: null,
    nutritionSource: 'venue',
    tags: [],
    isAvailable: true,
    ...patch,
  };
}

function menuImport(patch: Partial<MenuImport> = {}): MenuImport {
  return {
    id: 11,
    source: 'text',
    status: 'processing',
    items: [],
    error: null,
    createdAt: '2026-09-26T10:00:00.000Z',
    completedAt: null,
    ...patch,
  };
}

const PARSED: MenuImport['items'] = [
  {
    name: 'Сырники',
    description: null,
    category: 'breakfast',
    priceRub: 320,
    weightG: 210,
    kcal: 480,
    proteinG: 20,
    fatG: 18,
    carbsG: 55,
    tags: [],
  },
  {
    name: 'Позиция 1',
    description: null,
    category: 'drink',
    priceRub: 190,
    weightG: null,
    kcal: 120,
    proteinG: 1,
    fatG: 1,
    carbsG: 1,
    tags: [],
  },
  {
    name: 'Морс',
    description: null,
    category: 'drink',
    priceRub: null,
    weightG: 300,
    kcal: 90,
    proteinG: 0,
    fatG: 0,
    carbsG: 22,
    tags: [],
  },
];

let menu: MenuItem[];

async function start(venue: Venue | null = VENUE) {
  menu = [item(1), item(2, { category: 'dessert', isAvailable: false, nutritionSource: 'estimate' })];
  await startSession();
  server.on('GET', '/api/v1/venue', () => (venue === null ? problem(404, 'venue_not_found') : json(venue)));
  server.on('GET', '/api/v1/venue/menu', () =>
    venue === null ? problem(404, 'venue_not_found') : json({ items: menu }),
  );
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('cabinet', () => {
  it('creates a venue from the empty state', async () => {
    await start(null);
    server.on('POST', '/api/v1/venue', (call) => json({ ...VENUE, ...(call.body as object) }, 201));
    const { router } = await renderApp('/venue');
    fireEvent.click(await screen.findByRole('button', { name: 'Создать заведение' }));
    fireEvent.change(await screen.findByLabelText('Название'), { target: { value: 'Зерно' } });
    fireEvent.change(screen.getByLabelText('Адрес'), { target: { value: 'Казань, Баумана, 36' } });
    fireEvent.click(screen.getByLabelText('Кофейня'));
    fireEvent.change(screen.getByLabelText('Координаты'), { target: { value: '55.7963 49.1088' } });
    server.on('GET', '/api/v1/venue', () => json(VENUE));
    fireEvent.click(screen.getByRole('button', { name: 'Создать заведение' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/venue');
    });
    expect(server.callsTo('POST', '/api/v1/venue')[0]?.body).toEqual({
      name: 'Зерно',
      address: 'Казань, Баумана, 36',
      category: 'coffee',
      location: { lat: 55.7963, lon: 49.1088 },
      opensAt: '08:00',
      closesAt: '22:00',
      timezone: 'Europe/Moscow',
    });
    expect(await screen.findByText('Заведение создано')).toBeTruthy();
  });

  it('shows field errors before sending and the server conflict after', async () => {
    await start(null);
    server.on('POST', '/api/v1/venue', () => problem(409, 'venue_exists'));
    const { router } = await renderApp('/venue/settings');
    fireEvent.click(await screen.findByRole('button', { name: 'Создать заведение' }));
    expect(screen.getByText('Введите название')).toBeTruthy();
    expect(screen.getByText('Укажите координаты')).toBeTruthy();
    expect(server.callsTo('POST', '/api/v1/venue')).toHaveLength(0);

    fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Зерно' } });
    fireEvent.change(screen.getByLabelText('Адрес'), { target: { value: 'Казань' } });
    fireEvent.click(screen.getByLabelText('Пекарня'));
    fireEvent.change(screen.getByLabelText('Координаты'), { target: { value: '55.79, 49.10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать заведение' }));
    expect(await screen.findByText('У вас уже есть заведение')).toBeTruthy();
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/venue');
    });
  });

  it('sends only changed venue fields and asks before leaving with changes', async () => {
    await start();
    server.on('PATCH', '/api/v1/venue', (call) => json({ ...VENUE, ...(call.body as object) }));
    const { router } = await renderApp('/venue/settings');
    fireEvent.change(await screen.findByLabelText('Закрытие'), { target: { value: '02:00' } });
    await act(async () => {
      await router.navigate('/venue');
    });
    expect(await screen.findByText('Уйти без сохранения?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Остаться' }));
    expect(router.state.location.pathname).toBe('/venue/settings');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/venue');
    });
    expect(server.callsTo('PATCH', '/api/v1/venue')[0]?.body).toEqual({ closesAt: '02:00' });
  });

  it('shows the venue with hours, the open flag and the menu size', async () => {
    await start();
    await renderApp('/venue');
    expect(await screen.findByRole('heading', { name: 'Кофейня «Зерно»' })).toBeTruthy();
    expect(screen.getByText('00:00-00:00')).toBeTruthy();
    expect(screen.getByText('Открыто сейчас')).toBeTruthy();
    expect(screen.getByText('Заведение и меню тестовые')).toBeTruthy();
    expect(await screen.findByText('2 позиции')).toBeTruthy();
  });

  it('sends a user without a venue back to the empty state', async () => {
    await start(null);
    const { router } = await renderApp('/venue/menu');
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/venue');
    });
    expect(await screen.findByText('У вас пока нет заведения')).toBeTruthy();
  });

  it('shows the guest link with a QR code', async () => {
    await start();
    await renderApp('/venue/link');
    const qr = await screen.findByRole('img', { name: 'QR-код ссылки на заведение' });
    expect(qr.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
    expect(screen.getByText(/startapp=venue_7$/)).toBeTruthy();
  });
});

describe('menu', () => {
  it('groups items and rolls back a failed availability switch', async () => {
    await start();
    const gate: { fail?: () => void } = {};
    server.on(
      'PATCH',
      '/api/v1/venue/menu/items/{id}',
      () =>
        new Promise<Response>((resolve) => {
          gate.fail = () => {
            resolve(problem(503, 'unavailable'));
          };
        }),
    );
    await renderApp('/venue/menu');
    const drinks = await screen.findByRole('region', { name: 'Напитки' });
    expect(screen.getByRole('region', { name: 'Десерты' })).toBeTruthy();
    expect(screen.getByText('Скрыто')).toBeTruthy();
    expect(screen.getByText('Ккал по оценке')).toBeTruthy();
    fireEvent.click(within(drinks).getByRole('switch'));
    await waitFor(() => {
      expect(within(drinks).getByRole<HTMLInputElement>('switch').checked).toBe(false);
    });
    gate.fail?.();
    await waitFor(() => {
      expect(within(drinks).getByRole<HTMLInputElement>('switch').checked).toBe(true);
    });
    expect(screen.getByText('Сервис временно недоступен')).toBeTruthy();
    expect(server.callsTo('PATCH', '/api/v1/venue/menu/items/1')[0]?.body).toEqual({ isAvailable: false });
  });

  it('creates an item and explains a deal price conflict on edit', async () => {
    await start();
    server.on('POST', '/api/v1/venue/menu/items', (call) =>
      json({ ...item(3), ...(call.body as object) }, 201),
    );
    server.on('PATCH', '/api/v1/venue/menu/items/{id}', () => problem(422, 'deal_price_not_lower'));
    const { router } = await renderApp('/venue/menu/new');
    fireEvent.change(await screen.findByLabelText('Название'), { target: { value: 'Морс' } });
    fireEvent.change(screen.getByLabelText('Категория'), { target: { value: 'drink' } });
    fireEvent.change(screen.getByLabelText('Цена, ₽'), { target: { value: '150' } });
    fireEvent.change(screen.getByLabelText('Ккал'), { target: { value: '90' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить позицию' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/venue/menu');
    });
    expect(server.callsTo('POST', '/api/v1/venue/menu/items')[0]?.body).toMatchObject({
      name: 'Морс',
      category: 'drink',
      priceRub: 150,
      kcal: 90,
      isAvailable: true,
    });

    await act(async () => {
      await router.navigate('/venue/menu/1');
    });
    expect(await screen.findByText('Калорийность указана заведением')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Цена, ₽'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(
      await screen.findByText(
        'Есть горящее предложение по цене не ниже новой. Снимите его или укажите цену выше',
      ),
    ).toBeTruthy();
    expect(server.callsTo('PATCH', '/api/v1/venue/menu/items/1')[0]?.body).toEqual({ priceRub: 100 });
  });

  it('deletes an item after confirmation', async () => {
    await start();
    server.on('DELETE', '/api/v1/venue/menu/items/{id}', () => new Response(null, { status: 204 }));
    const { router } = await renderApp('/venue/menu/2');
    fireEvent.click(await screen.findByRole('button', { name: 'Удалить из меню' }));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText(/горящее предложение по ней будет снято/)).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Удалить' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/venue/menu');
    });
    expect(server.callsTo('DELETE', '/api/v1/venue/menu/items/2')).toHaveLength(1);
    expect(screen.queryByText('Позиция 2')).toBeNull();
  });
});

describe('menu import', () => {
  it('polls a text import until it is ready and stops on leaving', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await start();
    let status: MenuImport = menuImport();
    server.on('POST', '/api/v1/venue/menu/imports/text', () => json(status, 202));
    server.on('GET', '/api/v1/venue/menu/imports/{id}', () => json(status));
    const { router } = await renderApp('/venue/menu/import?mode=text');
    fireEvent.change(await screen.findByLabelText('Текст меню'), { target: { value: 'Сырники 320 р' } });
    fireEvent.click(screen.getByRole('button', { name: 'Распознать' }));
    expect(await screen.findByText(/Распознаём меню/)).toBeTruthy();
    expect(router.state.location.pathname).toBe('/venue/menu/import/11');
    expect(readImportDraft()).toEqual({ venueId: 7, importId: 11, rows: null });
    expect(server.callsTo('POST', '/api/v1/venue/menu/imports/text')[0]?.body).toEqual({
      text: 'Сырники 320 р',
    });

    status = menuImport({ status: 'ready', items: PARSED });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(await screen.findByText('Найдено 3 позиции, выбрано 2')).toBeTruthy();

    const polls = server.callsTo('GET', '/api/v1/venue/menu/imports/11').length;
    await act(async () => {
      await router.navigate('/venue/menu');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(server.callsTo('GET', '/api/v1/venue/menu/imports/11')).toHaveLength(polls);
  });

  it('stops polling after three minutes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await start();
    server.on('GET', '/api/v1/venue/menu/imports/{id}', () => json(menuImport()));
    await renderApp('/venue/menu/import/11');
    expect(await screen.findByText(/Распознаём меню/)).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3 * 60_000 + 100);
    });
    expect(await screen.findByText('Распознавание идёт дольше обычного')).toBeTruthy();
    const polls = server.callsTo('GET', '/api/v1/venue/menu/imports/11').length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(server.callsTo('GET', '/api/v1/venue/menu/imports/11')).toHaveLength(polls);
    fireEvent.click(screen.getByRole('button', { name: 'Проверить ещё раз' }));
    await waitFor(() => {
      expect(server.callsTo('GET', '/api/v1/venue/menu/imports/11')).toHaveLength(polls + 1);
    });
  });

  it('blocks a missing price, skips duplicates and maps server errors to the row', async () => {
    await start();
    saveImportDraft({ venueId: 7, importId: 11, rows: null });
    server.on('GET', '/api/v1/venue/menu/imports/{id}', () =>
      json(menuImport({ status: 'ready', items: PARSED })),
    );
    server.on('POST', '/api/v1/venue/menu/imports/{id}/apply', () =>
      problem(400, 'validation_failed', {
        errors: [{ path: 'body.items.1.kcal', message: 'Слишком много' }],
      }),
    );
    await renderApp('/venue/menu/import/11');
    expect(await screen.findByText('Уже есть в меню')).toBeTruthy();
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'Добавить: Позиция 1' }).checked).toBe(
      false,
    );
    const add = screen.getByRole('button', { name: 'Добавить в меню (2)' });
    expect(add.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText(/^Исправьте 1 позицию/)).toBeTruthy();

    const row = document.getElementById('row-2');
    if (row === null) throw new Error('row missing');
    fireEvent.change(within(row).getByLabelText('Цена, ₽'), { target: { value: '150' } });
    expect(readImportDraft()?.rows?.[2]?.form.priceRub).toBe('150');
    fireEvent.click(screen.getByRole('button', { name: 'Добавить в меню (2)' }));
    expect(await within(row).findByText('Слишком много')).toBeTruthy();
    expect(server.callsTo('POST', '/api/v1/venue/menu/imports/11/apply')[0]?.body).toMatchObject({
      items: [{ name: 'Сырники' }, { name: 'Морс', priceRub: 150 }],
    });
  });

  it('applies the import and restores edits from the saved draft', async () => {
    await start();
    server.on('GET', '/api/v1/venue/menu/imports/{id}', () =>
      json(menuImport({ status: 'ready', items: PARSED })),
    );
    server.on('POST', '/api/v1/venue/menu/imports/{id}/apply', () =>
      json({ items: [item(5), item(6)] }, 201),
    );
    const first = await renderApp('/venue/menu/import/11');
    const row = await waitFor(() => {
      const found = document.getElementById('row-2');
      if (found === null) throw new Error('row missing');
      return found;
    });
    fireEvent.change(within(row).getByLabelText('Цена, ₽'), { target: { value: '140' } });
    first.unmount();

    const { router } = await renderApp('/venue/menu/import/11');
    await screen.findByText('Найдено 3 позиции, выбрано 2');
    expect(screen.getByText('140 ₽', { exact: false })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить в меню (2)' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/venue/menu');
    });
    expect(await screen.findByText('Добавлено 2 позиции')).toBeTruthy();
    expect(readImportDraft()).toBeNull();
  });

  it('shows the failure text from the server and forgets the import', async () => {
    await start();
    saveImportDraft({ venueId: 7, importId: 11, rows: null });
    server.on('GET', '/api/v1/venue/menu/imports/{id}', () =>
      json(
        menuImport({
          status: 'failed',
          error: 'Распознавание меню временно недоступно, добавьте позиции вручную',
        }),
      ),
    );
    await renderApp('/venue/menu/import/11');
    expect(
      await screen.findByText('Распознавание меню временно недоступно, добавьте позиции вручную'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Добавить вручную' })).toBeTruthy();
    await waitFor(() => {
      expect(readImportDraft()).toBeNull();
    });
  });

  it('offers to continue an unfinished import from the menu', async () => {
    await start();
    saveImportDraft({ venueId: 7, importId: 11, rows: null });
    server.on('GET', '/api/v1/venue/menu/imports/{id}', () => json(menuImport()));
    const { router } = await renderApp('/venue/menu');
    fireEvent.click(await screen.findByRole('button', { name: 'Продолжить' }));
    expect(router.state.location.pathname).toBe('/venue/menu/import/11');
  });

  it('explains limits when starting an import', async () => {
    await start();
    saveImportDraft({ venueId: 7, importId: 11, rows: null });
    server.on('POST', '/api/v1/venue/menu/imports/text', () => problem(409, 'import_in_progress'));
    const { router } = await renderApp('/venue/menu/import?mode=text');
    fireEvent.change(await screen.findByLabelText('Текст меню'), { target: { value: 'Чай 50 р' } });
    fireEvent.click(screen.getByRole('button', { name: 'Распознать' }));
    expect(await screen.findByText(/Предыдущее меню ещё распознаётся/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Открыть' }));
    expect(router.state.location.pathname).toBe('/venue/menu/import/11');

    await act(async () => {
      await router.navigate('/venue/menu/import?mode=text');
    });
    server.on('POST', '/api/v1/venue/menu/imports/text', () =>
      problem(429, 'rate_limited', { headers: { 'Retry-After': '30' } }),
    );
    fireEvent.change(await screen.findByLabelText('Текст меню'), { target: { value: 'Чай 50 р' } });
    fireEvent.click(screen.getByRole('button', { name: 'Распознать' }));
    expect(await screen.findByText('Слишком много загрузок подряд, повторите через 30 с')).toBeTruthy();
  });
});

describe('recovery', () => {
  it('shows the existing venue after a creation conflict', async () => {
    await start(null);
    server.on('POST', '/api/v1/venue', () => problem(409, 'venue_exists'));
    await renderApp('/venue/settings');
    fireEvent.change(await screen.findByLabelText('Название'), { target: { value: 'Зерно' } });
    fireEvent.change(screen.getByLabelText('Адрес'), { target: { value: 'Казань' } });
    fireEvent.click(screen.getByLabelText('Пекарня'));
    fireEvent.change(screen.getByLabelText('Координаты'), { target: { value: '55.79, 49.10' } });
    server.on('GET', '/api/v1/venue', () => json(VENUE));
    fireEvent.click(screen.getByRole('button', { name: 'Создать заведение' }));
    expect(await screen.findByText('Настройки заведения')).toBeTruthy();
  });

  it('offers a retry when the venue or the menu does not load', async () => {
    await start();
    server.on('GET', '/api/v1/venue', () => problem(500, 'internal_error'));
    const { router } = await renderApp('/venue/menu');
    expect(await screen.findByText('Не удалось загрузить заведение')).toBeTruthy();

    server.on('GET', '/api/v1/venue', () => json(VENUE));
    server.on('GET', '/api/v1/venue/menu', () => problem(500, 'internal_error'));
    server.on('GET', '/api/v1/venue/menu/imports/{id}', () =>
      json(menuImport({ status: 'ready', items: PARSED })),
    );
    await act(async () => {
      await router.navigate('/venue/menu/import/11');
    });
    expect(await screen.findByText('Не удалось загрузить меню для сверки')).toBeTruthy();
  });

  it('explains an apply error without a row and refreshes the menu when already applied', async () => {
    await start();
    server.on('GET', '/api/v1/venue/menu/imports/{id}', () =>
      json(menuImport({ status: 'ready', items: PARSED.slice(0, 1) })),
    );
    server.on('POST', '/api/v1/venue/menu/imports/{id}/apply', () =>
      problem(400, 'validation_failed', { errors: [{ path: 'body.items', message: 'Too many' }] }),
    );
    const { router } = await renderApp('/venue/menu/import/11');
    fireEvent.click(await screen.findByRole('button', { name: 'Добавить в меню (1)' }));
    expect(await screen.findByText('Проверьте введённые данные')).toBeTruthy();

    server.on('POST', '/api/v1/venue/menu/imports/{id}/apply', () => problem(409, 'import_already_applied'));
    const before = server.callsTo('GET', '/api/v1/venue/menu').length;
    fireEvent.click(screen.getByRole('button', { name: 'Добавить в меню (1)' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/venue/menu');
    });
    await waitFor(() => {
      expect(server.callsTo('GET', '/api/v1/venue/menu').length).toBeGreaterThan(before);
    });
  });

  it('drops a broken saved draft instead of failing', async () => {
    await start();
    localStorage.setItem(
      'ppshkin.menuImport',
      JSON.stringify({ venueId: 7, importId: 11, rows: [{ key: 0, selected: true, form: { name: 'x' } }] }),
    );
    server.on('GET', '/api/v1/venue/menu/imports/{id}', () =>
      json(menuImport({ status: 'ready', items: PARSED.slice(0, 1) })),
    );
    await renderApp('/venue/menu/import/11');
    expect(await screen.findByText('Найдено 1 позиция, выбрано 1')).toBeTruthy();
    expect(localStorage.getItem('ppshkin.menuImport')).toBeNull();
  });
});
