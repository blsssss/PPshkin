import { useEffect } from 'react';
import { Outlet, useLocation, useNavigate, useSearchParams } from 'react-router';
import { session } from '../api/index.ts';
import { OfflineBanner } from '../shared/ui/OfflineBanner.tsx';
import { useToast } from '../shared/ui/Toast.tsx';
import { TabBar } from './TabBar.tsx';
import { resolveStartParam } from './startParam.ts';

export function useStartParamRedirect(): void {
  const navigate = useNavigate();
  const toast = useToast();

  useEffect(() => {
    const value = session.takeStartParam();
    if (value === null) return;
    const target = resolveStartParam(value);
    void navigate(target.path, { replace: true });
    if (!target.recognized) toast.show('Ссылка не распознана');
  }, [navigate, toast]);
}

export function tabBarHidden(pathname: string, view: string | null): boolean {
  return pathname === '/onboarding' || pathname.startsWith('/onboarding/') || view === 'qr';
}

export function AppShell() {
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  useStartParamRedirect();
  const hideTabs = tabBarHidden(pathname, params.get('view'));

  return (
    <>
      <OfflineBanner />
      <Outlet />
      {!hideTabs && <TabBar />}
    </>
  );
}
