const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export const OFFER_EXPLANATION_RETENTION_MS = 90 * DAY_MS;
export const CHAT_STATE_RETENTION_MS = 7 * DAY_MS;
export const AUDIT_EVENT_RETENTION_MS = 365 * DAY_MS;
export const NOTIFICATION_RETENTION_MS = 30 * DAY_MS;
export const DEAL_IMPRESSIONS_RETENTION_MS = 90 * DAY_MS;
export const INACTIVE_ACCOUNT_MONTHS = 18;
export const INACTIVE_WARNING_MS = 14 * DAY_MS;
export const LAST_SEEN_THROTTLE_MS = HOUR_MS;

export function monthsBefore(now: Date, months: number): Date {
  const shifted = new Date(now);
  shifted.setUTCMonth(shifted.getUTCMonth() - months);
  return shifted;
}

export function before(now: Date, ms: number): Date {
  return new Date(now.getTime() - ms);
}

export function inactiveDeletionBefore(now: Date): Date {
  return monthsBefore(now, INACTIVE_ACCOUNT_MONTHS);
}

export function inactiveWarningBefore(now: Date): Date {
  return new Date(inactiveDeletionBefore(now).getTime() + INACTIVE_WARNING_MS);
}
