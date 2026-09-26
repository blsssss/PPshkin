import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderApp } from '../../../test/app.tsx';
import { json, problem } from '../../../test/http.ts';
import { fakeWebApp } from '../../../test/webapp.ts';
import type { Booking } from '../bookings/model.ts';
import type { Schemas } from '../../api/client.ts';
import type { Deal } from './dealModel.ts';
import type { MenuItem, Venue } from './model.ts';

vi.mock('../../api/index.ts', async () => (await import('../../../test/apiModule.ts')).apiModule);
const { server, startSession } = await import('../../../test/apiModule.ts');

const NOW = new Date('2026-09-26T12:00:00.000Z');

const VENUE: Venue = {
  id: 7,
  name: 'Кофейня «Зерно»',
  address: 'Казань, ул. Баумана, 36',
  category: 'coffee',
  location: { lat: 55.7963, lon: 49.1088 },
  opensAt: '08:00',
  closesAt: '22:00',
  timezone: 'Europe/Moscow',
  isDemo: false,
};

const ITEM: MenuItem = {
  id: 1,
  name: 'Чизкейк',
  description: null,
  category: 'dessert',
  priceRub: 190,
  weightG: 120,
  kcal: 420,
  proteinG: null,
  fatG: null,
  carbsG: null,
  nutritionSource: 'venue',
  tags: [],
  isAvailable: true,
};

function deal(patch: Partial<Deal> = {}): Deal {
  return {
    id: 3,
    menuItemId: ITEM.id,
    itemName: ITEM.name,
    priceRub: 129,
    originalPriceRub: 190,
    discountPercent: 32,
    quantityTotal: 5,
    quantityLeft: 3,
    startsAt: '2026-09-26T11:00:00.000Z',
    endsAt: '2026-09-26T18:30:00.000Z',
    status: 'active',
    ...patch,
  };
}

function booking(patch: Partial<Booking> = {}): Booking {
  return {
    id: 9,
    code: 'K7M2QX',
    qrPayload: 'ppshkin:booking:K7M2QX',
    status: 'active',
    expiresAt: '2026-09-26T12:08:00.000Z',
    createdAt: '2026-09-26T11:10:00.000Z',
    resolvedAt: null,
    dealId: 3,
    item: ITEM,
    venue: VENUE,
    priceRub: 129,
    kcal: 420,
    ...patch,
  };
}

const ANALYTICS: Schemas['VenueAnalytics'] = {
  from: '2026-09-20',
  to: '2026-09-26',
  timezone: 'Europe/Moscow',
  offersShown: 0,
  offersAccepted: 0,
  bookingsCreated: 4,
  bookingsRedeemed: 3,
  bookingsExpired: 1,
  bookingsCancelled: 0,
  acceptRate: 0,
  redeemRate: 0.75,
  revenueRub: 480,
  surplusUnitsSold: 3,
  surplusRevenueRub: 387,
  topItems: [{ menuItemId: 1, name: 'Чизкейк', redeemed: 3, revenueRub: 387 }],
  byDay: [
    {
      date: '2026-09-25',
      offersShown: 0,
      offersAccepted: 0,
      bookingsCreated: 1,
      bookingsRedeemed: 1,
      revenueRub: 129,
    },
    {
      date: '2026-09-26',
      offersShown: 0,
      offersAccepted: 0,
      bookingsCreated: 3,
      bookingsRedeemed: 2,
      revenueRub: 351,
    },
  ],
};

