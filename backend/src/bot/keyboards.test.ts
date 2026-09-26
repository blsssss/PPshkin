import { describe, expect, it } from 'vitest';
import { kcalButtons, miniAppUrl, placeButtons, routeUrl } from './keyboards.ts';

describe('keyboards', () => {
  it('builds a Yandex Maps link with the longitude first', () => {
    expect(routeUrl({ lat: 55.7887, lon: 49.1221 })).toBe(
      'https://yandex.ru/maps/?pt=49.1221,55.7887&z=17&l=map',
    );
  });

  it('links a screen of the mini app through startapp', () => {
    expect(miniAppUrl('ppshkin_bot', 'deal_21')).toBe('https://max.ru/ppshkin_bot?startapp=deal_21');
  });

  it('offers the calculator only when the mini app is enabled', () => {
    expect(
      kcalButtons('pf', false)
        .flat()
        .map((button) => button.text),
    ).not.toContain('Рассчитать');
    expect(kcalButtons('pf', true).at(-1)).toEqual([{ kind: 'app', text: 'Рассчитать' }]);
  });

  it('adds the mini app link next to the route only when enabled', () => {
    const place = {
      location: { lat: 1, lon: 2 },
      botUsername: 'ppshkin_bot',
      appLabel: 'Открыть',
      startParam: 'venue_7',
    };
    expect(placeButtons({ ...place, miniAppEnabled: false })).toEqual([
      [{ kind: 'link', text: 'Маршрут', url: 'https://yandex.ru/maps/?pt=2,1&z=17&l=map' }],
    ]);
    expect(placeButtons({ ...place, miniAppEnabled: true })[0]?.[1]).toEqual({
      kind: 'link',
      text: 'Открыть',
      url: 'https://max.ru/ppshkin_bot?startapp=venue_7',
    });
  });
});
