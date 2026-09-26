import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderApp } from '../../../test/app.tsx';
import { json, problem, TEST_USER } from '../../../test/http.ts';
import type { UserProfile } from '../../api/client.ts';

vi.mock('../../api/index.ts', async () => (await import('../../../test/apiModule.ts')).apiModule);
const { server, startSession } = await import('../../../test/apiModule.ts');

const NO_CONSENT = { granted: false, version: null, grantedAt: null };
const NEW_USER: UserProfile = {
  ...TEST_USER,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  consents: { personalData: NO_CONSENT, personalizedOffers: NO_CONSENT },
};

const CONSENTS = {
  items: [
    {
      kind: 'personal_data',
      version: '2026-09-25',
      title: 'Согласие на обработку персональных данных',
      text: 'Первый абзац согласия.\n\nВторой абзац <b>без HTML</b>.',
      required: true,
      granted: false,
      grantedAt: null,
    },
    {
      kind: 'personalized_offers',
      version: '2026-09-25',
      title: 'Согласие на персональные предложения',
      text: 'Текст про предложения.',
      required: false,
      granted: false,
      grantedAt: null,
    },
  ],
};

let profile: UserProfile;

function granted(kind: 'personalData' | 'personalizedOffers') {
  profile = {
    ...profile,
    consents: {
      ...profile.consents,
      [kind]: { granted: true, version: '2026-09-25', grantedAt: '2026-09-26T10:00:00.000Z' },
    },
  };
}

