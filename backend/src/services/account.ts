import { withTransaction, type Pool } from '../db/pool.ts';
import * as account from '../repositories/account.ts';
import * as bookings from '../repositories/bookings.ts';
import * as users from '../repositories/users.ts';
import type { Clock } from '../shared/clock.ts';
import { forbidden } from '../shared/errors.ts';

export interface AccountService {
  deleteAccount(userId: number): Promise<void>;
}

export interface AccountDependencies {
  pool: Pool;
  clock: Clock;
}

const isDemoAccount = (userId: number) => userId < 0;

export function createAccountService({ pool, clock }: AccountDependencies): AccountService {
  return {
    async deleteAccount(userId) {
      if (isDemoAccount(userId)) {
        throw forbidden('demo_account_protected', 'Demo accounts are shared and cannot be deleted');
      }
      await withTransaction(pool, async (client) => {
        await users.lock(client, userId);
        await bookings.cancelActiveForUser(client, userId, clock.now());
        await account.eraseOfferExplanations(client, userId);
        await users.remove(client, userId);
      });
    },
  };
}
