import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeWebApp } from '../../../test/webapp.ts';
import { share } from '../../shared/share.ts';
import {
  bookingLink,
  dealShareText,
  hoursText,
  readRadius,
  recommendationHeader,
  resolveSearchPoint,
  timeLeft,
  venueShareText,
  writeRadius,
  type Deal,
  type Venue,
} from './model.ts';

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

const DEAL: Deal = {
  id: 5,
  menuItemId: 910106,
  itemName: 'Чизкейк',
  priceRub: 170,
  originalPriceRub: 290,
  discountPercent: 41,
  quantityTotal: 5,
  quantityLeft: 3,
  startsAt: '2026-09-26T09:00:00.000Z',
  endsAt: '2026-09-26T18:00:00.000Z',
  status: 'active',
};

afterEach(() => {
  localStorage.clear();
});

describe('resolveSearchPoint', () => {
  it('prefers the device, then the saved point, then nothing', () => {
    expect(resolveSearchPoint({ lat: 55.78871, lon: 49.12216 }, { lat: 1, lon: 2 })).toEqual({
      source: 'device',
      point: { lat: 55.789, lon: 49.122 },
    });
    expect(resolveSearchPoint(null, { lat: 55.7, lon: 49.1 })).toEqual({
      source: 'saved',
      point: { lat: 55.7, lon: 49.1 },
    });
    expect(resolveSearchPoint(null, null)).toEqual({ source: 'none', point: null });
  });
});

describe('radius', () => {
  it('remembers the choice and falls back to 3 km', () => {
    expect(readRadius()).toBe(3000);
    writeRadius(5000);
    expect(readRadius()).toBe(5000);
    localStorage.setItem('ppshkin.radius', '777');
    expect(readRadius()).toBe(3000);
  });

  it('survives a blocked storage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => {
      writeRadius(1000);
    }).not.toThrow();
    expect(readRadius()).toBe(3000);
  });
});

describe('hours', () => {
  it.each([
    [{ opensAt: '08:00', closesAt: '22:00' }, true, 'Открыто до 22:00'],
    [{ opensAt: '08:00', closesAt: '22:00' }, false, 'Закрыто, откроется в 08:00'],
    [{ opensAt: '18:00', closesAt: '02:00' }, true, 'Открыто до 02:00'],
    [{ opensAt: '00:00', closesAt: '00:00' }, true, 'Круглосуточно'],
    [{ opensAt: '09:00:00', closesAt: '09:00:00' }, false, 'Круглосуточно'],
  ])('%j open=%s', (hours, openNow, text) => {
    expect(hoursText(hours, openNow)).toBe(text);
  });
});

describe('texts and links', () => {
  it('shows how long a deal has left only in the last two hours', () => {
    expect(timeLeft('2026-09-26T18:00:00.000Z', new Date('2026-09-26T16:40:00.000Z'))).toBe('ещё 1 ч 20 мин');
    expect(timeLeft('2026-09-26T18:00:00.000Z', new Date('2026-09-26T17:15:00.000Z'))).toBe('ещё 45 мин');
    expect(timeLeft('2026-09-26T18:00:00.000Z', new Date('2026-09-26T15:00:00.000Z'))).toBeNull();
    expect(timeLeft('2026-09-26T18:00:00.000Z', new Date('2026-09-26T18:01:00.000Z'))).toBeNull();
  });

  it('builds booking links with and without a deal and an offer', () => {
    expect(bookingLink({ venueId: 1, menuItemId: 2 })).toBe('/bookings/new?venueId=1&menuItemId=2');
    expect(bookingLink({ venueId: 1, menuItemId: 2, dealId: 3, offerId: 4 })).toBe(
      '/bookings/new?venueId=1&menuItemId=2&dealId=3&offerId=4',
    );
    expect(bookingLink({ venueId: 1, menuItemId: 2, dealId: null, offerId: 4 })).toBe(
      '/bookings/new?venueId=1&menuItemId=2&offerId=4',
    );
  });

  it('writes share texts in the venue time zone', () => {
    expect(dealShareText(DEAL, VENUE)).toBe(
      'Чизкейк за 170 ₽ вместо 290 ₽ до 21:00, Кофейня «Зерно», Казань, ул. Баумана, 36',
    );
    expect(venueShareText(VENUE)).toBe('Кофейня «Зерно», кофейня, Казань, ул. Баумана, 36');
  });

  it('summarises the slot budget', () => {
    expect(recommendationHeader({ slot: 'lunch', remainingKcal: 850, slotBudgetKcal: 700 })).toBe(
      'Сейчас обед. До ориентира осталось около 850 ккал, на обед примерно 700 ккал',
    );
  });
});

describe('share', () => {
  const content = { text: 'Чизкейк', link: 'https://max.ru/bot?startapp=venue_1' };

  it('uses MAX sharing inside MAX', async () => {
    const webApp = fakeWebApp();
    await expect(share(content)).resolves.toBe('shared');
    expect(webApp.shareMaxContent).toHaveBeenCalledWith(content);
  });

  it('treats a cancel as no error', async () => {
    fakeWebApp({
      shareMaxContent: vi.fn(() => Promise.reject({ error: { code: 'client.web_app_max_share.cancelled' } })),
    });
    await expect(share(content)).resolves.toBe('cancelled');
  });

  it('copies the link when sharing is unavailable', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    await expect(share(content)).resolves.toBe('copied');
    expect(writeText).toHaveBeenCalledWith('Чизкейк\nhttps://max.ru/bot?startapp=venue_1');
  });

  it('asks for manual copy without a clipboard', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('denied')) },
    });
    await expect(share(content)).resolves.toBe('manual');
  });
});
