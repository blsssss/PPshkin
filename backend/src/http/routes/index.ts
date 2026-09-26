import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Services } from '../../services/index.ts';
import { authRoutes } from './auth.ts';
import { catalogRoutes } from './catalog.ts';
import { consentsRoutes } from './consents.ts';
import { diaryRoutes } from './diary.ts';
import { insightsRoutes } from './insights.ts';
import { meRoutes } from './me.ts';
import { recommendationsRoutes } from './recommendations.ts';
import { venueRoutes } from './venue.ts';

export const apiRoutes: FastifyPluginAsyncZod<{ services: Services }> = async (app, { services }) => {
  await app.register(authRoutes, { auth: services.auth, consents: services.consents });
  await app.register(meRoutes, { profile: services.profile, account: services.account });
  await app.register(consentsRoutes, { consents: services.consents });
  await app.register(diaryRoutes, { diary: services.diary });
  await app.register(venueRoutes, {
    venues: services.venues,
    menu: services.menu,
    menuImports: services.menuImports,
    deals: services.deals,
  });
  await app.register(catalogRoutes, { catalog: services.catalog });
  await app.register(recommendationsRoutes, { recommendations: services.recommendations });
  await app.register(insightsRoutes, { insights: services.insights });
};
