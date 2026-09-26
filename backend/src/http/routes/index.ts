import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Services } from '../../services/index.ts';
import { authRoutes } from './auth.ts';
import { consentsRoutes } from './consents.ts';
import { diaryRoutes } from './diary.ts';
import { meRoutes } from './me.ts';

export const apiRoutes: FastifyPluginAsyncZod<{ services: Services }> = async (app, { services }) => {
  await app.register(authRoutes, { auth: services.auth, consents: services.consents });
  await app.register(meRoutes, { profile: services.profile, account: services.account });
  await app.register(consentsRoutes, { consents: services.consents });
  await app.register(diaryRoutes, { diary: services.diary });
};
