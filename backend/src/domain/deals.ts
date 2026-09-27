import { isOpenAt, nextClosingAt } from '../shared/time.ts';
import type { Deal, Venue } from './models.ts';

export function dealOverAt(
  deal: Pick<Deal, 'startsAt' | 'endsAt'>,
  venue: Pick<Venue, 'opensAt' | 'closesAt' | 'timezone'>,
): Date {
  const { opensAt, closesAt, timezone } = venue;
  const closing = nextClosingAt(opensAt, closesAt, deal.startsAt, timezone);
  if (!closing) return deal.endsAt;
  if (!isOpenAt(opensAt, closesAt, deal.startsAt, timezone)) return deal.startsAt;
  return closing < deal.endsAt ? closing : deal.endsAt;
}
