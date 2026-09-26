import { UserUnreachableError } from '../integrations/max/errors.ts';
import type { MaxLogger } from '../integrations/max/poller.ts';
import type { Messenger, OutgoingMessage, UpdateHandler } from '../ports/messenger.ts';
import { AppError } from '../shared/errors.ts';
import { consentRequest } from './messages.ts';
import { errorText, NOTICES, SOMETHING_WENT_WRONG } from './texts.ts';

const CONSENT_CODES = new Set(['consent_required', 'consent_version_outdated']);

export type Failure =
  | { kind: 'unreachable' }
  | { kind: 'consent' | 'known' | 'unexpected'; message: OutgoingMessage; notice: string };

export function describeFailure(error: unknown): Failure {
  if (error instanceof UserUnreachableError) return { kind: 'unreachable' };
  if (error instanceof AppError) {
    if (CONSENT_CODES.has(error.code)) {
      return { kind: 'consent', message: consentRequest(), notice: NOTICES.consentFirst };
    }
    const text = errorText(error.code);
    if (text !== null) return { kind: 'known', message: { text }, notice: text };
  }
  return { kind: 'unexpected', message: { text: SOMETHING_WENT_WRONG }, notice: NOTICES.tryAgain };
}

export function withFallbackReply(
  handler: UpdateHandler,
  { messenger, logger }: { messenger: Messenger; logger: MaxLogger },
): UpdateHandler {
  return async (event) => {
    try {
      await handler(event);
    } catch (error) {
      const context = { userId: event.user.id, event: event.type };
      if (error instanceof UserUnreachableError) {
        logger.warn(context, 'guest cannot be reached, the bot is probably blocked');
        return;
      }
      logger.error({ ...context, err: error }, 'bot update failed before routing');
      if (event.type === 'stopped') return;
      try {
        if (event.type === 'callback') {
          await messenger.answerCallback(event.callbackId, { notification: NOTICES.tryAgain });
        } else {
          await messenger.sendToUser(event.user.id, { text: SOMETHING_WENT_WRONG });
        }
      } catch (replyError) {
        logger.warn({ ...context, err: replyError }, 'failure reply was not delivered');
      }
    }
  };
}
