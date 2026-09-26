import { useEffect, useState } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { isApiError } from '../api/errors.ts';
import { onApiError } from '../api/events.ts';
import { session, useSessionState } from '../api/index.ts';
import { useForgetAccount } from './forgetAccount.ts';
import { appRoutes } from './routes.tsx';
import {
  AccountDeletedScreen,
  OpenInMaxScreen,
  SessionExpiredScreen,
  SignInFailedScreen,
  SplashScreen,
} from './screens/AuthScreens.tsx';

export function App() {
  const state = useSessionState();
  const [router] = useState(() => createBrowserRouter(appRoutes));
  const forget = useForgetAccount();

  useEffect(
    () =>
      onApiError((error) => {
        if (isApiError(error, 'user_not_found')) forget();
      }),
    [forget],
  );

  switch (state.status) {
    case 'loading':
      return <SplashScreen />;
    case 'outside':
      return <OpenInMaxScreen />;
    case 'expired':
      return <SessionExpiredScreen />;
    case 'deleted':
      return (
        <AccountDeletedScreen
          onRestart={() => {
            void session.start();
          }}
        />
      );
    case 'failed':
      return (
        <SignInFailedScreen
          error={state.error}
          onRetry={() => {
            void session.start();
          }}
        />
      );
    case 'ready':
      return <RouterProvider router={router} />;
  }
}
