import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderApp } from '../../../test/app.tsx';
import { json, problem } from '../../../test/http.ts';
import { fakeWebApp } from '../../../test/webapp.ts';
import type { Schemas } from '../../api/client.ts';
import { formatCode, formatCountdown, parseNewBooking, spelledCode, type Booking } from './model.ts';

vi.mock('../../api/index.ts', async () => (await import('../../../test/apiModule.ts')).apiModule);
const { server, startSession } = await import('../../../test/apiModule.ts');

const NOW = new Date('2026-09-26T10:00:00.000Z');

const VENUE: Schemas['Venue'] = {
  id: 900001,
  name: 'Кофейня «Зерно»',
  address: 'Казань, ул. Баумана, 36',
  category: 'coffee',
  location: { lat: 55.7897, lon: 49.1189 },
  opensAt: '08:00',
  closesAt: '22:00',
  timezone: 'Europe/Moscow',
  isDemo: true,
};

const ITEM: Schemas['MenuItem'] = {
  id: 31,
  name: 'Чизкейк Нью-Йорк',
  description: null,
  category: 'dessert',
  priceRub: 290,
  weightG: 120,
  kcal: 420,
  proteinG: 7,
  fatG: 25,
  carbsG: 38,
  nutritionSource: 'venue',
  tags: ['dessert'],
  isAvailable: true,
};

const DEAL: Schemas['Deal'] = {
  id: 55,
  menuItemId: ITEM.id,
  itemName: ITEM.name,
  priceRub: 170,
  originalPriceRub: 290,
  discountPercent: 41,
  quantityTotal: 5,
  quantityLeft: 3,
  startsAt: '2026-09-26T09:00:00.000Z',
  endsAt: '2026-09-26T18:00:00.000Z',
  status: 'active',
};

function booking(patch: Partial<Booking> = {}): Booking {
  return {
    id: 5,
    code: 'K7M2QX',
    qrPayload: 'ppshkin:booking:K7M2QX',
    status: 'active',
    expiresAt: '2026-09-26T10:30:00.000Z',
    createdAt: '2026-09-26T09:30:00.000Z',
    resolvedAt: null,
    dealId: DEAL.id,
    item: ITEM,
    venue: VENUE,
    priceRub: 170,
    kcal: 420,
    ...patch,
  };
}

let current: Booking;

async function start() {
  current = booking();
  await startSession();
  server.reply('GET', '/api/v1/venues/{id}', { venue: VENUE, openNow: true, menu: [ITEM], deals: [DEAL] });
  server.on('GET', '/api/v1/bookings/{id}', () => json(current));
  server.on(
    'GET',
    '/api/v1/bookings/{id}/qr',
    () =>
      new Response(new Uint8Array([137, 80, 78, 71]), {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      }),
  );
  server.on('GET', '/api/v1/bookings', (call) =>
    json({ items: call.search.includes('history') ? [] : current.status === 'active' ? [current] : [] }),
  );
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true, now: NOW });
  URL.createObjectURL = vi.fn(() => 'blob:qr-5');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('model', () => {
  it('groups and spells the code', () => {
    expect(formatCode('K7M2QX')).toBe('K7M 2QX');
    expect(spelledCode('K7M2QX')).toBe('K 7 M 2 Q X');
  });

  it('formats the countdown', () => {
    expect(formatCountdown(59 * 60_000 + 1500)).toBe('59:02');
    expect(formatCountdown(0)).toBe('00:00');
    expect(formatCountdown(-5)).toBe('00:00');
  });

  it('reads the booking parameters', () => {
    expect(parseNewBooking(new URLSearchParams('venueId=1&menuItemId=2&dealId=3&offerId=4'))).toEqual({
      venueId: 1,
      menuItemId: 2,
      dealId: 3,
      offerId: 4,
    });
    expect(parseNewBooking(new URLSearchParams('venueId=1&menuItemId=2&dealId=x'))).toEqual({
      venueId: 1,
      menuItemId: 2,
      dealId: null,
      offerId: null,
    });
    expect(parseNewBooking(new URLSearchParams('venueId=1'))).toBeNull();
    expect(parseNewBooking(new URLSearchParams('venueId=0&menuItemId=2'))).toBeNull();
  });
});