async function start(venue: Venue = VENUE) {
  await startSession();
  server.reply('GET', '/api/v1/venue', venue);
  server.reply('GET', '/api/v1/venue/menu', {
    items: [ITEM, { ...ITEM, id: 2, name: 'Капучино', priceRub: 2 }],
  });
  server.on('GET', '/api/v1/venue/deals', (call) =>
    json({
      items: call.search.includes('finished') ? [deal({ id: 2, status: 'sold_out', quantityLeft: 0 })] : [],
    }),
  );
  server.on('GET', '/api/v1/venue/bookings', () => json({ items: [booking()] }));
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true, now: NOW });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('deal form', () => {
  it('publishes with quick options and offers to share', async () => {
    await start();
    server.on('POST', '/api/v1/venue/deals', (call) => json(deal({ ...(call.body as object), id: 5 }), 201));
    await renderApp('/venue/deals/new?itemId=1');
    fireEvent.click(await screen.findByRole('button', { name: /^-30%, 133/ }));
    fireEvent.click(screen.getByRole('button', { name: '10 шт.' }));
    fireEvent.click(screen.getByRole('button', { name: 'До закрытия' }));
    expect(screen.getByText(/^Чизкейк: 133.₽ вместо 190.₽ \(-30%\), 10 шт\., до 22:00$/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Опубликовать' }));
    expect(await screen.findByText('Горящая позиция опубликована')).toBeTruthy();
    expect(server.callsTo('POST', '/api/v1/venue/deals')[0]?.body).toEqual({
      menuItemId: 1,
      priceRub: 133,
      quantity: 10,
      endsAt: '2026-09-26T19:00:00.000Z',
    });
    expect(screen.getByRole('button', { name: 'Поделиться' })).toBeTruthy();
  });

  it('disables discounts that do not lower the price and warns about a closed venue', async () => {
    await start({ ...VENUE, opensAt: '18:00', closesAt: '23:00' });
    await renderApp('/venue/deals/new?itemId=2');
    expect(await screen.findByText(/Заведение сейчас закрыто/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /^-50%, 1/ }).hasAttribute('disabled')).toBe(false);
    expect(screen.getByRole('button', { name: /^-20%, 2/ }).hasAttribute('disabled')).toBe(true);
  });

  it('hides "До закрытия" for a round the clock venue and explains an existing deal', async () => {
    await start({ ...VENUE, opensAt: '00:00', closesAt: '00:00' });
    server.on('POST', '/api/v1/venue/deals', () => problem(409, 'deal_exists'));
    await renderApp('/venue/deals/new?itemId=1');
    await screen.findByRole('button', { name: '1 час' });
    expect(screen.queryByRole('button', { name: 'До закрытия' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Опубликовать' }));
    expect(await screen.findByText('По этой позиции уже есть горящее предложение')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Открыть' })).toBeTruthy();
  });
});

describe('deals list', () => {
  it('takes a deal off sale after confirmation and repeats a finished one', async () => {
    await start();
    server.on('GET', '/api/v1/venue/deals', (call) =>
      json({
        items: call.search.includes('finished')
          ? [deal({ id: 2, status: 'sold_out', quantityLeft: 0 })]
          : [deal()],
      }),
    );
    server.on('DELETE', '/api/v1/venue/deals/{id}', () => new Response(null, { status: 204 }));
    const { router } = await renderApp('/venue/deals');
    expect(await screen.findByText('129 ₽ вместо 190 ₽, -32%', { exact: false })).toBeTruthy();
    expect(screen.getByText('Продаётся')).toBeTruthy();
    expect(screen.getByText(/Осталось 3 из 5, до 21:30/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Снять с продажи: Чизкейк' }));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText('Уже оформленные брони останутся в силе.')).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Снять' }));
    await waitFor(() => {
      expect(server.callsTo('DELETE', '/api/v1/venue/deals/3')).toHaveLength(1);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Завершённые' }));
    expect(await screen.findByText('Распродана')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить: Чизкейк' }));
    expect(router.state.location.search).toBe('?itemId=1&priceRub=129&quantity=5');
  });
});

describe('redemption', () => {
  it('redeems a typed code once and shows the result', async () => {
    const webApp = fakeWebApp();
    await start();
    server.on('POST', '/api/v1/venue/bookings/redeem', () => json(booking({ status: 'redeemed' })));
    await renderApp('/venue/redeem');
    fireEvent.change(await screen.findByLabelText('Код брони'), { target: { value: 'k7m-2qx' } });
    const button = screen.getByRole('button', { name: 'Погасить' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(await screen.findByText('Погашено')).toBeTruthy();
    expect(server.callsTo('POST', '/api/v1/venue/bookings/redeem')).toHaveLength(1);
    expect(server.callsTo('POST', '/api/v1/venue/bookings/redeem')[0]?.body).toEqual({ code: 'K7M2QX' });
    expect(webApp.HapticFeedback.notificationOccurred).toHaveBeenCalledWith('success');
  });

  it.each([
    [404, 'booking_not_found', 'Бронь с таким кодом не найдена в вашем заведении'],
    [409, 'booking_expired', 'Срок брони истёк. Гость может оформить новую'],
    [409, 'booking_not_active', 'Бронь уже погашена или отменена'],
  ] as const)('explains %s %s', async (status, code, text) => {
    await start();
    server.on('POST', '/api/v1/venue/bookings/redeem', () => problem(status, code));
    await renderApp('/venue/redeem');
    fireEvent.change(await screen.findByLabelText('Код брони'), { target: { value: 'ABC234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Погасить' }));
    expect(await screen.findByText(text)).toBeTruthy();
  });

  it('redeems a scanned QR at once and recovers from a failed scan', async () => {
    const reader = vi
      .fn<() => Promise<{ value?: unknown }>>()
      .mockRejectedValueOnce({ error: { code: 'client.open_code_reader.cancelled' } })
      .mockResolvedValueOnce({ value: 'ppshkin:booking:K7M2QX' });
    fakeWebApp({ openCodeReader: reader });
    await start();
    server.on('POST', '/api/v1/venue/bookings/redeem', () => json(booking({ status: 'redeemed' })));
    await renderApp('/venue/redeem');
    fireEvent.click(await screen.findByRole('button', { name: 'Сканировать QR гостя' }));
    expect(await screen.findByText(/Не удалось отсканировать/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ещё раз' }));
    expect(await screen.findByText('Погашено')).toBeTruthy();
    expect(reader).toHaveBeenCalledWith(true);
  });

  it('hides scanning outside MAX', async () => {
    await start();
    await renderApp('/venue/redeem');
    await screen.findByLabelText('Код брони');
    expect(screen.queryByRole('button', { name: 'Сканировать QR гостя' })).toBeNull();
  });
});

describe('venue bookings', () => {
  it('refreshes active bookings every 30 seconds only while visible and on screen', async () => {
    await start();
    const { router } = await renderApp('/venue/bookings');
    expect(await screen.findByText('K7M2QX')).toBeTruthy();
    expect(screen.getByText('Скоро истечёт')).toBeTruthy();
    expect(screen.getByText('Горящее предложение')).toBeTruthy();
    const count = () => server.callsTo('GET', '/api/v1/venue/bookings').length;
    const first = count();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(count()).toBe(first + 1);

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(90_000);
    });
    expect(count()).toBe(first + 1);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));

    await act(async () => {
      await router.navigate('/venue/analytics');
    });
    const left = count();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(90_000);
    });
    expect(count()).toBe(left);
  });

  it('filters the history by day', async () => {
    await start();
    server.on('GET', '/api/v1/venue/bookings', (call) =>
      json({
        items: call.search.includes('history')
          ? [booking({ status: 'redeemed', resolvedAt: '2026-09-26T11:20:00.000Z' })]
          : [],
      }),
    );
    await renderApp('/venue/bookings');
    fireEvent.click(await screen.findByRole('button', { name: 'История' }));
    expect(await screen.findByText('Погашена')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('День'), { target: { value: '2026-09-25' } });
    await waitFor(() => {
      expect(server.callsTo('GET', '/api/v1/venue/bookings').at(-1)?.search).toBe(
        '?status=history&date=2026-09-25',
      );
    });
  });
});

describe('analytics', () => {
  it('shows tiles, a dash for a zero denominator and the top items', async () => {
    await start();
    server.on('GET', '/api/v1/venue/analytics', () => json(ANALYTICS));
    await renderApp('/venue/analytics');
    expect(await screen.findByText('480 ₽', { exact: false })).toBeTruthy();
    expect(screen.getByText('3 шт.')).toBeTruthy();
    expect(screen.getByText('75%')).toBeTruthy();
    expect(screen.getByText('принято 0 (-)')).toBeTruthy();
    expect(screen.getByText('Чаще всего забирают')).toBeTruthy();
    expect(server.callsTo('GET', '/api/v1/venue/analytics')[0]?.search).toBe(
      '?from=2026-09-20&to=2026-09-26',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Сегодня' }));
    await waitFor(() => {
      expect(server.callsTo('GET', '/api/v1/venue/analytics').at(-1)?.search).toBe(
        '?from=2026-09-26&to=2026-09-26',
      );
    });
  });

  it('shows the empty state', async () => {
    await start();
    server.on('GET', '/api/v1/venue/analytics', () =>
      json({
        ...ANALYTICS,
        bookingsCreated: 0,
        bookingsRedeemed: 0,
        bookingsExpired: 0,
        revenueRub: 0,
        surplusUnitsSold: 0,
        surplusRevenueRub: 0,
        redeemRate: 0,
        topItems: [],
      }),
    );
    await renderApp('/venue/analytics');
    expect(await screen.findByText('Данных пока нет')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Добавить горящую позицию' })).toBeTruthy();
  });
});

describe('review fixes', () => {
  it('does not send a stale remainder when only the end time changes', async () => {
    await start();
    let left = 3;
    server.on('GET', '/api/v1/venue/deals', () => json({ items: [deal({ quantityLeft: left })] }));
    server.on('PATCH', '/api/v1/venue/deals/{id}', (call) => json(deal({ ...(call.body as object) })));
    const { router } = await renderApp('/venue/deals');
    await screen.findByText(/Осталось 3 из 5/);
    left = 2;
    await act(async () => {
      await router.navigate('/venue/deals/3');
    });
    expect(await screen.findByText(/осталось 2 из 5/)).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>('Осталось, шт.').value).toBe('2');
    fireEvent.click(screen.getByRole('button', { name: '1 час' }));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => {
      expect(Object.keys(server.callsTo('PATCH', '/api/v1/venue/deals/3')[0]?.body ?? {})).toEqual([
        'endsAt',
      ]);
    });
  });

  it('leaves a prefilled form without asking when nothing changed', async () => {
    await start();
    const { router } = await renderApp('/venue/deals/new?itemId=1');
    await screen.findByRole('button', { name: 'Опубликовать' });
    await act(async () => {
      await router.navigate('/venue/deals');
    });
    expect(router.state.location.pathname).toBe('/venue/deals');
    expect(screen.queryByText('Изменения не сохранены. Уйти?')).toBeNull();
  });

  it('refreshes the list when a row redeem fails', async () => {
    await start();
    server.on('POST', '/api/v1/venue/bookings/redeem', () => problem(409, 'booking_not_active'));
    await renderApp('/venue/bookings');
    fireEvent.click(await screen.findByRole('button', { name: 'Погасить' }));
    const before = server.callsTo('GET', '/api/v1/venue/bookings').length;
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Погасить' }));
    expect(await screen.findByText('Бронь уже погашена или отменена')).toBeTruthy();
    await waitFor(() => {
      expect(server.callsTo('GET', '/api/v1/venue/bookings').length).toBeGreaterThan(before);
    });
  });
});
