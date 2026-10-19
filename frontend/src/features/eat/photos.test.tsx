import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderApp } from '../../../test/app.tsx';
import { json, TEST_USER } from '../../../test/http.ts';
import { setDevicePoint } from '../../shared/geo/devicePoint.ts';
import type { Deal, MenuItem, RecommendationItem, Venue } from './model.ts';

vi.mock('../../api/index.ts', async () => (await import('../../../test/apiModule.ts')).apiModule);
const { server, startSession } = await import('../../../test/apiModule.ts');

const VENUE_PHOTO = `/api/v1/photos/${'c'.repeat(64)}.webp`;
const ITEM_PHOTO = `/api/v1/photos/${'d'.repeat(64)}.webp`;

const VENUE: Venue = {
  id: 7,
  name: 'Кофейня «Зерно»',
  address: 'Казань, ул. Баумана, 36',
  category: 'coffee',
  location: { lat: 55.7897, lon: 49.1189 },
  opensAt: '00:00',
  closesAt: '00:00',
  timezone: 'Europe/Moscow',
  isDemo: false,
  photoUrl: VENUE_PHOTO,
};

const ITEM: MenuItem = {
  id: 11,
  name: 'Чизкейк',
  description: null,
  category: 'dessert',
  priceRub: 290,
  weightG: 120,
  kcal: 420,
  proteinG: null,
  fatG: null,
  carbsG: null,
  nutritionSource: 'venue',
  tags: [],
  isAvailable: true,
  photoUrl: ITEM_PHOTO,
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
  endsAt: '2099-01-01T00:00:00.000Z',
  status: 'active',
};

function recommendation(item: MenuItem, venue: Venue): RecommendationItem {
  return {
    offerId: 1,
    headline: 'Можно позволить десерт',
    facts: [],
    calculations: [],
    assumptions: [],
    score: 0.8,
    item,
    venue,
    deal: null,
    distanceM: 300,
    priceRub: item.priceRub,
    kcal: item.kcal,
  };
}

const srcs = (root: HTMLElement) => [...root.querySelectorAll('img')].map((img) => img.getAttribute('src'));

async function start(venue: Venue, item: MenuItem) {
  setDevicePoint(null);
  await startSession();
  server.on('GET', '/api/v1/me', () => json(TEST_USER));
  server.reply('GET', '/api/v1/insights', { readiness: 'ready', mealsUntilReady: 0 });
  server.reply('GET', '/api/v1/recommendations', {
    status: 'ok',
    slot: 'lunch',
    remainingKcal: 850,
    slotBudgetKcal: 700,
    items: [recommendation(item, venue)],
  });
  server.reply('GET', '/api/v1/deals', { items: [{ deal: DEAL, item, venue, distanceM: 300 }] });
  server.reply('GET', '/api/v1/venues', {
    items: [{ venue, distanceM: 300, openNow: true, activeDeals: 1 }],
  });
  server.reply('GET', '/api/v1/venues/{id}', { venue, openNow: true, menu: [item], deals: [DEAL] });
}

beforeEach(() => {
  localStorage.clear();
});

describe('photos in guest cards', () => {
  it('shows the dish photo on the recommendation card', async () => {
    await start(VENUE, ITEM);
    await renderApp('/eat');
    const card = await screen.findByRole('article', { name: 'Чизкейк' });
    expect(srcs(card)).toEqual([ITEM_PHOTO]);
  });

  it('falls back to the venue photo when the dish has none', async () => {
    await start(VENUE, { ...ITEM, photoUrl: null });
    await renderApp('/eat');
    const card = await screen.findByRole('article', { name: 'Чизкейк' });
    expect(srcs(card)).toEqual([VENUE_PHOTO]);
  });

  it('keeps the old card without any photo', async () => {
    await start({ ...VENUE, photoUrl: null }, { ...ITEM, photoUrl: null });
    await renderApp('/eat');
    const card = await screen.findByRole('article', { name: 'Чизкейк' });
    expect(card.querySelector('img')).toBeNull();
  });

  it('shows the item photo on the hot deal card', async () => {
    await start(VENUE, ITEM);
    await renderApp('/deals');
    const card = await screen.findByRole('article', { name: 'Чизкейк' });
    expect(srcs(card)).toEqual([ITEM_PHOTO]);
  });

  it('shows the venue photo in the venue list', async () => {
    await start(VENUE, ITEM);
    await renderApp('/venues');
    const row = (await screen.findByText('Кофейня «Зерно»')).closest('button');
    expect(row).not.toBeNull();
    if (row) expect(srcs(row)).toEqual([VENUE_PHOTO]);
  });

  it('shows the venue photo in the large size and the photos of deals and menu on the venue card', async () => {
    await start(VENUE, ITEM);
    await renderApp('/venues/7');
    const head = (await screen.findByText(/^Кофейня, Казань/)).closest('section');
    expect(head).not.toBeNull();
    if (head) expect(srcs(head)).toEqual([`${VENUE_PHOTO}?size=large`]);
    const deals = screen.getByRole('region', { name: 'Горящее' });
    expect(srcs(deals)).toEqual([ITEM_PHOTO]);
    const menu = screen.getByRole('region', { name: 'Десерты' });
    expect(srcs(menu)).toEqual([ITEM_PHOTO]);
    expect(within(menu).getByText('Чизкейк')).toBeTruthy();
  });
});
