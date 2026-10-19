import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderApp, setOnline } from '../../../test/app.tsx';
import { json, problem } from '../../../test/http.ts';
import type { Schemas } from '../../api/client.ts';
import type { Booking } from '../bookings/model.ts';

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

const BOOKING: Booking = {
  id: 5,
  code: 'K7M2QX',
  qrPayload: 'ppshkin:booking:K7M2QX',
  status: 'expired',
  expiresAt: '2026-09-26T09:30:00.000Z',
  createdAt: '2026-09-26T08:30:00.000Z',
  resolvedAt: '2026-09-26T09:30:00.000Z',
  dealId: null,
  item: ITEM,
  venue: VENUE,
  priceRub: 290,
  kcal: 420,
};

const COMPLAINT: Schemas['Complaint'] = {
  id: 1,
  venueId: VENUE.id,
  bookingId: BOOKING.id,
  reason: 'not_served',
  status: 'open',
  createdAt: NOW.toISOString(),
  resolvedAt: null,
};

async function start() {
  await startSession();
  server.reply('GET', '/api/v1/venues/{id}', { venue: VENUE, openNow: true, menu: [ITEM], deals: [] });
  server.reply('GET', '/api/v1/bookings/{id}', BOOKING);
  server.on('GET', '/api/v1/bookings', () => json({ items: [] }));
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true, now: NOW });
});

afterEach(() => {
  vi.useRealTimers();
  setOnline(true);
});

describe('complaint about a booking', () => {
  it('sends the chosen reason and the text with the booking id and thanks the guest', async () => {
    await start();
    server.on('POST', '/api/v1/complaints', () => json(COMPLAINT, 201));
    await renderApp('/bookings/5');
    fireEvent.click(await screen.findByRole('button', { name: 'Проблема с бронью' }));
    const sheet = await screen.findByRole('dialog');
    const send = within(sheet).getByRole('button', { name: 'Отправить' });
    expect(send.hasAttribute('disabled')).toBe(true);
    fireEvent.click(within(sheet).getByLabelText('Не выдали заказ по брони'));
    fireEvent.change(within(sheet).getByLabelText('Подробности, если хотите'), {
      target: { value: '  Сказали, что закончилось  ' },
    });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Отправить' }));
    expect(await screen.findByText('Спасибо, разберёмся')).toBeTruthy();
    expect(server.callsTo('POST', '/api/v1/complaints')[0]?.body).toEqual({
      venueId: VENUE.id,
      bookingId: BOOKING.id,
      reason: 'not_served',
      text: 'Сказали, что закончилось',
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('offers every reason from the list', async () => {
    await start();
    await renderApp('/bookings/5');
    fireEvent.click(await screen.findByRole('button', { name: 'Проблема с бронью' }));
    const sheet = await screen.findByRole('dialog');
    for (const label of [
      'Не выдали заказ по брони',
      'Цена на кассе другая',
      'Заведение было закрыто',
      'Блюда не было в наличии',
      'Качество блюда',
      'Неверные сведения о заведении или меню',
      'Другое',
    ]) {
      expect(within(sheet).getByLabelText(label)).toBeTruthy();
    }
  });

  it('says so when the booking already has a complaint', async () => {
    await start();
    server.on('POST', '/api/v1/complaints', () => problem(409, 'complaint_exists'));
    await renderApp('/bookings/5');
    fireEvent.click(await screen.findByRole('button', { name: 'Проблема с бронью' }));
    const sheet = await screen.findByRole('dialog');
    fireEvent.click(within(sheet).getByLabelText('Другое'));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Отправить' }));
    expect(await screen.findByText('Жалоба на эту бронь уже отправлена')).toBeTruthy();
  });

  it('keeps the sheet open on a server failure so the guest can retry', async () => {
    await start();
    server.on('POST', '/api/v1/complaints', () => problem(500, 'internal_error'));
    await renderApp('/bookings/5');
    fireEvent.click(await screen.findByRole('button', { name: 'Проблема с бронью' }));
    const sheet = await screen.findByRole('dialog');
    fireEvent.click(within(sheet).getByLabelText('Качество блюда'));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Отправить' }));
    expect(await screen.findByText('Что-то пошло не так')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});

describe('complaint about a venue', () => {
  it('is sent without a booking from the venue card', async () => {
    await start();
    server.on('POST', '/api/v1/complaints', () =>
      json({ ...COMPLAINT, bookingId: null, reason: 'wrong_info' }, 201),
    );
    await renderApp('/venues/900001');
    fireEvent.click(await screen.findByRole('button', { name: 'Сообщить о проблеме' }));
    const sheet = await screen.findByRole('dialog');
    fireEvent.click(within(sheet).getByLabelText('Неверные сведения о заведении или меню'));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Отправить' }));
    expect(await screen.findByText('Спасибо, разберёмся')).toBeTruthy();
    expect(server.callsTo('POST', '/api/v1/complaints')[0]?.body).toEqual({
      venueId: VENUE.id,
      reason: 'wrong_info',
    });
  });
});
