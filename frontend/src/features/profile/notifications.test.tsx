import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderApp, setOnline } from '../../../test/app.tsx';
import { json, problem, TEST_USER } from '../../../test/http.ts';
import type { NotificationKind, NotificationSettings } from './notificationsModel.ts';

vi.mock('../../api/index.ts', async () => (await import('../../../test/apiModule.ts')).apiModule);
const { server, startSession } = await import('../../../test/apiModule.ts');

const GUEST_KINDS: NotificationKind[] = [
  'booking_confirmed',
  'booking_reminder',
  'booking_redeemed',
  'booking_expired',
];
const VENUE_KINDS: NotificationKind[] = [
  'venue_booking_created',
  'venue_booking_cancelled',
  'venue_booking_expired',
  'venue_deal_sold_out',
  'venue_deal_ending',
  'menu_import_done',
  'venue_report_ready',
];

function settingsFor(withVenue: boolean): NotificationSettings {
  return {
    timezone: 'Europe/Moscow',
    quietHours: { from: '22:00', until: '09:00' },
    kinds: [
      ...GUEST_KINDS.map((kind) => ({ kind, audience: 'guest' as const, enabled: true, editable: true })),
      ...(withVenue
        ? VENUE_KINDS.map((kind) => ({
            kind,
            audience: 'venue' as const,
            enabled: true,
            editable: kind !== 'menu_import_done',
          }))
        : []),
    ],
  };
}

const VENUE = {
  id: 7,
  name: 'Кофейня «Зерно»',
  address: 'ул. Баумана, 36',
  category: 'coffee',
  location: { lat: 55.7887, lon: 49.1221 },
  opensAt: '08:00',
  closesAt: '22:00',
  timezone: 'Europe/Moscow',
  isDemo: false,
  createdAt: '2026-09-20T10:00:00.000Z',
};

let settings: NotificationSettings;

async function start({ withVenue = false } = {}) {
  settings = settingsFor(withVenue);
  await startSession();
  server.on('GET', '/api/v1/me', () => json(TEST_USER));
  server.on('GET', '/api/v1/consents', () => json({ items: [] }));
  server.on('GET', '/api/v1/bookings', () => json({ items: [] }));
  server.on('GET', '/api/v1/venue', () => (withVenue ? json(VENUE) : problem(404, 'venue_not_found')));
  server.on('GET', '/api/v1/me/notifications', () => json(settings));
  server.on('PATCH', '/api/v1/me/notifications', (call) => {
    const body = call.body as {
      kinds?: { kind: NotificationKind; enabled: boolean }[];
      quietHours?: NotificationSettings['quietHours'];
    };
    settings = {
      ...settings,
      ...(body.quietHours === undefined ? {} : { quietHours: body.quietHours }),
      kinds: settings.kinds.map((item) => {
        const change = body.kinds?.find((candidate) => candidate.kind === item.kind);
        return change ? { ...item, enabled: change.enabled } : item;
      }),
    };
    return json(settings);
  });
}

function switchFor(label: string): HTMLInputElement {
  const row = screen.getByText(label).closest('label');
  if (row === null) throw new Error(`No switch for ${label}`);
  return within(row).getByRole('switch');
}

afterEach(() => {
  setOnline(true);
  vi.useRealTimers();
});

