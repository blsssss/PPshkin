import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectContract } from '../../../test/contract.ts';
import { bearer, buildTestApp } from '../../../test/services.ts';
import type {
  NotificationSettings,
  NotificationSettingsPatch,
  NotificationSettingsService,
} from '../../services/notification-settings.ts';
import { notFound, unprocessable } from '../../shared/errors.ts';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

const settings: NotificationSettings = {
  timezone: 'Europe/Moscow',
  quietHours: { from: '22:00', until: '09:00' },
  kinds: [
    { kind: 'booking_confirmed', audience: 'guest', enabled: true, editable: true },
    { kind: 'booking_reminder', audience: 'guest', enabled: false, editable: true },
    { kind: 'menu_import_done', audience: 'venue', enabled: true, editable: false },
  ],
};

function start(overrides: Partial<NotificationSettingsService>) {
  const service: NotificationSettingsService = {
    get: vi.fn(() => Promise.resolve(settings)),
    update: vi.fn(() => Promise.resolve(settings)),
    ...overrides,
  };
  return buildTestApp({ services: { notificationSettings: service } }).then((built) => {
    app = built;
    return { app: built, service };
  });
}

function patch(instance: FastifyInstance, payload: unknown) {
  return instance.inject({
    method: 'PATCH',
    url: '/api/v1/me/notifications',
    headers: bearer('guest-token'),
    payload: payload as Record<string, unknown>,
  });
}

describe('GET /api/v1/me/notifications', () => {
  it('returns the settings of the caller', async () => {
    const { app: instance, service } = await start({});

    const response = await instance.inject({
      method: 'GET',
      url: '/api/v1/me/notifications',
      headers: bearer('guest-token'),
    });

    expect(response.statusCode).toBe(200);
    expectContract(response, 'GET', '/api/v1/me/notifications');
    expect(response.json()).toEqual(settings);
    expect(service.get).toHaveBeenCalledWith(101);
  });

  it('answers 404 for a deleted account and 401 without a token', async () => {
    const { app: instance } = await start({
      get: () => Promise.reject(notFound('user_not_found', 'User not found')),
    });

    const missing = await instance.inject({
      method: 'GET',
      url: '/api/v1/me/notifications',
      headers: bearer('guest-token'),
    });
    expect(missing.statusCode).toBe(404);
    expectContract(missing, 'GET', '/api/v1/me/notifications');
    expect(missing.json()).toMatchObject({ code: 'user_not_found' });

    const anonymous = await instance.inject({ method: 'GET', url: '/api/v1/me/notifications' });
    expect(anonymous.statusCode).toBe(401);
    expectContract(anonymous, 'GET', '/api/v1/me/notifications');
  });
});

describe('PATCH /api/v1/me/notifications', () => {
  it('passes the kinds and the quiet hours to the service', async () => {
    const received: NotificationSettingsPatch[] = [];
    const { app: instance } = await start({
      update: (_userId, body) => {
        received.push(body);
        return Promise.resolve(settings);
      },
    });

    const response = await patch(instance, {
      quietHours: { from: '23:30', until: '07:00' },
      kinds: [{ kind: 'booking_reminder', enabled: false }],
    });

    expect(response.statusCode).toBe(200);
    expectContract(response, 'PATCH', '/api/v1/me/notifications');
    expect(received).toEqual([
      {
        quietHours: { from: '23:30', until: '07:00' },
        kinds: [{ kind: 'booking_reminder', enabled: false }],
      },
    ]);
  });

  it('turns the quiet hours off with null', async () => {
    const { app: instance, service } = await start({});

    const response = await patch(instance, { quietHours: null });

    expect(response.statusCode).toBe(200);
    expect(service.update).toHaveBeenCalledWith(101, { quietHours: null });
  });

  it.each([
    ['an empty body', {}],
    ['no kinds', { kinds: [] }],
    [
      'a repeated kind',
      {
        kinds: [
          { kind: 'booking_reminder', enabled: false },
          { kind: 'booking_reminder', enabled: true },
        ],
      },
    ],
    ['an unknown kind', { kinds: [{ kind: 'diary_spam', enabled: false }] }],
    ['a time off the 30 minute grid', { quietHours: { from: '22:15', until: '09:00' } }],
    ['equal from and until', { quietHours: { from: '22:00', until: '22:00' } }],
    ['a broken time', { quietHours: { from: '24:00', until: '09:00' } }],
    [
      'more than 20 kinds',
      { kinds: Array.from({ length: 21 }, () => ({ kind: 'booking_reminder', enabled: false })) },
    ],
  ])('rejects %s with 400', async (_case, body) => {
    const { app: instance, service } = await start({});

    const response = await patch(instance, body);

    expect(response.statusCode).toBe(400);
    expectContract(response, 'PATCH', '/api/v1/me/notifications');
    expect(response.json()).toMatchObject({ code: 'validation_failed' });
    expect(service.update).not.toHaveBeenCalled();
  });

  it('answers 422 notification_not_editable when the service refuses the kind', async () => {
    const { app: instance } = await start({
      update: () => Promise.reject(unprocessable('notification_not_editable', 'Not editable')),
    });

    const response = await patch(instance, { kinds: [{ kind: 'menu_import_done', enabled: false }] });

    expect(response.statusCode).toBe(422);
    expectContract(response, 'PATCH', '/api/v1/me/notifications');
    expect(response.json()).toMatchObject({ code: 'notification_not_editable' });
  });

  it('answers 404 for a deleted account', async () => {
    const { app: instance } = await start({
      update: () => Promise.reject(notFound('user_not_found', 'User not found')),
    });

    const response = await patch(instance, { quietHours: null });

    expect(response.statusCode).toBe(404);
    expectContract(response, 'PATCH', '/api/v1/me/notifications');
  });
});
