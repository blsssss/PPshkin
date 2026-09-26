import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderApp } from '../../../test/app.tsx';
import { json, problem, TEST_USER } from '../../../test/http.ts';
import type { UserProfile } from '../../api/client.ts';
import { setDevicePoint } from '../../shared/geo/devicePoint.ts';
import type { Deal, MenuItem, RecommendationItem, Venue } from './model.ts';

vi.mock('../../api/index.ts', async () => (await import('../../../test/apiModule.ts')).apiModule);
const { server, startSession } = await import('../../../test/apiModule.ts');

const VENUE: Venue = {
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

const ITEM: MenuItem = {
  id: 910106,
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
  tags: ['dessert', 'sweet'],
  isAvailable: true,
};

const DEAL: Deal = {
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

function recommendation(offerId: number, patch: Partial<RecommendationItem> = {}): RecommendationItem {
  return {
    offerId,
    headline: `Можно позволить десерт ${offerId}`,
    facts: ['Сегодня съедено 1150 ккал'],
    calculations: ['2000 - 1150 = 850 ккал'],
    assumptions: ['Калорийность приблизительная, это не медицинская рекомендация'],
    score: 0.8,
    item: { ...ITEM, id: ITEM.id + offerId, name: `Блюдо ${offerId}` },
    venue: VENUE,
    deal: null,
    distanceM: 450,
    priceRub: 290,
    kcal: 420,
    ...patch,
  };
}

function recommendations(items: RecommendationItem[], status = 'ok') {
  return { status, slot: 'lunch', remainingKcal: 850, slotBudgetKcal: 700, items };
}

async function start(user: UserProfile = TEST_USER) {
  setDevicePoint(null);
  await startSession({ user });
  server.on('GET', '/api/v1/me', () => json(user));
  server.reply('GET', '/api/v1/insights', { readiness: 'ready', mealsUntilReady: 0 });
  server.reply(
    'GET',
    '/api/v1/recommendations',
    recommendations([recommendation(1, { deal: DEAL, priceRub: 170 }), recommendation(2)]),
  );
  server.reply('GET', '/api/v1/deals', { items: [{ deal: DEAL, item: ITEM, venue: VENUE, distanceM: 450 }] });
  server.reply('GET', '/api/v1/venues', {
    items: [{ venue: VENUE, distanceM: 450, openNow: true, activeDeals: 2 }],
  });
  server.reply('GET', '/api/v1/venues/{id}', { venue: VENUE, openNow: true, menu: [ITEM], deals: [DEAL] });
}

beforeEach(() => {
  localStorage.clear();
});

describe('recommendations', () => {
  it('shows the header, cards and the three explanation blocks', async () => {
    await start();
    await renderApp('/eat');
    expect(
      await screen.findByText(
        /^Сейчас обед\. До ориентира осталось около 850.ккал, на обед примерно 700.ккал$/,
      ),
    ).toBeTruthy();
    const first = screen.getByRole('article', { name: 'Блюдо 1' });
    expect(within(first).getByText('Можно позволить десерт 1')).toBeTruthy();
    expect(within(first).getByText('Факты')).toBeTruthy();
    expect(within(first).getByText('Расчёт')).toBeTruthy();
    expect(within(first).getByText('Допущения')).toBeTruthy();
    expect(within(first).getByText('-41%')).toBeTruthy();
    expect(within(first).getByText('Заведение и меню тестовые')).toBeTruthy();
    expect(within(first).queryByText(/0\.8/)).toBeNull();
    expect(first.querySelector('details')?.open).toBe(true);
    expect(screen.getByRole('article', { name: 'Блюдо 2' }).querySelector('details')?.open).toBe(false);
  });

  it.each([
    ['profile_empty', 'Запишите хотя бы один приём пищи, и мы подберём блюдо под ваш день'],
    ['budget_exhausted', 'На сегодня ориентир почти выбран: осталось около 850 ккал'],
    [
      'nothing_fits',
      'Сейчас рядом нет подходящих блюд: заведения закрыты, далеко или блюда больше остатка калорий',
    ],
  ])('handles status %s', async (status, text) => {
    await start();
    server.reply('GET', '/api/v1/recommendations', recommendations([], status));
    await renderApp('/eat');
    expect(await screen.findByText(text)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Горящие позиции рядом' })).toBeTruthy();
  });

  it('asks once even with StrictMode and remounts, and again on "Показать другие"', async () => {
    await start();
    const { router } = await renderApp('/eat', { wrapper: StrictMode });
    await screen.findByText('Блюдо 1');
    await act(async () => {
      await router.navigate('/diary');
    });
    await act(async () => {
      await router.navigate('/eat');
    });
    await screen.findByText('Блюдо 1');
    expect(server.callsTo('GET', '/api/v1/recommendations')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Показать другие' }));
    await waitFor(() => {
      expect(server.callsTo('GET', '/api/v1/recommendations')).toHaveLength(2);
    });
  });

  it('sends the device point only when the device gave one', async () => {
    await start({ ...TEST_USER, location: { lat: 55.79, lon: 49.12 } });
    await renderApp('/eat');
    await screen.findByText('Блюдо 1');
    expect(screen.getByText('Рядом с вашим районом')).toBeTruthy();
    expect(server.callsTo('GET', '/api/v1/recommendations')[0]?.search).toBe('?limit=5');
    act(() => {
      setDevicePoint({ lat: 55.78871, lon: 49.12216 });
    });
    await waitFor(() => {
      expect(server.callsTo('GET', '/api/v1/recommendations')[1]?.search).toBe(
        '?limit=5&lat=55.789&lon=49.122',
      );
    });
    expect(screen.getByText('Рядом с вами')).toBeTruthy();
  });

  it('declines, removes the card and restores it on error', async () => {
    await start();
    server.on('POST', '/api/v1/offers/{id}/decline', (call) =>
      call.path.endsWith('/1/decline') ? new Response(null, { status: 204 }) : problem(503, 'unavailable'),
    );
    await renderApp('/eat');
    const first = await screen.findByRole('article', { name: 'Блюдо 1' });
    fireEvent.click(within(first).getByRole('button', { name: 'Не сегодня' }));
    expect(screen.queryByRole('article', { name: 'Блюдо 1' })).toBeNull();
    expect(await screen.findByText('Не будем предлагать это блюдо 3 дня')).toBeTruthy();
    expect(server.callsTo('POST', '/api/v1/offers/1/decline')[0]?.body).toEqual({ reason: 'not_today' });

    fireEvent.click(
      within(screen.getByRole('article', { name: 'Блюдо 2' })).getByRole('button', {
        name: 'Не люблю такое',
      }),
    );
    expect(screen.queryByRole('article', { name: 'Блюдо 2' })).toBeNull();
    expect(await screen.findByRole('article', { name: 'Блюдо 2' })).toBeTruthy();
    expect(server.callsTo('POST', '/api/v1/offers/2/decline')[0]?.body).toEqual({ reason: 'dislike' });
  });

  it('keeps a declined card gone after coming back and until new cards arrive', async () => {
    await start();
    server.on('POST', '/api/v1/offers/{id}/decline', () => new Response(null, { status: 204 }));
    const { router } = await renderApp('/eat');
    fireEvent.click(
      within(await screen.findByRole('article', { name: 'Блюдо 1' })).getByRole('button', {
        name: 'Не сегодня',
      }),
    );
    await screen.findByText('Не будем предлагать это блюдо 3 дня');
    await act(async () => {
      await router.navigate('/venues');
    });
    await act(async () => {
      await router.navigate('/eat');
    });
    await screen.findByRole('article', { name: 'Блюдо 2' });
    expect(screen.queryByRole('article', { name: 'Блюдо 1' })).toBeNull();

    const gate: { release?: (response: Response) => void } = {};
    const held = new Promise<Response>((resolve) => {
      gate.release = resolve;
    });
    server.on('GET', '/api/v1/recommendations', () => held);
    fireEvent.click(screen.getByRole('button', { name: 'Показать другие' }));
    await waitFor(() => {
      expect(server.callsTo('GET', '/api/v1/recommendations')).toHaveLength(2);
    });
    expect(screen.queryByRole('article', { name: 'Блюдо 1' })).toBeNull();
    gate.release?.(json(recommendations([recommendation(3)])));
    expect(await screen.findByRole('article', { name: 'Блюдо 3' })).toBeTruthy();
  });

  it('offers to share the location when nothing fits without a point', async () => {
    await start();
    server.reply('GET', '/api/v1/recommendations', recommendations([], 'nothing_fits'));
    await renderApp('/eat');
    expect(await screen.findByRole('button', { name: 'Указать геопозицию' })).toBeTruthy();
  });

  it('keeps an accepted offer removed and explains it', async () => {
    await start();
    server.on('POST', '/api/v1/offers/{id}/decline', () => problem(409, 'offer_already_accepted'));
    await renderApp('/eat');
    fireEvent.click(
      within(await screen.findByRole('article', { name: 'Блюдо 1' })).getByRole('button', {
        name: 'Не сегодня',
      }),
    );
    expect(await screen.findByText('По этому предложению уже есть бронь')).toBeTruthy();
    expect(screen.queryByRole('article', { name: 'Блюдо 1' })).toBeNull();
  });

  it('opens the booking with the deal and the offer', async () => {
    await start();
    const { router } = await renderApp('/eat');
    fireEvent.click(
      within(await screen.findByRole('article', { name: 'Блюдо 1' })).getByRole('button', {
        name: 'Забронировать',
      }),
    );
    expect(router.state.location.pathname + router.state.location.search).toBe(
      `/bookings/new?venueId=900001&menuItemId=${ITEM.id + 1}&dealId=55&offerId=1`,
    );
  });
});

describe('catalog', () => {
  it('highlights a deal from a link and explains a missing one', async () => {
    await start();
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const { router } = await renderApp('/deals?highlight=55');
    await screen.findByRole('article', { name: ITEM.name });
    await waitFor(() => {
      expect(scroll).toHaveBeenCalled();
    });
    await act(async () => {
      await router.navigate('/deals?highlight=999');
    });
    expect(await screen.findByText(/Эта горящая позиция уже закончилась/)).toBeTruthy();
  });

  it('hides distances and disables the radius without a point', async () => {
    await start();
    server.reply('GET', '/api/v1/deals', {
      items: [{ deal: DEAL, item: ITEM, venue: VENUE, distanceM: null }],
    });
    await renderApp('/deals');
    await screen.findByRole('article', { name: ITEM.name });
    expect(screen.getByText('По всему городу: геопозиция не указана')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^3.км$/ }).hasAttribute('disabled')).toBe(true);
    expect(server.callsTo('GET', '/api/v1/deals')[0]?.search).toBe('');
  });

  it('sends the saved point with the remembered radius', async () => {
    localStorage.setItem('ppshkin.radius', '5000');
    await start({ ...TEST_USER, location: { lat: 55.7887, lon: 49.1221 } });
    await renderApp('/venues');
    await screen.findByText('Кофейня «Зерно»');
    expect(server.callsTo('GET', '/api/v1/venues')[0]?.search).toBe('?lat=55.789&lon=49.122&radius=5000');
    fireEvent.click(screen.getByRole('button', { name: /^1.км$/ }));
    await waitFor(() => {
      expect(server.callsTo('GET', '/api/v1/venues').at(-1)?.search).toBe(
        '?lat=55.789&lon=49.122&radius=1000',
      );
    });
    expect(localStorage.getItem('ppshkin.radius')).toBe('1000');
  });

  it('filters open venues', async () => {
    await start();
    server.reply('GET', '/api/v1/venues', {
      items: [
        { venue: VENUE, distanceM: null, openNow: true, activeDeals: 0 },
        { venue: { ...VENUE, id: 2, name: 'Пекарня' }, distanceM: null, openNow: false, activeDeals: 0 },
      ],
    });
    await renderApp('/venues');
    await screen.findByText('Пекарня');
    fireEvent.click(screen.getByRole('switch'));
    expect(screen.queryByText('Пекарня')).toBeNull();
    expect(screen.getByText('Кофейня «Зерно»')).toBeTruthy();
  });

  it('explains when every venue nearby is closed', async () => {
    await start();
    server.reply('GET', '/api/v1/venues', {
      items: [{ venue: VENUE, distanceM: null, openNow: false, activeDeals: 0 }],
    });
    await renderApp('/venues');
    await screen.findByText('Кофейня «Зерно»');
    fireEvent.click(screen.getByRole('switch'));
    expect(screen.getByText('Сейчас все заведения рядом закрыты')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Показать все' }));
    expect(screen.getByText('Кофейня «Зерно»')).toBeTruthy();
  });
});

describe('venue', () => {
  it('shows hours, deals and the menu by category', async () => {
    await start();
    await renderApp('/venues/900001');
    expect(await screen.findByText('Открыто до 22:00')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Горящее' })).toBeTruthy();
    const desserts = screen.getByRole('region', { name: 'Десерты' });
    expect(within(desserts).getByText(/по данным заведения/)).toBeTruthy();
  });

  it('blocks booking while the venue is closed', async () => {
    await start();
    server.reply('GET', '/api/v1/venues/{id}', { venue: VENUE, openNow: false, menu: [ITEM], deals: [] });
    await renderApp('/venues/900001');
    expect(await screen.findByText('Закрыто, откроется в 08:00')).toBeTruthy();
    expect(screen.getByText('Бронь доступна, когда заведение открыто.')).toBeTruthy();
    for (const button of screen.getAllByRole('button', { name: 'Забронировать' })) {
      expect(button.hasAttribute('disabled')).toBe(true);
    }
  });

  it('shows a way back for an unknown venue', async () => {
    await start();
    server.on('GET', '/api/v1/venues/{id}', () => problem(404, 'venue_not_found'));
    await renderApp('/venues/5');
    expect(await screen.findByText('Заведение не найдено')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'К подборке' })).toBeTruthy();
  });

  it('copies the venue link outside MAX', async () => {
    await start();
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    await renderApp('/venues/900001');
    fireEvent.click(await screen.findByRole('button', { name: 'Поделиться' }));
    expect(await screen.findByText('Ссылка скопирована')).toBeTruthy();
    expect(writeText.mock.calls[0]).toEqual([expect.stringContaining('startapp=venue_900001')]);
  });
});
