export const COMPLAINT_REASONS = [
  'not_served',
  'price_mismatch',
  'venue_closed',
  'item_missing',
  'quality',
  'wrong_info',
  'other',
] as const;
export type ComplaintReason = (typeof COMPLAINT_REASONS)[number];

export const COMPLAINT_REASON_TEXTS: Record<ComplaintReason, string> = {
  not_served: 'Не выдали заказ по брони',
  price_mismatch: 'Цена на кассе другая',
  venue_closed: 'Заведение было закрыто',
  item_missing: 'Блюда не было в наличии',
  quality: 'Качество блюда',
  wrong_info: 'Неверные сведения о заведении или меню',
  other: 'Другое',
};

export const COMPLAINT_STATUSES = ['open', 'resolved', 'rejected'] as const;
export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number];

export const COMPLAINT_DECISIONS = ['resolved', 'rejected'] as const;
export type ComplaintDecision = (typeof COMPLAINT_DECISIONS)[number];

export const COMPLAINT_TEXT_LIMIT = 500;
export const BLOCK_REASON_LIMIT = 500;
export const COMPLAINTS_PER_DAY = 5;

export const SIGNAL_WINDOW_DAYS = 7;
export const SIGNAL_OPEN_COMPLAINTS = 3;
export const SIGNAL_REDEEM_RATE = 0.3;
export const SIGNAL_MIN_BOOKINGS = 10;

export const VENUE_BLOCKED_GUEST_TEXT = 'Бронь отменена: заведение временно недоступно';

export interface VenueSignalStats {
  venueId: number;
  name: string;
  openComplaints: number;
  bookings: number;
  redeemed: number;
}

export type SignalReason = 'open_complaints' | 'low_redeem_rate';

export interface VenueSignal {
  venueId: number;
  name: string;
  reasons: SignalReason[];
  openComplaints: number;
  bookings: number;
  redeemRate: number | null;
}

export function venueSignal(stats: VenueSignalStats): VenueSignal | null {
  const redeemRate = stats.bookings >= SIGNAL_MIN_BOOKINGS ? stats.redeemed / stats.bookings : null;
  const reasons: SignalReason[] = [];
  if (stats.openComplaints >= SIGNAL_OPEN_COMPLAINTS) reasons.push('open_complaints');
  if (redeemRate !== null && redeemRate < SIGNAL_REDEEM_RATE) reasons.push('low_redeem_rate');
  if (reasons.length === 0) return null;
  return {
    venueId: stats.venueId,
    name: stats.name,
    reasons,
    openComplaints: stats.openComplaints,
    bookings: stats.bookings,
    redeemRate,
  };
}

export function venueSignals(stats: readonly VenueSignalStats[]): VenueSignal[] {
  return stats.flatMap((entry) => venueSignal(entry) ?? []);
}

export interface Complaint {
  id: number;
  venueId: number;
  bookingId: number | null;
  reason: ComplaintReason;
  status: ComplaintStatus;
  createdAt: Date;
  resolvedAt: Date | null;
}

export interface AdminComplaint extends Complaint {
  text: string | null;
  venueName: string;
  bookingCode: string | null;
  itemName: string | null;
  resolution: string | null;
}
