import type { RouteObject } from 'react-router';
import { AppShell } from './AppShell.tsx';
import { RouteErrorScreen } from './screens/RouteErrorScreen.tsx';
import { NotFoundScreen, StubScreen } from './screens/StubScreen.tsx';
import { StartRedirect } from './StartRedirect.tsx';

export const appRoutes: RouteObject[] = [
  {
    element: <AppShell />,
    errorElement: <RouteErrorScreen />,
    children: [
      { index: true, element: <StartRedirect /> },
      { path: 'onboarding/*', element: <StubScreen title="Знакомство" /> },
      { path: 'diary', element: <StubScreen title="Дневник" /> },
      { path: 'diary/meals/:id', element: <StubScreen title="Запись" back="/diary" /> },
      { path: 'diary/:date', element: <StubScreen title="Дневник" back="/diary" /> },
      { path: 'insights', element: <StubScreen title="Неделя" back="/diary" /> },
      { path: 'eat', element: <StubScreen title="Что поесть" /> },
      { path: 'deals', element: <StubScreen title="Горящее" back="/eat" /> },
      { path: 'venues', element: <StubScreen title="Заведения" back="/eat" /> },
      { path: 'venues/:id', element: <StubScreen title="Заведение" back="/eat" /> },
      { path: 'bookings', element: <StubScreen title="Брони" /> },
      { path: 'bookings/new', element: <StubScreen title="Бронь" back="/bookings" /> },
      { path: 'bookings/:id', element: <StubScreen title="Бронь" back="/bookings" /> },
      { path: 'venue/*', element: <StubScreen title="Моё заведение" /> },
      { path: 'profile/*', element: <StubScreen title="Профиль" /> },
      { path: '*', element: <NotFoundScreen /> },
    ],
  },
];
