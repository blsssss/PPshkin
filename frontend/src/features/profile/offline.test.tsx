import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderApp } from '../../../test/app.tsx';
import { json, TEST_USER } from '../../../test/http.ts';

vi.mock('../../api/index.ts', async () => (await import('../../../test/apiModule.ts')).apiModule);
const { server, startSession } = await import('../../../test/apiModule.ts');

function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value });
  window.dispatchEvent(new Event(value ? 'online' : 'offline'));
}

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
});