describe('notifications screen', () => {
  it('shows the booking kinds to a guest without the venue section', async () => {
    await start();
    await renderApp('/profile/notifications');

    const bookings = await screen.findByRole('region', { name: 'Брони' });
    expect(within(bookings).getByText('Напоминание о брони')).toBeTruthy();
    expect(within(bookings).getByText('За 10 минут до конца брони')).toBeTruthy();
    expect(within(bookings).getAllByRole('switch')).toHaveLength(4);
    expect(screen.queryByRole('region', { name: 'Моё заведение' })).toBeNull();
    expect(
      screen.getByText(
        'С 22:00 до 09:00 сообщения о бронях приходят без звука, итоги дня после 09:00. Часовой пояс: Europe/Moscow',
      ),
    ).toBeTruthy();
  });

  it('shows the venue section to an owner with the menu import switch inactive', async () => {
    await start({ withVenue: true });
    await renderApp('/profile/notifications');

    const venue = await screen.findByRole('region', { name: 'Моё заведение' });
    expect(within(venue).getAllByRole('switch')).toHaveLength(7);
    expect(switchFor('Разбор меню').disabled).toBe(true);
    expect(switchFor('Новая бронь').disabled).toBe(false);
  });

  it('saves a switch at once and keeps it inactive while the request runs', async () => {
    await start();
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = settings;
    server.on('PATCH', '/api/v1/me/notifications', async (call) => {
      await released;
      const [change] = (call.body as { kinds: { kind: NotificationKind; enabled: boolean }[] }).kinds;
      settings = {
        ...original,
        kinds: original.kinds.map((item) =>
          item.kind === change?.kind ? { ...item, enabled: change.enabled } : item,
        ),
      };
      return json(settings);
    });
    await renderApp('/profile/notifications');
    await screen.findByRole('region', { name: 'Брони' });

    fireEvent.click(switchFor('Напоминание о брони'));

    await waitFor(() => {
      expect(switchFor('Напоминание о брони').disabled).toBe(true);
    });
    expect(server.callsTo('PATCH', '/api/v1/me/notifications').map((call) => call.body)).toEqual([
      { kinds: [{ kind: 'booking_reminder', enabled: false }] },
    ]);
    release();
    await waitFor(() => {
      expect(switchFor('Напоминание о брони').disabled).toBe(false);
    });
    expect(switchFor('Напоминание о брони').checked).toBe(false);
  });

  it('returns the switch to its place and shows a toast when saving fails', async () => {
    await start();
    server.on('PATCH', '/api/v1/me/notifications', () => problem(422, 'notification_not_editable'));
    await renderApp('/profile/notifications');
    await screen.findByRole('region', { name: 'Брони' });

    fireEvent.click(switchFor('Бронь истекла'));

    expect(await screen.findByRole('status')).toBeTruthy();
    await waitFor(() => {
      expect(switchFor('Бронь истекла').checked).toBe(true);
    });
    expect(switchFor('Бронь истекла').disabled).toBe(false);
  });

  it('changes and switches off the quiet hours', async () => {
    await start();
    await renderApp('/profile/notifications');
    const quiet = await screen.findByRole('region', { name: 'Тихие часы' });

    fireEvent.change(within(quiet).getByLabelText('С'), { target: { value: '23:30' } });
    await waitFor(() => {
      expect(screen.getByText(/^С 23:30 до 09:00/)).toBeTruthy();
    });

    fireEvent.change(within(quiet).getByLabelText('До'), { target: { value: '23:30' } });
    expect(within(quiet).getByText('Начало и конец тихих часов должны отличаться')).toBeTruthy();

    fireEvent.click(switchFor('Не беспокоить ночью'));
    expect(await within(quiet).findByText('Сообщения приходят со звуком в любое время.')).toBeTruthy();
    expect(server.callsTo('PATCH', '/api/v1/me/notifications').map((call) => call.body)).toEqual([
      { quietHours: { from: '23:30', until: '09:00' } },
      { quietHours: null },
    ]);
  });

  it('disables the switches without network', async () => {
    await start();
    await renderApp('/profile/notifications');
    await screen.findByRole('region', { name: 'Брони' });

    act(() => {
      setOnline(false);
    });

    expect(
      screen.getByText('Нет соединения с интернетом, настройки можно поменять, когда сеть появится'),
    ).toBeTruthy();
    expect(switchFor('Бронь подтверждена').disabled).toBe(true);
    expect(switchFor('Не беспокоить ночью').disabled).toBe(true);
    act(() => {
      setOnline(true);
    });
    expect(switchFor('Бронь подтверждена').disabled).toBe(false);
  });

  it('offers a retry when the settings do not load', async () => {
    await start();
    server.on('GET', '/api/v1/me/notifications', () => problem(500, 'internal_error'));
    await renderApp('/profile/notifications');

    expect(
      await screen.findByText('Не удалось загрузить настройки уведомлений', {}, { timeout: 5000 }),
    ).toBeTruthy();
    server.on('GET', '/api/v1/me/notifications', () => json(settings));
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByRole('region', { name: 'Брони' })).toBeTruthy();
  });

  it('opens from the profile with a summary of the enabled kinds', async () => {
    await start();
    settings = {
      ...settings,
      kinds: settings.kinds.map((item) =>
        item.kind === 'booking_reminder' ? { ...item, enabled: false } : item,
      ),
    };
    const { router } = await renderApp('/profile');

    const section = await screen.findByRole('region', { name: 'Уведомления' });
    expect(await within(section).findByText('Включено 3 из 4')).toBeTruthy();
    expect(
      screen
        .getAllByRole('region')
        .map((region) => region.getAttribute('aria-label'))
        .indexOf('Уведомления'),
    ).toBeLessThan(
      screen
        .getAllByRole('region')
        .map((region) => region.getAttribute('aria-label'))
        .indexOf('Согласия'),
    );
    fireEvent.click(within(section).getByRole('link', { name: 'Настроить' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/profile/notifications');
    });
  });

  it('opens the screen from the startapp=notifications link', async () => {
    settings = settingsFor(false);
    await startSession({ startParam: 'notifications' });
    server.on('GET', '/api/v1/me', () => json(TEST_USER));
    server.on('GET', '/api/v1/bookings', () => json({ items: [] }));
    server.on('GET', '/api/v1/venue', () => problem(404, 'venue_not_found'));
    server.on('GET', '/api/v1/me/notifications', () => json(settings));
    const { router } = await renderApp('/');

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/profile/notifications');
    });
  });
});

describe('venue tab counter', () => {
  it('does not ask for venue bookings when the user has no venue', async () => {
    await start();
    await renderApp('/diary');
    await waitFor(() => {
      expect(server.callsTo('GET', '/api/v1/venue')).toHaveLength(1);
    });

    expect(server.callsTo('GET', '/api/v1/venue/bookings')).toEqual([]);
    expect(screen.getByRole('link', { name: 'Моё заведение' })).toBeTruthy();
  });

  it('shows the number of active bookings of the venue to its owner', async () => {
    await start({ withVenue: true });
    server.on('GET', '/api/v1/venue/bookings', () => json({ items: [{ id: 1 }, { id: 2 }] }));
    await renderApp('/diary');

    expect(await screen.findByRole('link', { name: 'Заведение, активных: 2' })).toBeTruthy();
    expect(server.callsTo('GET', '/api/v1/venue/bookings')[0]?.search).toBe('?status=active');
  });
});
