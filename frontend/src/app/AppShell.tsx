import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { Navigate, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router';
import type { UserProfile } from '../api/client.ts';
import { isApiError } from '../api/errors.ts';
import { onApiError } from '../api/events.ts';
import { CONSENTS_KEY, PROFILE_KEY, useProfile, useUpdateProfile } from '../api/profile.ts';
import { OfflineBanner } from '../shared/ui/OfflineBanner.tsx';
import { TabBar } from './TabBar.tsx';

function isOnboarding(pathname: string): boolean {
  return pathname === '/onboarding' || pathname.startsWith('/onboarding/');
}

function deviceTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

function useTimeZoneSync(profile: UserProfile | undefined): void {
  const update = useUpdateProfile();
  const synced = useRef(false);
  const granted = profile?.consents.personalData.granted === true;
  const current = profile?.timezone;

  useEffect(() => {
    if (!granted || synced.current || current === undefined) return;
    const device = deviceTimeZone();
    if (device === null || device === current) return;
    synced.current = true;
    update.mutate({ timezone: device }, { onError: () => undefined });
  }, [granted, current, update]);
}

function useConsentRequiredRedirect(): void {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  useEffect(() => {
    return onApiError((error) => {
      if (!isApiError(error, 'consent_required')) return;
      void Promise.resolve(navigate('/onboarding/consent', { replace: true })).then(() => {
        void queryClient.invalidateQueries({ queryKey: PROFILE_KEY });
        void queryClient.invalidateQueries({ queryKey: CONSENTS_KEY });
      });
    });
  }, [queryClient, navigate]);
}

export function AppShell() {
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const profile = useProfile().data;
  useTimeZoneSync(profile);
  useConsentRequiredRedirect();

  const onboarding = isOnboarding(pathname);
  const consentGiven = profile?.consents.personalData.granted === true;
  if (!consentGiven && !onboarding) return <Navigate to="/onboarding" replace />;

  const hideTabs = onboarding || params.get('view') === 'qr';

  return (
    <>
      <OfflineBanner />
      <Outlet />
      {!hideTabs && <TabBar />}
    </>
  );
}
