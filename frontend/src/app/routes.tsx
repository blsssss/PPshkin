import { Navigate, type RouteObject } from 'react-router';
import { DealsScreen, VenuesScreen } from '../features/eat/CatalogScreens.tsx';
import { EatScreen } from '../features/eat/EatScreen.tsx';
import { VenueScreen } from '../features/eat/VenueScreen.tsx';
import { DiaryScreen } from '../features/diary/DiaryScreen.tsx';
import { InsightsScreen } from '../features/diary/InsightsScreen.tsx';
import { EditMealScreen, NewMealScreen } from '../features/diary/MealFormScreen.tsx';
import { ConsentStep } from '../features/onboarding/ConsentStep.tsx';
import { DoneStep } from '../features/onboarding/DoneStep.tsx';
import { GoalStep } from '../features/onboarding/GoalStep.tsx';
import { LocationStep } from '../features/onboarding/LocationStep.tsx';
import { OffersStep } from '../features/onboarding/OffersStep.tsx';
import { WelcomeStep } from '../features/onboarding/WelcomeStep.tsx';
import { BookingScreen, BookingsScreen, NewBookingScreen } from '../features/bookings/BookingScreens.tsx';
import { ProfileScreen } from '../features/profile/ProfileScreen.tsx';
import { VenueHomeScreen, VenueLinkScreen, VenueSettingsScreen } from '../features/venue/CabinetScreens.tsx';
import { EditDealScreen, NewDealScreen, VenueDealsScreen } from '../features/venue/DealScreens.tsx';
import { ImportReviewScreen, ImportStartScreen } from '../features/venue/ImportScreens.tsx';
import { AnalyticsScreen, RedeemScreen, VenueBookingsScreen } from '../features/venue/OpsScreens.tsx';
import { EditItemScreen, MenuScreen, NewItemScreen } from '../features/venue/MenuScreens.tsx';
import {
  ConsentTextScreen,
  DeleteAccountScreen,
  TagsScreen,
  TargetScreen,
} from '../features/profile/ProfileSubScreens.tsx';
import { AppShell } from './AppShell.tsx';
import { RouteErrorScreen } from './screens/RouteErrorScreen.tsx';
import { NotFoundScreen } from './screens/NotFoundScreen.tsx';
import { StartRedirect } from './StartRedirect.tsx';

export const appRoutes: RouteObject[] = [
  {
    element: <AppShell />,
    errorElement: <RouteErrorScreen />,
    children: [
      { index: true, element: <StartRedirect /> },
      { path: 'onboarding', element: <WelcomeStep /> },
      { path: 'onboarding/consent', element: <ConsentStep /> },
      { path: 'onboarding/offers', element: <OffersStep /> },
      { path: 'onboarding/goal', element: <GoalStep /> },
      { path: 'onboarding/location', element: <LocationStep /> },
      { path: 'onboarding/done', element: <DoneStep /> },
      { path: 'onboarding/*', element: <Navigate to="/onboarding" replace /> },
      { path: 'diary', element: <DiaryScreen /> },
      { path: 'diary/meals/new', element: <NewMealScreen /> },
      { path: 'diary/meals/:id', element: <EditMealScreen /> },
      { path: 'diary/:date', element: <DiaryScreen /> },
      { path: 'insights', element: <InsightsScreen /> },
      { path: 'eat', element: <EatScreen /> },
      { path: 'deals', element: <DealsScreen /> },
      { path: 'venues', element: <VenuesScreen /> },
      { path: 'venues/:id', element: <VenueScreen /> },
      { path: 'bookings', element: <BookingsScreen /> },
      { path: 'bookings/new', element: <NewBookingScreen /> },
      { path: 'bookings/:id', element: <BookingScreen /> },
      { path: 'venue', element: <VenueHomeScreen /> },
      { path: 'venue/settings', element: <VenueSettingsScreen /> },
      { path: 'venue/link', element: <VenueLinkScreen /> },
      { path: 'venue/menu', element: <MenuScreen /> },
      { path: 'venue/menu/new', element: <NewItemScreen /> },
      { path: 'venue/menu/import', element: <ImportStartScreen /> },
      { path: 'venue/menu/import/:importId', element: <ImportReviewScreen /> },
      { path: 'venue/menu/:itemId', element: <EditItemScreen /> },
      { path: 'venue/deals', element: <VenueDealsScreen /> },
      { path: 'venue/deals/new', element: <NewDealScreen /> },
      { path: 'venue/deals/:dealId', element: <EditDealScreen /> },
      { path: 'venue/bookings', element: <VenueBookingsScreen /> },
      { path: 'venue/redeem', element: <RedeemScreen /> },
      { path: 'venue/analytics', element: <AnalyticsScreen /> },
      { path: 'venue/*', element: <Navigate to="/venue" replace /> },
      { path: 'profile', element: <ProfileScreen /> },
      { path: 'profile/target', element: <TargetScreen /> },
      { path: 'profile/tags', element: <TagsScreen /> },
      { path: 'profile/consents/:kind', element: <ConsentTextScreen /> },
      { path: 'profile/delete', element: <DeleteAccountScreen /> },
      { path: 'profile/*', element: <Navigate to="/profile" replace /> },
      { path: '*', element: <NotFoundScreen /> },
    ],
  },
];
