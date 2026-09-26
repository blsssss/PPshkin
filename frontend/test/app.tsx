import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { ToastProvider } from '../src/shared/ui/Toast.tsx';

export function testQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, refetchOnReconnect: 'always', staleTime: 30_000 },
      mutations: { retry: false },
    },
  });
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
