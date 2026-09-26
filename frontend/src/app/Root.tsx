import { MaxUI } from '@maxhub/max-ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { platform, ready } from '../max/bridge.ts';
import { ErrorBoundary } from '../shared/ui/ErrorBoundary.tsx';
import { PortalRoot } from '../shared/ui/PortalRoot.tsx';
import { ToastProvider } from '../shared/ui/Toast.tsx';

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, refetchOnReconnect: 'always', staleTime: 30_000 },
      mutations: { retry: false },
    },
  });
}

export function Root({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);

  useEffect(() => {
    ready();
  }, []);

  return (
    <MaxUI platform={platform() === 'ios' ? 'ios' : 'android'} className="ppsh-app" resetBody>
      <PortalRoot>
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <ErrorBoundary>{children}</ErrorBoundary>
          </ToastProvider>
        </QueryClientProvider>
      </PortalRoot>
    </MaxUI>
  );
}
