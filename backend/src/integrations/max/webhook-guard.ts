import type { MaxApi } from './api.ts';
import type { MaxSubscription } from './types.ts';
import type { MaxUpdateType } from './updates.ts';

export interface WebhookGuardOptions {
  api: Pick<MaxApi, 'listSubscriptions' | 'subscribe'>;
  url: string;
  secret: string;
  updateTypes: readonly MaxUpdateType[];
  logger: { warn(object: object, message: string): void };
}

export interface WebhookGuard {
  check(): Promise<'ok' | 'restored'>;
}

function coversAll(subscription: MaxSubscription, updateTypes: readonly MaxUpdateType[]): boolean {
  const subscribed = new Set(subscription.update_types ?? []);
  return updateTypes.every((type) => subscribed.has(type));
}

export function createWebhookGuard({
  api,
  url,
  secret,
  updateTypes,
  logger,
}: WebhookGuardOptions): WebhookGuard {
  return {
    async check() {
      const current = (await api.listSubscriptions()).find((subscription) => subscription.url === url);
      if (current && coversAll(current, updateTypes)) return 'ok';
      await api.subscribe(url, secret, updateTypes);
      logger.warn({ url }, 'webhook subscription restored');
      return 'restored';
    },
  };
}
