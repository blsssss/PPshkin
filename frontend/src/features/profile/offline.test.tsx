import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderApp, setOnline } from '../../../test/app.tsx';
import { json, TEST_USER } from '../../../test/http.ts';

vi.mock('../../api/index.ts', async () => (await import('../../../test/apiModule.ts')).apiModule);
const { server, startSession } = await import('../../../test/apiModule.ts');

afterEach(() => {
  setOnline(true);
});

describe('offline', () => {
  it('keeps the form, blocks sending and reloads the screen when the network is back', async () => {
    await startSession();
    server.on('GET', '/api/v1/me', () => json(TEST_USER));
    await renderApp('/profile/tags');
    fireEvent.click(await screen.findByRole('button', { name: 'шоколад' }));
    act(() => {
      setOnline(false);
    });
    expect(screen.getByText('Нет соединения с интернетом, отправьте, когда сеть появится')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Сохранить' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'шоколад' }).getAttribute('aria-pressed')).toBe('true');

    const before = server.callsTo('GET', '/api/v1/me').length;
    act(() => {
      setOnline(true);
    });
    await waitFor(() => {
      expect(server.callsTo('GET', '/api/v1/me').length).toBeGreaterThan(before);
    });
    expect(screen.queryByText('Нет соединения с интернетом, отправьте, когда сеть появится')).toBeNull();
    expect(screen.getByRole('button', { name: 'шоколад' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('blocks the location buttons while offline', async () => {
    const user = {
      ...TEST_USER,
      location: { lat: 55.79, lon: 49.12 },
      locationUpdatedAt: new Date().toISOString(),
    };
    await startSession({ user });
    server.on('GET', '/api/v1/me', () => json(user));
    await renderApp('/profile');
    const location = await screen.findByRole('region', { name: 'Местоположение' });
    const refresh = within(location).getByRole('button', { name: 'Обновить' });
    const remove = within(location).getByRole('button', { name: 'Удалить' });
    act(() => {
      setOnline(false);
    });
    expect(refresh.hasAttribute('disabled')).toBe(true);
    expect(remove.hasAttribute('disabled')).toBe(true);

    act(() => {
      setOnline(true);
    });
    expect(refresh.hasAttribute('disabled')).toBe(false);
    expect(remove.hasAttribute('disabled')).toBe(false);
  });
});
