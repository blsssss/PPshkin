import type { Queryable } from '../db/pool.ts';
import { CONSENT_DOCUMENTS } from '../domain/consents.ts';
import type { BehaviorProfile } from '../domain/nutrition/profile.ts';
import type { MaxLogger } from '../integrations/max/poller.ts';
import { createDelivery } from '../notifications/delivery.ts';
import { proactiveOfferMessage } from '../notifications/texts.ts';
import type { Messenger } from '../ports/messenger.ts';
import {
  discardUnsentOffer,
  findProactiveCandidates,
  type ProactiveCandidate,
} from '../repositories/proactive.ts';
import type { InsightsService } from '../services/insights.ts';
import type { RecommendationsService } from '../services/recommendations.ts';
import { localParts } from '../shared/time.ts';
import type { Job } from './scheduler.ts';

interface ProactiveOffersDependencies {
  db: Queryable;
  insights: Pick<InsightsService, 'get'>;
  recommendations: Pick<RecommendationsService, 'recommend'>;
  messenger: () => Messenger | null;
  logger: MaxLogger;
}

const JOB_NAME = 'proactive_offers';
const PAGE_SIZE = 50;
const MIN_SCORE = 0.5;
const QUIET_FROM_HOUR = 22;
const QUIET_UNTIL_HOUR = 9;
const SWEET_TOOTH_MIN_SHARE = 0.4;
const SNACK_MIN_SHARE = 0.5;

const CURRENT_CONSENT_VERSIONS = {
  personal_data: CONSENT_DOCUMENTS.personal_data.version,
  personalized_offers: CONSENT_DOCUMENTS.personalized_offers.version,
};

function isQuietHour(hour: number): boolean {
  return hour >= QUIET_FROM_HOUR || hour < QUIET_UNTIL_HOUR;
}

function habitualHour({ sweetTooth, slots }: BehaviorProfile): number | null {
  if (sweetTooth.share >= SWEET_TOOTH_MIN_SHARE && sweetTooth.typicalHour !== null) {
    return sweetTooth.typicalHour;
  }
  if (slots.snack.share >= SNACK_MIN_SHARE && slots.snack.typicalHour !== null) {
    return slots.snack.typicalHour;
  }
  return null;
}

export function proactiveOffersJob({
  db,
  insights,
  recommendations,
  messenger,
  logger,
}: ProactiveOffersDependencies): Job {
  const deliver = createDelivery({ messenger, logger });

  async function offerTo({ userId, timezone }: ProactiveCandidate, now: Date): Promise<void> {
    const { hour } = localParts(now, timezone);
    if (isQuietHour(hour)) return;
    const { profile } = await insights.get(userId);
    if (profile.readiness !== 'ready' || habitualHour(profile) !== hour) return;
    const result = await recommendations.recommend(userId, { location: null, limit: 1, channel: 'push' });
    const [best] = result.items;
    if (result.status === 'ok' && !result.demoCenterUsed && best !== undefined && best.score >= MIN_SCORE) {
      const delivery = await deliver(userId, 'proactiveOffer', () => proactiveOfferMessage(best));
      if (delivery === 'sent') {
        logger.info({ userId, offerId: best.offerId }, 'proactive offer sent');
        return;
      }
    }
    for (const unsent of result.items) await discardUnsentOffer(db, unsent.offerId);
  }

  return {
    name: JOB_NAME,
    schedule: { everyMs: 15 * 60_000 },
    async run(now) {
      if (messenger() === null) {
        logger.debug({ job: JOB_NAME }, 'proactive offers skipped: the bot is not running yet');
        return;
      }
      let afterUserId = 0;
      for (;;) {
        const page = await findProactiveCandidates(db, {
          now,
          consentVersions: CURRENT_CONSENT_VERSIONS,
          limit: PAGE_SIZE,
          afterUserId,
        });
        for (const candidate of page) {
          await offerTo(candidate, now).catch((error: unknown) => {
            logger.error({ err: error, userId: candidate.userId, job: JOB_NAME }, 'proactive offer failed');
          });
        }
        const last = page.at(-1);
        if (last === undefined || page.length < PAGE_SIZE) return;
        afterUserId = last.userId;
      }
    },
  };
}
