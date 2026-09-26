import type { AccountService } from './account.ts';
import type { AuthService } from './auth.ts';
import type { ConsentsService } from './consents.ts';
import type { DiaryService } from './diary.ts';
import type { HealthService } from './health.ts';
import type { ProfileService } from './profile.ts';

export interface Services {
  health: HealthService;
  auth: AuthService;
  profile: ProfileService;
  consents: ConsentsService;
  diary: DiaryService;
  account: AccountService;
}
