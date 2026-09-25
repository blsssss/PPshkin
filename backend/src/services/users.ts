import type { Queryable } from '../db/pool.ts';
import type { User } from '../domain/models.ts';
import * as users from '../repositories/users.ts';
import { notFound } from '../shared/errors.ts';

export interface UsersService {
  get(userId: number): Promise<User>;
}

export function createUsersService(db: Queryable): UsersService {
  return {
    async get(userId) {
      const user = await users.findById(db, userId);
      if (!user) throw notFound('user_not_found', 'User not found');
      return user;
    },
  };
}
