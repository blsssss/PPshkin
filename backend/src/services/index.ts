import type { AuthService } from './auth.ts';
import type { HealthService } from './health.ts';
import type { UsersService } from './users.ts';

export interface Services {
  health: HealthService;
  auth: AuthService;
  users: UsersService;
}
