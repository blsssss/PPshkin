import { Outlet, useLocation, useSearchParams } from 'react-router';
import { OfflineBanner } from '../shared/ui/OfflineBanner.tsx';
import { TabBar } from './TabBar.tsx';

function tabBarHidden(pathname: string, view: string | null): boolean {
  return pathname === '/onboarding' || pathname.startsWith('/onboarding/') || view === 'qr';
}

export function AppShell() {
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const hideTabs = tabBarHidden(pathname, params.get('view'));

  return (
    <>
      <OfflineBanner />
      <Outlet />
      {!hideTabs && <TabBar />}
    </>
  );
}