describe('confirmation', () => {
  it('books a deal once and replaces the history', async () => {
    const webApp = fakeWebApp();
    await start();
    server.on('POST', '/api/v1/bookings', () => json(current, 201));
    const { router } = await renderApp('/bookings/new?venueId=900001&menuItemId=31&dealId=55&offerId=9');
    expect(await screen.findByRole('heading', { name: ITEM.name })).toBeTruthy();
    expect(screen.getByText('Оплата в заведении при получении')).toBeTruthy();
    expect(screen.getByLabelText('обычная цена 290 ₽')).toBeTruthy();
    const book = screen.getByRole('button', { name: 'Забронировать' });
    fireEvent.click(book);
    fireEvent.click(book);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/bookings/5');
    });
    expect(router.state.historyAction).toBe('REPLACE');
    expect(server.callsTo('POST', '/api/v1/bookings')).toHaveLength(1);
    expect(server.callsTo('POST', '/api/v1/bookings')[0]?.body).toEqual({
      menuItemId: 31,
      dealId: 55,
      offerId: 9,
    });
    expect(webApp.HapticFeedback.notificationOccurred).toHaveBeenCalledWith('success');
  });

  it('books at the menu price without a deal or offer', async () => {
    await start();
    server.on('POST', '/api/v1/bookings', () => json(current, 201));
    await renderApp('/bookings/new?venueId=900001&menuItemId=31');
    fireEvent.click(await screen.findByRole('button', { name: 'Забронировать' }));
    await waitFor(() => {
      expect(server.callsTo('POST', '/api/v1/bookings')[0]?.body).toEqual({ menuItemId: 31 });
    });
  });

  it('explains a missing item and a closed venue', async () => {
    await start();
    const { router } = await renderApp('/bookings/new?venueId=900001&menuItemId=99');
    expect(await screen.findByText('Эта позиция больше недоступна')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'К заведению' })).toBeTruthy();

    server.reply('GET', '/api/v1/venues/{id}', { venue: VENUE, openNow: false, menu: [ITEM], deals: [] });
    await act(async () => {
      await router.navigate('/bookings/new?venueId=900001&menuItemId=31');
    });
    expect(await screen.findByText('Заведение сейчас закрыто, бронь недоступна')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Забронировать' })).toBeNull();
  });

  it.each([
    [
      409,
      'too_many_bookings',
      'У вас уже 3 активные брони. Отмените одну или дождитесь её окончания',
      ['Мои брони'],
    ],
    [409, 'booking_exists', 'Эта горящая позиция уже забронирована вами', ['Мои брони']],
    [409, 'venue_closed', 'Заведение сейчас закрыто, бронь недоступна', ['К заведению', 'Что поесть']],
    [409, 'deal_not_active', 'Горящая позиция закончилась', ['Обновить', 'Что поесть']],
    [409, 'deal_sold_out', 'Горящая позиция закончилась', ['Обновить', 'Что поесть']],
    [404, 'menu_item_not_found', 'Эта позиция больше недоступна', ['К заведению', 'Что поесть']],
    [404, 'deal_not_found', 'Эта позиция больше недоступна', ['К заведению', 'Что поесть']],
    [422, 'menu_item_unavailable', 'Эта позиция больше недоступна', ['К заведению', 'Что поесть']],
    [404, 'offer_not_found', 'Предложение устарело, обновите подборку', ['Что поесть']],
  ] as const)('handles %s %s', async (status, code, text, actions) => {
    await start();
    server.on('POST', '/api/v1/bookings', () => problem(status, code));
    await renderApp('/bookings/new?venueId=900001&menuItemId=31&dealId=55');
    fireEvent.click(await screen.findByRole('button', { name: 'Забронировать' }));
    const notice = (await screen.findByText(text)).closest('[role]') ?? document.body;
    for (const action of actions) {
      expect(within(notice as HTMLElement).getByRole('button', { name: action })).toBeTruthy();
    }
    expect(screen.getByRole('button', { name: 'Забронировать' })).toBeTruthy();
  });
});

