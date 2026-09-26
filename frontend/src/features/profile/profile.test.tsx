import { fireEvent, renderHook, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderApp } from '../../../test/app.tsx';
import { json, problem, TEST_USER } from '../../../test/http.ts';
import type { UserProfile } from '../../api/client.ts';
import { setDevicePoint, useDevicePoint } from '../../shared/geo/devicePoint.ts';

vi.mock('../../api/index.ts', async () => (await import('../../../test/apiModule.ts')).apiModule);
const { apiModule, server, startSession } = await import('../../../test/apiModule.ts');

const CONSENTS = {
  items: [
    {
      kind: 'personal_data',
      version: '2026-09-25',
      title: 'Согласие на обработку персональных данных',
      text: 'Текст согласия на обработку.',
      required: true,
      granted: true,
      grantedAt: '2026-09-25T10:00:00.000Z',
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

async function start(user: UserProfile = TEST_USER) {
  profile = user;
  setDevicePoint(null);
  await startSession({ user });
  server.on('GET', '/api/v1/me', () => json(profile));
  server.reply('GET', '/api/v1/consents', CONSENTS);
  server.on('PATCH', '/api/v1/me', (call) => {
    profile = { ...profile, ...(call.body as Partial<UserProfile>) };
    return json(profile);
  });
}

function section(name: string) {
  return screen.getByRole('region', { name });
}

beforeEach(() => {
  localStorage.clear();
});

describe('settings', () => {
  it('shows the profile and saves only what changed', async () => {
    await start();
    await renderApp('/profile');
    expect(await screen.findByText(/^2000.ккал в день$/)).toBeTruthy();
    expect(within(section('Не предлагать')).getByText('Ничего не исключено')).toBeTruthy();
    expect(within(section('Местоположение')).getByText('Не указано')).toBeTruthy();
    expect(screen.getByText('Дано 25.09.2026, редакция 2026-09-25')).toBeTruthy();
    const save = screen.getByRole('button', { name: 'Сохранить' });
    expect(save.hasAttribute('disabled')).toBe(true);

    fireEvent.click(within(section('Ориентир калорий')).getByRole('button', { name: 'Изменить' }));
    fireEvent.click(screen.getByRole('button', { name: /^1800.ккал$/ }));
    fireEvent.click(save);
    expect(await screen.findByText('Сохранено')).toBeTruthy();
    expect(server.callsTo('PATCH', '/api/v1/me')[0]?.body).toEqual({ kcalTarget: 1800 });
    expect(await screen.findByText(/^1800.ккал в день$/)).toBeTruthy();
  });

  it('keeps an unsaved target when another section updates the profile', async () => {
    await start();
    server.on('PUT', '/api/v1/me/location', (call) => {
      profile = {
        ...profile,
        location: call.body as { lat: number; lon: number },
        locationUpdatedAt: new Date().toISOString(),
      };
      return json({ location: call.body, updatedAt: profile.locationUpdatedAt });
    });
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (success: PositionCallback) => {
          success({ coords: { latitude: 55.7887, longitude: 49.1221 } } as GeolocationPosition);
        },
      },
    });
    await renderApp('/profile');
    fireEvent.click(
      within(await screen.findByRole('region', { name: 'Ориентир калорий' })).getByRole('button', {
        name: 'Изменить',
      }),
    );
    fireEvent.change(screen.getByLabelText('Свой ориентир, ккал в день'), { target: { value: '2300' } });
    fireEvent.click(within(section('Местоположение')).getByRole('button', { name: 'Обновить' }));
    expect(await screen.findByText('Геопозиция обновлена')).toBeTruthy();
    expect(server.callsTo('PUT', '/api/v1/me/location')[0]?.body).toEqual({ lat: 55.7887, lon: 49.1221 });
    expect(await screen.findByText('Обновлено только что, точность около 1 км')).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>('Свой ориентир, ккал в день').value).toBe('2300');
  });

  it('keeps edits made while a save is pending', async () => {
    await start();
    const gate: { release?: () => void } = {};
    server.on(
      'PATCH',
      '/api/v1/me',
      (call) =>
        new Promise<Response>((resolve) => {
          gate.release = () => {
            profile = { ...profile, ...(call.body as Partial<UserProfile>) };
            resolve(json(profile));
          };
        }),
    );
    await renderApp('/profile');
    fireEvent.click(
      within(await screen.findByRole('region', { name: 'Ориентир калорий' })).getByRole('button', {
        name: 'Изменить',
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: /^1800.ккал$/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    fireEvent.click(screen.getByLabelText('Набрать вес'));
    await waitFor(() => {
      expect(gate.release).toBeDefined();
    });
    gate.release?.();
    expect(await screen.findByText(/^1800.ккал в день$/)).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>('Набрать вес').checked).toBe(true);
  });

  it('asks for a target in steps of 50', async () => {
    await start();
    await renderApp('/profile');
    fireEvent.click(
      within(await screen.findByRole('region', { name: 'Ориентир калорий' })).getByRole('button', {
        name: 'Изменить',
      }),
    );
    fireEvent.change(screen.getByLabelText('Свой ориентир, ккал в день'), { target: { value: '1777' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(screen.getByText('Укажите значение, кратное 50')).toBeTruthy();
    expect(server.callsTo('PATCH', '/api/v1/me')).toHaveLength(0);
  });

  it('keeps a time zone chosen by hand', async () => {
    await start();
    await renderApp('/profile');
    fireEvent.change(await screen.findByLabelText('Часовой пояс дневника'), {
      target: { value: 'Asia/Vladivostok' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByText('Сохранено')).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(server.callsTo('PATCH', '/api/v1/me').map((call) => call.body)).toEqual([
      { timezone: 'Asia/Vladivostok' },
    ]);
  });

  it('shows a time zone error at the field', async () => {
    await start();
    server.on('PATCH', '/api/v1/me', () => problem(422, 'invalid_timezone'));
    await renderApp('/profile');
    fireEvent.change(await screen.findByLabelText('Часовой пояс дневника'), {
      target: { value: 'Asia/Vladivostok' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByText('Этот часовой пояс не поддерживается, выберите из списка')).toBeTruthy();
    expect(server.callsTo('PATCH', '/api/v1/me')[0]?.body).toEqual({ timezone: 'Asia/Vladivostok' });
  });

  it('clears the goal', async () => {
    await start({ ...TEST_USER, goal: 'lose' });
    await renderApp('/profile');
    fireEvent.click(await screen.findByLabelText('Не выбрана'));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => {
      expect(server.callsTo('PATCH', '/api/v1/me')[0]?.body).toEqual({ goal: null });
    });
  });

  it('removes the saved location', async () => {
    await start({
      ...TEST_USER,
      location: { lat: 55.79, lon: 49.12 },
      locationUpdatedAt: new Date().toISOString(),
    });
    server.on('DELETE', '/api/v1/me/location', () => {
      profile = { ...profile, location: null, locationUpdatedAt: null };
      return new Response(null, { status: 204 });
    });
    await renderApp('/profile');
    fireEvent.click(
      within(await screen.findByRole('region', { name: 'Местоположение' })).getByRole('button', {
        name: 'Удалить',
      }),
    );
    expect(await screen.findByText('Местоположение удалено')).toBeTruthy();
    expect(within(section('Местоположение')).getByText('Не указано')).toBeTruthy();
  });
});

describe('consents', () => {
  it('turns the offers on after reading the text and off at once', async () => {
    await start();
    server.on('PUT', '/api/v1/consents/personalized_offers', () => {
      profile = {
        ...profile,
        consents: {
          ...profile.consents,
          personalizedOffers: { granted: true, version: '2026-09-25', grantedAt: '2026-09-26T10:00:00.000Z' },
        },
      };
      return json(profile.consents.personalizedOffers);
    });
    server.on('DELETE', '/api/v1/consents/personalized_offers', () => {
      profile = {
        ...profile,
        consents: {
          ...profile.consents,
          personalizedOffers: { granted: false, version: null, grantedAt: null },
        },
      };
      return new Response(null, { status: 204 });
    });
    await renderApp('/profile');
    fireEvent.click(await screen.findByRole('switch'));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText('Текст про предложения.')).toBeTruthy();
    expect(server.callsTo('PUT', '/api/v1/consents/personalized_offers')).toHaveLength(0);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Согласен' }));
    expect(await screen.findByText('Предложения в чате включены')).toBeTruthy();
    expect(server.callsTo('PUT', '/api/v1/consents/personalized_offers')[0]?.body).toEqual({
      version: '2026-09-25',
    });
    await waitFor(() => {
      expect(screen.getByRole<HTMLInputElement>('switch').checked).toBe(true);
    });

    fireEvent.click(screen.getByRole('switch'));
    expect(await screen.findByText('Предложения в чате отключены')).toBeTruthy();
    expect(server.callsTo('DELETE', '/api/v1/consents/personalized_offers')).toHaveLength(1);
  });

  it('turns the offers off at once', async () => {
    await start({
      ...TEST_USER,
      consents: {
        ...TEST_USER.consents,
        personalizedOffers: { granted: true, version: '2026-09-25', grantedAt: '2026-09-26T10:00:00.000Z' },
      },
    });
    server.on('DELETE', '/api/v1/consents/personalized_offers', () => new Promise<Response>(() => undefined));
    await renderApp('/profile');
    const toggle = await screen.findByRole<HTMLInputElement>('switch');
    expect(toggle.checked).toBe(true);
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(screen.getByRole<HTMLInputElement>('switch').checked).toBe(false);
    });
  });

  it('offers a retry when the consent text does not load', async () => {
    await start();
    server.on('GET', '/api/v1/consents', () => problem(500, 'internal_error'));
    await renderApp('/profile');
    fireEvent.click(await screen.findByRole('switch'));
    const sheet = await screen.findByRole('dialog');
    server.reply('GET', '/api/v1/consents', CONSENTS);
    fireEvent.click(await within(sheet).findByRole('button', { name: 'Повторить' }));
    expect(await within(sheet).findByRole('button', { name: 'Согласен' })).toBeTruthy();
  });

  it('asks to read an updated text again', async () => {
    await start();
    server.on('PUT', '/api/v1/consents/personalized_offers', () => problem(409, 'consent_version_outdated'));
    await renderApp('/profile');
    fireEvent.click(await screen.findByRole('switch'));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Согласен' }));
    expect(
      await screen.findByText('Текст согласия обновился, прочитайте и подтвердите его снова'),
    ).toBeTruthy();
    await waitFor(() => {
      expect(server.callsTo('GET', '/api/v1/consents').length).toBeGreaterThan(1);
    });
  });

  it('shows the consent text and an unknown one', async () => {
    await start();
    const { router } = await renderApp('/profile/consents/personal_data');
    expect(await screen.findByText('Текст согласия на обработку.')).toBeTruthy();
    await router.navigate('/profile/consents/marketing');
    expect(await screen.findByText('Такого согласия нет')).toBeTruthy();
  });
});

describe('sub screens', () => {
  it('saves disliked tags and resets them', async () => {
    await start({ ...TEST_USER, dislikedTags: ['sweet'] });
    const { router } = await renderApp('/profile/tags');
    expect(await screen.findByText('Выбрано 1 из 20')).toBeTruthy();
    const save = screen.getByRole('button', { name: 'Сохранить' });
    expect(save.hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'шоколад' }));
    expect(screen.getByText('Выбрано 2 из 20')).toBeTruthy();
    fireEvent.click(save);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/profile');
    });
    expect(server.callsTo('PATCH', '/api/v1/me')[0]?.body).toEqual({ dislikedTags: ['sweet', 'chocolate'] });
    expect(await screen.findByText('сладкое, шоколад')).toBeTruthy();

    await router.navigate('/profile/tags');
    fireEvent.click(await screen.findByRole('button', { name: 'Сбросить все' }));
    expect(screen.getByText('Выбрано 0 из 20')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => {
      expect(server.callsTo('PATCH', '/api/v1/me')[1]?.body).toEqual({ dislikedTags: [] });
    });
  });

  it('saves the target with the goal', async () => {
    await start();
    const { router } = await renderApp('/profile/target');
    fireEvent.click(await screen.findByLabelText('Снизить вес'));
    fireEvent.click(screen.getByRole('button', { name: /^1600.ккал$/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить ориентир' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/profile');
    });
    expect(server.callsTo('PATCH', '/api/v1/me')[0]?.body).toEqual({ kcalTarget: 1600, goal: 'lose' });
  });
});

