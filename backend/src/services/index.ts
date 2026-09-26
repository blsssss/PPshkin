import type { AccountService } from './account.ts';
import type { AnalyticsService } from './analytics.ts';
import type { AuthService } from './auth.ts';
import type { BookingsService } from './bookings.ts';
import type { CatalogService } from './catalog.ts';
import type { ConsentsService } from './consents.ts';
import type { DealsService } from './deals.ts';
import type { DemoService } from './demo.ts';
import type { DiaryService } from './diary.ts';
import type { HealthService } from './health.ts';
import type { InsightsService } from './insights.ts';
import type { MenuImportsService } from './menu-imports.ts';
import type { MenuService } from './menu.ts';
import type { ProfileService } from './profile.ts';
import type { RecommendationsService } from './recommendations.ts';
import type { VenuesService } from './venues.ts';

export interface Services {
  health: HealthService;
  auth: AuthService;
  profile: ProfileService;
  consents: ConsentsService;
  diary: DiaryService;
  account: AccountService;
  venues: VenuesService;
  menu: MenuService;
  menuImports: MenuImportsService;
  deals: DealsService;
  catalog: CatalogService;
  recommendations: RecommendationsService;
  insights: InsightsService;
  bookings: BookingsService;
  analytics: AnalyticsService;
  demo: DemoService;
}