describe('booking', () => {
  it('shows the code, the QR loaded with the token and frees it on leaving', async () => {
    await start();
    const { router } = await renderApp('/bookings/5');
    expect(await screen.findByLabelText('Код брони K 7 M 2 Q X')).toBeTruthy();
    expect(screen.getByText('K7M 2QX')).toBeTruthy();
    const qr = await screen.findByRole('img', { name: 'QR-код брони K7M2QX' });
    expect(qr.getAttribute('src')).toBe('blob:qr-5');
    expect(server.callsTo('GET', '/api/v1/bookings/5/qr')[0]?.authorization).toBe('Bearer token-1');
    await act(async () => {
      await router.navigate('/bookings');
    });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:qr-5');
  });

  it('counts down, marks the last five minutes and asks again at zero', async () => {
    await start();
    current = booking({ expiresAt: '2026-09-26T10:05:02.000Z' });
    await renderApp('/bookings/5');
    const timer = await screen.findByRole('timer');
    expect(timer.textContent).toBe('05:02');
    expect(timer.className).not.toMatch(/urgent/);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.getByRole('timer').textContent).toBe('04:59');
    expect(screen.getByRole('timer').className).toMatch(/urgent/);
    const before = server.callsTo('GET', '/api/v1/bookings/5').length;
    current = booking({ status: 'expired', expiresAt: '2026-09-26T10:05:02.000Z' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });
    expect(await screen.findByText('Время брони вышло')).toBeTruthy();
    expect(server.callsTo('GET', '/api/v1/bookings/5').length).toBeGreaterThan(before);
  });

  it('polls every 15 seconds only while active and visible', async () => {
    await start();
    await renderApp('/bookings/5');
    await screen.findByRole('timer');
    const count = () => server.callsTo('GET', '/api/v1/bookings/5').length;
    const first = count();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(count()).toBe(first + 1);

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(45_000);
    });
    expect(count()).toBe(first + 1);

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    current = booking({ status: 'redeemed', resolvedAt: '2026-09-26T10:01:00.000Z' });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(await screen.findByText('Готово! Бронь получена, блюдо записано в дневник')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Открыть дневник' })).toBeTruthy();
    const settled = count();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(count()).toBe(settled);
  });

  it('shows a cancelled booking and an unknown one', async () => {
    await start();
    current = booking({ status: 'cancelled', resolvedAt: '2026-09-26T09:45:00.000Z' });
    const { router } = await renderApp('/bookings/5');
    expect(await screen.findByText('Бронь отменена')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Мои брони' })).toBeTruthy();
    server.on('GET', '/api/v1/bookings/{id}', () => problem(404, 'booking_not_found'));
    await act(async () => {
      await router.navigate('/bookings/6');
    });
    expect(await screen.findByText('Бронь не найдена')).toBeTruthy();
  });

  it('cancels after confirmation and shows the real status on a conflict', async () => {
    await start();
    server.on('POST', '/api/v1/bookings/{id}/cancel', () => {
      current = booking({ status: 'cancelled', resolvedAt: '2026-09-26T10:00:00.000Z' });
      return json(current);
    });
    await renderApp('/bookings/5');
    fireEvent.click(await screen.findByRole('button', { name: 'Отменить бронь' }));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText('Порция вернётся в продажу.')).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Отменить бронь' }));
    expect(await screen.findByText('Бронь отменена', { selector: 'h2' })).toBeTruthy();
    expect(server.callsTo('POST', '/api/v1/bookings/5/cancel')).toHaveLength(1);
  });

  it('refetches when the booking is no longer active', async () => {
    await start();
    server.on('POST', '/api/v1/bookings/{id}/cancel', () => {
      current = booking({ status: 'redeemed', resolvedAt: '2026-09-26T09:59:00.000Z' });
      return problem(409, 'booking_not_active');
    });
    await renderApp('/bookings/5');
    fireEvent.click(await screen.findByRole('button', { name: 'Отменить бронь' }));
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Отменить бронь' }),
    );
    expect(await screen.findByText('Готово! Бронь получена, блюдо записано в дневник')).toBeTruthy();
  });
});