async function start(user: UserProfile = NEW_USER, startParam: string | null = null) {
  profile = user;
  await startSession({ user, startParam });
  server.on('GET', '/api/v1/me', () => json(profile));
  server.reply('GET', '/api/v1/consents', CONSENTS);
  server.on('PUT', '/api/v1/consents/personal_data', () => {
    granted('personalData');
    return json(profile.consents.personalData);
  });
  server.on('PUT', '/api/v1/consents/personalized_offers', () => {
    granted('personalizedOffers');
    return json(profile.consents.personalizedOffers);
  });
  server.on('PATCH', '/api/v1/me', (call) => {
    profile = { ...profile, ...(call.body as Partial<UserProfile>) };
    return json(profile);
  });
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('gate', () => {
  it('sends a user without consent to onboarding from any screen', async () => {
    await start();
    const { router } = await renderApp('/eat');
    expect(await screen.findByRole('heading', { name: 'Привет, Анна!' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/onboarding');
    expect(screen.queryByRole('navigation', { name: 'Разделы' })).toBeNull();
  });

  it('skips onboarding when consent was given in the bot', async () => {
    await start(TEST_USER);
    const { router } = await renderApp('/');
    await screen.findByRole('heading', { name: 'Дневник' });
    expect(router.state.location.pathname).toBe('/diary');
  });

  it('keeps the goal step reachable after consent', async () => {
    await start(TEST_USER);
    const { router } = await renderApp('/onboarding/goal');
    await screen.findByRole('heading', { name: 'Цель и ориентир' });
    expect(router.state.location.pathname).toBe('/onboarding/goal');
  });

  it('returns to the consent screen on 403 consent_required and asks again', async () => {
    await start(TEST_USER);
    server.on('PATCH', '/api/v1/me', () => {
      profile = { ...profile, consents: { ...profile.consents, personalData: NO_CONSENT } };
      return problem(403, 'consent_required');
    });
    const { router } = await renderApp('/onboarding/goal');
    fireEvent.click(await screen.findByRole('button', { name: 'Сохранить' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/onboarding/consent');
    });
    expect(await screen.findByRole('button', { name: 'Даю согласие' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Далее' })).toBeNull();
  });
});

describe('consents', () => {
  it('shows the server text as paragraphs and sends the current version', async () => {
    await start();
    const { router } = await renderApp('/onboarding/consent');
    expect(await screen.findByText('Первый абзац согласия.')).toBeTruthy();
    expect(screen.getByText('Второй абзац <b>без HTML</b>.')).toBeTruthy();
    expect(screen.getByText('Шаг 1 из 4')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Даю согласие' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/onboarding/offers');
    });
    expect(server.callsTo('PUT', '/api/v1/consents/personal_data')[0]?.body).toEqual({
      version: '2026-09-25',
    });
  });

  it('reloads the text when the version is outdated', async () => {
    await start();
    server.on('PUT', '/api/v1/consents/personal_data', () => problem(409, 'consent_version_outdated'));
    await renderApp('/onboarding/consent');
    fireEvent.click(await screen.findByRole('button', { name: 'Даю согласие' }));
    expect(await screen.findByText('Текст согласия обновился, прочитайте новую версию')).toBeTruthy();
    await waitFor(() => {
      expect(server.callsTo('GET', '/api/v1/consents').length).toBeGreaterThan(1);
    });
  });

  it('explains a refusal and lets the user come back', async () => {
    await start();
    await renderApp('/onboarding/consent');
    fireEvent.click(await screen.findByRole('button', { name: 'Не сейчас' }));
    expect(screen.getByText('Без согласия мы не можем вести дневник питания и подбирать блюда')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Закрыть' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Вернуться к согласию' }));
    expect(screen.getByRole('button', { name: 'Даю согласие' })).toBeTruthy();
  });

  it('shows a retry when the text fails to load', async () => {
    await start();
    server.on('GET', '/api/v1/consents', () => problem(503, 'unavailable'));
    await renderApp('/onboarding/consent');
    expect(await screen.findByText('Не удалось загрузить текст согласия')).toBeTruthy();
    server.reply('GET', '/api/v1/consents', CONSENTS);
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByText('Первый абзац согласия.')).toBeTruthy();
  });

  it('keeps the offers consent optional with nothing preselected', async () => {
    await start();
    granted('personalData');
    const { router } = await renderApp('/onboarding/offers');
    await screen.findByText('Текст про предложения.');
    fireEvent.click(screen.getByRole('button', { name: 'Нет, спасибо' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/onboarding/goal');
    });
    expect(server.callsTo('PUT', '/api/v1/consents/personalized_offers')).toHaveLength(0);
  });

  it('grants the offers consent with its version', async () => {
    await start();
    granted('personalData');
    await renderApp('/onboarding/offers');
    fireEvent.click(await screen.findByRole('button', { name: 'Да, присылать' }));
    await waitFor(() => {
      expect(server.callsTo('PUT', '/api/v1/consents/personalized_offers')[0]?.body).toEqual({
        version: '2026-09-25',
      });
    });
  });
});

describe('goal and target', () => {
  it('saves the goal and a quick target', async () => {
    await start(TEST_USER);
    const { router } = await renderApp('/onboarding/goal');
    fireEvent.click(await screen.findByLabelText('Снизить вес'));
    fireEvent.click(screen.getByRole('button', { name: /^1800.ккал$/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/onboarding/location');
    });
    expect(server.callsTo('PATCH', '/api/v1/me')[0]?.body).toEqual({ kcalTarget: 1800, goal: 'lose' });
  });

  it('checks the custom target before sending', async () => {
    await start(TEST_USER);
    await renderApp('/onboarding/goal');
    fireEvent.change(await screen.findByLabelText('Свой ориентир, ккал в день'), {
      target: { value: '999' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(screen.getByText('От 1000 до 5000 ккал', { selector: '[id$="-error"]' })).toBeTruthy();
    expect(server.callsTo('PATCH', '/api/v1/me')).toHaveLength(0);
  });

  it('estimates the target without storing body parameters', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    await start(TEST_USER);
    server.reply('POST', '/api/v1/me/target/estimate', {
      kcalTarget: 1550,
      bmrKcal: 1320,
      maintenanceKcal: 1815,
    });
    await renderApp('/onboarding/goal');
    fireEvent.click(await screen.findByLabelText('Снизить вес'));
    fireEvent.click(screen.getByRole('button', { name: 'Рассчитать по параметрам' }));
    fireEvent.click(screen.getByLabelText('Женский'));
    fireEvent.change(screen.getByLabelText('Возраст, лет'), { target: { value: '30' } });
    fireEvent.change(screen.getByLabelText('Рост, см'), { target: { value: '165' } });
    fireEvent.change(screen.getByLabelText('Вес, кг'), { target: { value: '60' } });
    fireEvent.click(screen.getByLabelText('Лёгкая активность, 1-3 тренировки в неделю'));
    fireEvent.click(screen.getByRole('button', { name: 'Рассчитать' }));
    expect(await screen.findByText(/^Ориентир для цели: 1550.ккал$/)).toBeTruthy();
    expect(server.callsTo('POST', '/api/v1/me/target/estimate')[0]?.body).toEqual({
      sex: 'female',
      ageYears: 30,
      heightCm: 165,
      weightKg: 60,
      activity: 'light',
      goal: 'lose',
    });
    fireEvent.click(screen.getByRole('button', { name: /^Использовать 1550.ккал$/ }));
    expect(screen.getByLabelText<HTMLInputElement>('Свой ориентир, ккал в день').value).toBe('1550');
    expect(setItem).not.toHaveBeenCalled();
  });

  it('drops a stale result when the goal changes', async () => {
    await start(TEST_USER);
    server.reply('POST', '/api/v1/me/target/estimate', {
      kcalTarget: 1550,
      bmrKcal: 1320,
      maintenanceKcal: 1815,
    });
    await renderApp('/onboarding/goal');
    fireEvent.click(await screen.findByLabelText('Снизить вес'));
    fireEvent.click(screen.getByRole('button', { name: 'Рассчитать по параметрам' }));
    fireEvent.click(screen.getByLabelText('Мужской'));
    fireEvent.change(screen.getByLabelText('Возраст, лет'), { target: { value: '40' } });
    fireEvent.change(screen.getByLabelText('Рост, см'), { target: { value: '180' } });
    fireEvent.change(screen.getByLabelText('Вес, кг'), { target: { value: '80,5' } });
    fireEvent.click(screen.getByLabelText('Сидячий образ жизни'));
    fireEvent.click(screen.getByRole('button', { name: 'Рассчитать' }));
    await screen.findByText(/^Ориентир для цели: 1550.ккал$/);
    fireEvent.click(screen.getByLabelText('Набрать вес'));
    await waitFor(() => {
      expect(screen.queryByText(/^Ориентир для цели/)).toBeNull();
    });
  });

  it('shows field errors from the calculator before sending', async () => {
    await start(TEST_USER);
    await renderApp('/onboarding/goal');
    fireEvent.click(await screen.findByRole('button', { name: 'Рассчитать по параметрам' }));
    fireEvent.change(screen.getByLabelText('Возраст, лет'), { target: { value: '13' } });
    fireEvent.click(screen.getByRole('button', { name: 'Рассчитать' }));
    expect(screen.getByText('Сначала выберите цель')).toBeTruthy();
    expect(screen.getByText('От 14 до 100 лет', { selector: '[id$="-error"]' })).toBeTruthy();
    expect(screen.getByLabelText('Возраст, лет').getAttribute('aria-invalid')).toBe('true');
    expect(server.callsTo('POST', '/api/v1/me/target/estimate')).toHaveLength(0);
  });
});

describe('location', () => {
  function mockGeolocation(implementation: Geolocation['getCurrentPosition'] | null) {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: implementation === null ? undefined : { getCurrentPosition: implementation },
    });
  }

  it('sends the device position and moves on', async () => {
    mockGeolocation((success) => {
      success({ coords: { latitude: 55.7887, longitude: 49.1221 } } as GeolocationPosition);
    });
    await start(TEST_USER);
    server.on('PUT', '/api/v1/me/location', (call) => {
      profile = { ...profile, location: call.body as { lat: number; lon: number } };
      return json({ location: call.body, updatedAt: '2026-09-26T10:00:00.000Z' });
    });
    const { router } = await renderApp('/onboarding/location');
    fireEvent.click(await screen.findByRole('button', { name: 'Разрешить' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/onboarding/done');
    });
    expect(server.callsTo('PUT', '/api/v1/me/location')[0]?.body).toEqual({ lat: 55.7887, lon: 49.1221 });
    expect(await screen.findByText('Указана')).toBeTruthy();
  });

  it('retries a failed save with the same point', async () => {
    const getCurrentPosition = vi.fn<Geolocation['getCurrentPosition']>((success) => {
      success({ coords: { latitude: 55.7887, longitude: 49.1221 } } as GeolocationPosition);
    });
    mockGeolocation(getCurrentPosition);
    await start(TEST_USER);
    server.on('PUT', '/api/v1/me/location', () => problem(503, 'unavailable'));
    const { router } = await renderApp('/onboarding/location');
    fireEvent.click(await screen.findByRole('button', { name: 'Разрешить' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Повторить' }));
    server.on('PUT', '/api/v1/me/location', (call) =>
      json({ location: call.body, updatedAt: '2026-09-26T10:00:00.000Z' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/onboarding/done');
    });
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
  });

  it('offers the bot when the user denies access', async () => {
    mockGeolocation((_success, failure) => {
      failure?.({
        code: 1,
        PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2,
        TIMEOUT: 3,
        message: '',
      });
    });
    await start(TEST_USER);
    await renderApp('/onboarding/location');
    fireEvent.click(await screen.findByRole('button', { name: 'Разрешить' }));
    expect(await screen.findByRole('button', { name: 'Перейти в чат с ботом' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Пропустить' })).toBeTruthy();
  });

  it('shows the bot fallback at once without the API and picks up a position sent in the chat', async () => {
    mockGeolocation(null);
    await start(TEST_USER);
    const { router } = await renderApp('/onboarding/location');
    expect(await screen.findByRole('button', { name: 'Перейти в чат с ботом' })).toBeTruthy();
    profile = { ...profile, location: { lat: 55.79, lon: 49.12 } };
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(await screen.findByText('Геопозиция получена из чата с ботом')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Далее' }));
    expect(router.state.location.pathname).toBe('/onboarding/done');
  });
});

describe('time zone and links', () => {
  it('sends the device time zone once and ignores 422', async () => {
    await start({ ...TEST_USER, timezone: 'Asia/Vladivostok' });
    server.on('PATCH', '/api/v1/me', () => problem(422, 'invalid_timezone'));
    await renderApp('/diary');
    await waitFor(() => {
      expect(server.callsTo('PATCH', '/api/v1/me')).toHaveLength(1);
    });
    expect(server.callsTo('PATCH', '/api/v1/me')[0]?.body).toEqual({
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    expect(screen.getByRole('heading', { name: 'Дневник' })).toBeTruthy();
  });

  it('opens the startapp link after the whole onboarding', async () => {
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: undefined });
    await start(NEW_USER, 'venue_7');
    const { router } = await renderApp('/');
    fireEvent.click(await screen.findByRole('button', { name: 'Начать' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Даю согласие' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Нет, спасибо' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Пропустить' }));
    await screen.findByRole('button', { name: 'Перейти в чат с ботом' });
    fireEvent.click(screen.getByRole('button', { name: 'Пропустить' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Продолжить' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/venues/7');
    });
  });
});