describe('account deletion', () => {
  it('deletes the account and wipes local data', async () => {
    await start();
    setDevicePoint({ lat: 55.78871, lon: 49.12214 });
    localStorage.setItem('ppshkin.radius', '5000');
    localStorage.setItem('other.key', 'keep');
    server.on('DELETE', '/api/v1/me', () => new Response(null, { status: 204 }));
    await renderApp('/profile/delete');
    expect(await screen.findByText(/действие нельзя отменить/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Удалить аккаунт' }));
    expect(server.callsTo('DELETE', '/api/v1/me')).toHaveLength(0);
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Удалить' }));
    await waitFor(() => {
      expect(apiModule.session.getState().status).toBe('deleted');
    });
    expect(server.callsTo('DELETE', '/api/v1/me')).toHaveLength(1);
    expect(localStorage.getItem('ppshkin.radius')).toBeNull();
    expect(renderHook(() => useDevicePoint()).result.current).toBeNull();
    expect(localStorage.getItem('other.key')).toBe('keep');
  });

  it('explains the shared demo account and allows a retry', async () => {
    await start();
    server.on('DELETE', '/api/v1/me', () => problem(403, 'demo_account_protected'));
    await renderApp('/profile/delete');
    fireEvent.click(await screen.findByRole('button', { name: 'Удалить аккаунт' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Удалить' }));
    expect(
      await screen.findByText('Демо-аккаунт удалить нельзя, он общий для всех проверяющих'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeTruthy();
    expect(apiModule.session.getState().status).toBe('ready');
  });
});
