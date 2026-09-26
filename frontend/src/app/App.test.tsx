import { act, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, NETWORK_ERROR } from '../api/errors.ts';
import { emitApiError } from '../api/events.ts';
import type { SessionState } from '../api/session.ts';
import { TEST_USER } from '../../test/http.ts';
import { fakeWebApp } from '../../test/webapp.ts';
import { QueryClientProvider } from '@tanstack/react-query';
import { testQueryClient } from '../../test/app.tsx';
import { ToastProvider } from '../shared/ui/Toast.tsx';

const fake = vi.hoisted(() => {
  let state: SessionState = { status: 'loading' };
  let startParam: string | null = null;
  const listeners = new Set<() => void>();
  return {
    set(next: SessionState, param: string | null = null) {
      state = next;
      startParam = param;
      for (const listener of listeners) listener();
    },
    session: {
      getState: () => state,
      subscribe(listener: () => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      start: vi.fn(() => Promise.resolve()),
      pendingStartParam: () => startParam,
      markDeleted: vi.fn(),
      markStartHandled() {
        if (startParam === null) return false;
        startParam = null;
        return true;
      },
    },
  };
});

vi.mock('../api/index.ts', async () => {
  const react = await import('react');
  return {
    session: fake.session,
    useSessionState: () =>
      react.useSyncExternalStore(
        (listener) => fake.session.subscribe(listener),
        () => fake.session.getState(),
      ),
  };
});

const { App } = await import('./App.tsx');

function renderApp() {
  return render(
    <QueryClientProvider client={testQueryClient()}>
      <App />
    </QueryClientProvider>,
  );
}
const { Root } = await import('./Root.tsx');
const { appRoutes } = await import('./routes.tsx');

function renderAt(path: string) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={testQueryClient()}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return router;
}

beforeEach(() => {
  fake.set({ status: 'ready', user: TEST_USER, startParam: null });
  fake.session.start.mockClear();
});

