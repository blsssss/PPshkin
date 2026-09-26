import { z } from 'zod';
import { configSchema } from '../config.ts';
import { MAX_UPDATE_TYPES } from '../integrations/max/updates.ts';
import { missingUpdateTypes } from '../integrations/max/webhook-guard.ts';
import {
  describeError,
  errorCodes,
  smokeCheck,
  SmokeFailure,
  type SmokeCheck,
  type SmokeContext,
} from './check.ts';
import { requireVerifiedTls, withoutTrailingSlash } from './http.ts';

const WEBHOOK_PATH = '/max/webhook';
const MISSING_ISSUER = 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY';
const CERTIFICATE_HINT =
  'the certificate of the Ministry of Digital Development is not trusted: set NODE_EXTRA_CA_CERTS to backend/certs/russian_trusted_root_ca.pem';

const maxSettings = z.object({ MAX_API_BASE_URL: configSchema.shape.MAX_API_BASE_URL });

async function askMax<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    const details = describeError(error);
    throw new SmokeFailure(
      errorCodes(error).includes(MISSING_ISSUER) ? `${details}; ${CERTIFICATE_HINT}` : details,
    );
  }
}

export function maxChecks({ env, deps }: SmokeContext): SmokeCheck[] {
  const client = (token: string) => {
    const { MAX_API_BASE_URL: baseUrl } = maxSettings.parse(env);
    return { baseUrl, api: deps.createMaxApi({ token, baseUrl, fetch: deps.fetch }) };
  };

  return [
    smokeCheck('max.me', ['MAX_BOT_TOKEN', 'MAX_BOT_USERNAME'], async (token, username) => {
      const { baseUrl, api } = client(token);
      requireVerifiedTls(baseUrl, 'MAX_API_BASE_URL', env);
      const bot = await askMax(() => api.getMe());
      if (bot.username !== username) {
        throw new SmokeFailure(`username is ${bot.username}, MAX_BOT_USERNAME is ${username}`);
      }
      return `username ${bot.username}, answered over TLS by ${new URL(baseUrl).host}`;
    }),

    smokeCheck('max.webhook', ['MAX_BOT_TOKEN', 'PUBLIC_BASE_URL'], async (token, publicBaseUrl) => {
      const url = `${withoutTrailingSlash(publicBaseUrl)}${WEBHOOK_PATH}`;
      const { api } = client(token);
      const subscriptions = await askMax(() => api.listSubscriptions());
      const current = subscriptions.find((subscription) => subscription.url === url);
      if (!current) {
        throw new SmokeFailure(`no subscription for ${url} among ${subscriptions.length} subscriptions`);
      }
      const missing = missingUpdateTypes(current, MAX_UPDATE_TYPES);
      if (missing.length > 0) {
        throw new SmokeFailure(`the subscription for ${url} lacks ${missing.join(', ')}`);
      }
      return `${url} receives ${MAX_UPDATE_TYPES.join(', ')}`;
    }),
  ];
}
