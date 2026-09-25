import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Services } from '../../services/index.ts';
import { authRoutes } from './auth.ts';
import { meRoutes } from './me.ts';

export const apiRoutes: FastifyPluginAsyncZod<{ services: Services }> = async (app, { services }) => {
  await app.register(authRoutes, { auth: services.auth });
  await app.register(meRoutes, { users: services.users });
};