describe('session screens', () => {
  it('shows a loading screen while signing in', () => {
    fake.set({ status: 'loading' });
    renderApp();
    expect(screen.getByText('Входим через MAX')).toBeTruthy();
  });

  it('asks to open the app in MAX outside the messenger', () => {
    fake.set({ status: 'outside' });
    renderApp();
    expect(screen.getByText('Откройте ППшкин в MAX')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Открыть бота в MAX' }).getAttribute('href')).toMatch(
      /^https:\/\/max\.ru\//,
    );
  });

  it('offers to close an expired session only when MAX can close the app', () => {
    fake.set({ status: 'expired' });
    const { unmount } = renderApp();
    expect(screen.getByText('Сессия устарела')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Закрыть' })).toBeNull();
    unmount();

    const webApp = fakeWebApp();
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(webApp.close).toHaveBeenCalled();
  });

  it('retries sign in without reloading the page', () => {
    fake.set({ status: 'failed', error: new ApiError({ status: 0, code: NETWORK_ERROR }) });
    renderApp();
    expect(screen.getByText('Нет соединения с сервером')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(fake.session.start).toHaveBeenCalledTimes(1);
  });

  it('forgets the account when the API says it is gone', () => {
    renderApp();
    act(() => {
      emitApiError(new ApiError({ status: 404, code: 'user_not_found' }));
    });
    expect(fake.session.markDeleted).toHaveBeenCalled();
  });

  it('offers a fresh start after the account is deleted', () => {
    fake.set({ status: 'deleted' });
    renderApp();
    expect(screen.getByText('Аккаунт удалён, данные стёрты')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Начать заново' }));
    expect(fake.session.start).toHaveBeenCalled();
  });

  it('explains a bad signature', () => {
    fake.set({ status: 'failed', error: new ApiError({ status: 401, code: 'init_data_bad_signature' }) });
    renderApp();
    expect(screen.getByText('Не удалось войти через MAX')).toBeTruthy();
  });
});

describe('navigation', () => {
  it('opens the diary by default with the tab bar', async () => {
    const router = renderAt('/');
    expect(await screen.findByRole('heading', { name: 'Дневник' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/diary');
    const nav = screen.getByRole('navigation', { name: 'Разделы' });
    expect(nav.querySelectorAll('a')).toHaveLength(5);
    expect(screen.getByRole('link', { name: 'Моё заведение' }).getAttribute('href')).toBe('/venue');
  });

  it('never leaves a dead end in a stub', async () => {
    const router = renderAt('/bookings');
    fireEvent.click(await screen.findByRole('button', { name: 'На главную' }));
    expect(router.state.location.pathname).toBe('/diary');
  });

  it('hides the tab bar during onboarding and on the full screen QR', async () => {
    renderAt('/onboarding/done');
    await screen.findByRole('heading', { name: 'Готово' });
    expect(screen.queryByRole('navigation', { name: 'Разделы' })).toBeNull();
  });

  it('hides the tab bar on the booking QR view', async () => {
    renderAt('/bookings/5?view=qr');
    await screen.findByRole('heading', { name: 'Бронь' });
    expect(screen.queryByRole('navigation', { name: 'Разделы' })).toBeNull();
  });

  it('highlights the section tab on nested screens', async () => {
    renderAt('/deals?highlight=3');
    await screen.findByRole('heading', { name: 'Горящее рядом' });
    expect(screen.getByRole('link', { name: 'Что поесть' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Моё заведение' }).getAttribute('aria-current')).toBeNull();
  });

  it('shows a way home for unknown paths', async () => {
    renderAt('/nowhere');
    expect(await screen.findByText('Такой страницы нет')).toBeTruthy();
  });

  it('shows a header back button on desktop, web and outside MAX', async () => {
    fakeWebApp({ platform: 'web' });
    const router = renderAt('/venues/3');
    fireEvent.click(await screen.findByRole('button', { name: 'Назад' }));
    expect(router.state.location.pathname).toBe('/eat');
  });

  it('relies on the system back button on phones', async () => {
    const webApp = fakeWebApp({ platform: 'android' });
    const router = renderAt('/venues/3');
    await screen.findByRole('heading', { name: 'Заведение' });
    expect(screen.queryByRole('button', { name: 'Назад' })).toBeNull();
    const handler = webApp.BackButton.onClick.mock.calls.at(-1)?.[0] as () => void;
    act(() => {
      handler();
    });
    expect(router.state.location.pathname).toBe('/eat');
  });
});

describe('render errors', () => {
  it('shows a restart screen instead of the router default', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    function Broken(): never {
      throw new Error('boom');
    }
    const router = createMemoryRouter(
      [{ path: '/', element: <Broken />, errorElement: appRoutes[0]?.errorElement }],
      { initialEntries: ['/'] },
    );
    render(
      <QueryClientProvider client={testQueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('Что-то пошло не так')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'На главную' }));
    expect(router.state.location.pathname).toBe('/diary');
  });
});

describe('startParam', () => {
  it('opens the screen from a startapp link once', async () => {
    fake.set({ status: 'ready', user: TEST_USER, startParam: 'venue_1' }, 'venue_1');
    const router = renderAt('/');
    await screen.findByRole('heading', { name: 'Заведение' });
    expect(router.state.location.pathname).toBe('/venues/1');
  });

  it('keeps the startapp target under StrictMode double effects', async () => {
    fake.set({ status: 'ready', user: TEST_USER, startParam: 'venue_1' }, 'venue_1');
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/'] });
    render(
      <StrictMode>
        <QueryClientProvider client={testQueryClient()}>
          <ToastProvider>
            <RouterProvider router={router} />
          </ToastProvider>
        </QueryClientProvider>
      </StrictMode>,
    );
    await screen.findByRole('heading', { name: 'Заведение' });
    expect(router.state.location.pathname).toBe('/venues/1');
  });

  it('goes to the diary on later visits to the root', async () => {
    fake.set({ status: 'ready', user: TEST_USER, startParam: 'venue_1' }, 'venue_1');
    const router = renderAt('/');
    await screen.findByRole('heading', { name: 'Заведение' });
    await act(async () => {
      await router.navigate('/');
    });
    expect(router.state.location.pathname).toBe('/diary');
  });

  it('opens the deal list with a highlight', async () => {
    fake.set({ status: 'ready', user: TEST_USER, startParam: 'deal_9' }, 'deal_9');
    const router = renderAt('/');
    await screen.findByRole('heading', { name: 'Горящее рядом' });
    expect(router.state.location.search).toBe('?highlight=9');
  });

  it('falls back to the diary with a toast for unknown links', async () => {
    fake.set({ status: 'ready', user: TEST_USER, startParam: 'mystery' }, 'mystery');
    renderAt('/');
    expect(await screen.findByText('Ссылка не распознана')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Дневник' })).toBeTruthy();
  });
});

describe('Root', () => {
  it('passes the MAX platform to MAX UI', () => {
    fakeWebApp({ platform: 'ios' });
    const { container, unmount } = render(
      <Root>
        <span />
      </Root>,
    );
    expect(container.firstElementChild?.className).toContain('MaxUI_platform_ios');
    unmount();
    fakeWebApp({ platform: 'web' });
    const next = render(
      <Root>
        <span />
      </Root>,
    );
    expect(next.container.firstElementChild?.className).toContain('MaxUI_platform_android');
  });

  it('tells MAX the app is ready', () => {
    const webApp = fakeWebApp();
    render(
      <Root>
        <span />
      </Root>,
    );
    expect(webApp.ready).toHaveBeenCalled();
  });
});
