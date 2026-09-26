import { useState } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { session, useSessionState } from '../api/index.ts';
import { appRoutes } from './routes.tsx';
import {
  OpenInMaxScreen,
  SessionExpiredScreen,
  SignInFailedScreen,
  SplashScreen,
} from './screens/AuthScreens.tsx';

export function App() {
  const state = useSessionState();
  const [router] = useState(() => createBrowserRouter(appRoutes));

  switch (state.status) {
    case 'loading':
      return <SplashScreen />;
    case 'outside':
      return <OpenInMaxScreen />;
    case 'expired':
      return <SessionExpiredScreen />;
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
