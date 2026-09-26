import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { fakeWebApp } from '../../test/webapp.ts';
import { useTrackAppHistory } from './appHistory.ts';
import { BottomSheet } from './ui/BottomSheet.tsx';
import { useBackNavigation } from './useBackNavigation.ts';

function Detail() {
  const back = useBackNavigation('/list');
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={back}>
        Назад
      </button>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
      >
        Открыть
      </button>
      <BottomSheet
        open={open}
        title="Панель"
        onClose={() => {
          setOpen(false);
        }}
      >
        <p>Содержимое</p>
      </BottomSheet>
    </>
  );
}

function Tracked() {
  useTrackAppHistory();
  return <Outlet />;
}

function renderAt(entries: string[]) {
  const router = createMemoryRouter(
    [
      {
        element: <Tracked />,
        children: [
          { path: '/list', element: <p>Список</p> },
          { path: '/home', element: <p>Главная</p> },
          { path: '/list/:id', element: <Detail /> },
        ],
      },
    ],
    { initialEntries: entries, initialIndex: entries.length - 1 },
  );
  const view = render(<RouterProvider router={router} />);
  return { router, ...view };
}

describe('useBackNavigation', () => {
  it('closes an open sheet first', () => {
    const { router } = renderAt(['/list/5']);
    fireEvent.click(screen.getByRole('button', { name: 'Открыть' }));
    expect(screen.getByRole('dialog', { name: 'Панель' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(router.state.location.pathname).toBe('/list/5');
  });

  it('goes to the logical parent when opened by a link', async () => {
    const { router } = renderAt(['/list/5']);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
      await Promise.resolve();
    });
    expect(router.state.location.pathname).toBe('/list');
  });

  it('steps back in the app history when there is one', async () => {
    const { router } = renderAt(['/home']);
    await act(async () => {
      await router.navigate('/list/5');
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
      await Promise.resolve();
    });
    expect(router.state.location.pathname).toBe('/home');
  });

  it('drives the MAX back button and lets it go on unmount', async () => {
    const webApp = fakeWebApp({ platform: 'android' });
    const { router, unmount } = renderAt(['/list/5']);
    expect(webApp.BackButton.show).toHaveBeenCalled();
    const handler = webApp.BackButton.onClick.mock.calls[0]?.[0] as (() => void) | undefined;
    await act(async () => {
      handler?.();
      await Promise.resolve();
    });
    expect(router.state.location.pathname).toBe('/list');
    unmount();
    expect(webApp.BackButton.offClick).toHaveBeenCalled();
  });
});
