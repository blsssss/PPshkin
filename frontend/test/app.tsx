import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { createQueryClient } from '../src/app/Root.tsx';
import { ToastProvider } from '../src/shared/ui/Toast.tsx';

export const testQueryClient = createQueryClient;

export function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value });
  window.dispatchEvent(new Event(value ? 'online' : 'offline'));
}

export async function renderApp(
  path: string,
  options: { wrapper?: ComponentType<{ children: ReactNode }> } = {},
) {
  const { appRoutes } = await import('../src/app/routes.tsx');
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  const queryClient = testQueryClient();
  const view = render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>,
    { wrapper: options.wrapper },
  );
  return { router, queryClient, ...view };
}
