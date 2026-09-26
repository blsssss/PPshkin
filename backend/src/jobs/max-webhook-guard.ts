import type { WebhookGuard } from '../integrations/max/webhook-guard.ts';
import type { Job } from './scheduler.ts';

export function maxWebhookGuardJob(guard: WebhookGuard): Job {
  return {
    name: 'max_webhook_guard',
    schedule: { everyMs: 10 * 60_000 },
    run: async () => {
      await guard.check();
    },
  };
}