describe('full screen QR', () => {
  it('raises the brightness and restores it on leaving', async () => {
    const webApp = fakeWebApp();
    await start();
    const { router } = await renderApp('/bookings/5?view=qr');
    const dialog = await screen.findByRole('dialog', { name: 'QR для сотрудника' });
    expect(within(dialog).getByText('Покажите QR или код сотруднику заведения')).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Разделы' })).toBeNull();
    await waitFor(() => {
      expect(webApp.requestScreenMaxBrightness).toHaveBeenCalledTimes(1);
    });
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Ярче' }));
    expect(webApp.requestScreenMaxBrightness).toHaveBeenCalledTimes(2);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Закрыть' }));
    await waitFor(() => {
      expect(router.state.location.search).toBe('');
    });
    expect(webApp.restoreScreenBrightness).toHaveBeenCalled();
  });

  it('hides the brighter button when MAX refuses', async () => {
    fakeWebApp({ requestScreenMaxBrightness: vi.fn(() => Promise.reject(new Error('no'))) });
    await start();
    await renderApp('/bookings/5?view=qr');
    const dialog = await screen.findByRole('dialog', { name: 'QR для сотрудника' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(within(dialog).queryByRole('button', { name: 'Ярче' })).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Закрыть' })).toBeTruthy();
  });
});

describe('list', () => {
  it('shows active bookings, the history and the tab counter', async () => {
    await start();
    await renderApp('/bookings');
    expect(await screen.findByText('Можно держать до 3 активных броней.')).toBeTruthy();
    expect(await screen.findByText('K7M 2QX')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Брони, активных: 1' })).toBeTruthy();
    server.on('GET', '/api/v1/bookings', (call) =>
      json({
        items: call.search.includes('history')
          ? [
              booking({
                id: 4,
                status: 'redeemed',
                resolvedAt: '2026-09-25T12:00:00.000Z',
                createdAt: '2026-09-25T11:30:00.000Z',
              }),
            ]
          : [current],
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'История' }));
    expect(await screen.findByText('Получена')).toBeTruthy();
    expect(screen.getByText('25 сентября')).toBeTruthy();
  });

  it('shows empty states', async () => {
    await start();
    current = booking({ status: 'expired' });
    await renderApp('/bookings');
    expect(await screen.findByText('Активных броней нет')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'История' }));
    expect(await screen.findByText('Здесь появятся полученные и отменённые брони')).toBeTruthy();
  });
});

describe('resilience', () => {
  it('keeps the booking on screen when one poll fails', async () => {
    await start();
    await renderApp('/bookings/5');
    await screen.findByRole('timer');
    server.on('GET', '/api/v1/bookings/{id}', () => problem(503, 'unavailable'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(screen.queryByText('Не удалось загрузить бронь')).toBeNull();
    expect(screen.getByText('K7M 2QX')).toBeTruthy();
  });

  it('vibrates only when the booking becomes redeemed', async () => {
    const webApp = fakeWebApp();
    await start();
    current = booking({ status: 'redeemed', resolvedAt: '2026-09-25T12:00:00.000Z' });
    await renderApp('/bookings/5');
    await screen.findByText('Готово! Бронь получена, блюдо записано в дневник');
    expect(webApp.HapticFeedback.notificationOccurred).not.toHaveBeenCalled();
  });

  it('shows not found for a broken id without asking the server', async () => {
    await start();
    await renderApp('/bookings/abc');
    expect(await screen.findByText('Бронь не найдена')).toBeTruthy();
    expect(server.calls.filter((call) => call.path.startsWith('/api/v1/bookings/'))).toHaveLength(0);
  });

  it('closes the QR view back in history and drops it once the booking is resolved', async () => {
    await start();
    const { router } = await renderApp('/bookings/5');
    fireEvent.click(await screen.findByRole('button', { name: 'Показать сотруднику' }));
    await screen.findByRole('dialog', { name: 'QR для сотрудника' });
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    await waitFor(() => {
      expect(router.state.location.search).toBe('');
    });
    expect(router.state.historyAction).toBe('POP');

    current = booking({ status: 'redeemed', resolvedAt: '2026-09-26T10:01:00.000Z' });
    await act(async () => {
      await router.navigate('/bookings/5?view=qr');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    await waitFor(() => {
      expect(router.state.location.search).toBe('');
    });
    expect(screen.getByRole('navigation', { name: 'Разделы' })).toBeTruthy();
  });

  it('refreshes the active list when a booking expires', async () => {
    await start();
    current = booking({ expiresAt: '2026-09-26T10:00:30.000Z' });
    await renderApp('/bookings');
    await screen.findByText('K7M 2QX');
    current = booking({ status: 'expired', expiresAt: '2026-09-26T10:00:30.000Z' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(35_000);
    });
    expect(await screen.findByText('Активных броней нет')).toBeTruthy();
  });
});

describe('deep link', () => {
  it('goes back to the list after closing the QR of a booking opened by link', async () => {
    current = booking();
    await startSession({ startParam: 'booking_5' });
    server.on('GET', '/api/v1/bookings/{id}', () => json(current));
    server.on(
      'GET',
      '/api/v1/bookings/{id}/qr',
      () =>
        new Response(new Uint8Array([137, 80, 78, 71]), {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        }),
    );
    server.on('GET', '/api/v1/bookings', () => json({ items: [current] }));
    const { router } = await renderApp('/');
    fireEvent.click(await screen.findByRole('button', { name: 'Показать сотруднику' }));
    await screen.findByRole('dialog', { name: 'QR для сотрудника' });
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    await waitFor(() => {
      expect(router.state.location.search).toBe('');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/bookings');
    });
  });
});
