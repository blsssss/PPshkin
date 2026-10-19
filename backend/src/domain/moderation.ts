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

export const SIGNAL_NOT_CLOSED_DAYS = 3;

export const COMPANY_NOTE_LIMIT = 500;
export const COMPANY_REJECTION_REASONS = [
  'Реквизиты не совпадают с заведением',
  'Компания не занимается общепитом',
  'Нет подтверждения полномочий',
] as const;
export const COMPANY_REJECTION_OTHER = 'Другое';
export const COMPANY_DECISIONS = ['verified', 'rejected'] as const;
export type CompanyDecision = (typeof COMPANY_DECISIONS)[number];

export const EGRUL_URL = 'https://egrul.nalog.ru';
export const SUPPORT_CONTACT_URL = 'https://max.ru/t516_hakaton_max_bot';

export const VENUE_BLOCKED_GUEST_TEXT = 'Бронь отменена: заведение временно недоступно';

export interface VenueSignalStats {
  venueId: number;
  name: string;
  openComplaints: number;
  bookings: number;
  redeemed: number;
  notClosedDays: number;
}

export type SignalReason = 'open_complaints' | 'low_redeem_rate' | 'not_closed_streak';

export interface VenueSignal {
  venueId: number;
  name: string;
  reasons: SignalReason[];
  openComplaints: number;
  bookings: number;
  redeemRate: number | null;
  notClosedDays: number;
}

export function venueSignal(stats: VenueSignalStats): VenueSignal | null {
  const redeemRate = stats.bookings >= SIGNAL_MIN_BOOKINGS ? stats.redeemed / stats.bookings : null;
  const reasons: SignalReason[] = [];
  if (stats.openComplaints >= SIGNAL_OPEN_COMPLAINTS) reasons.push('open_complaints');
  if (redeemRate !== null && redeemRate < SIGNAL_REDEEM_RATE) reasons.push('low_redeem_rate');
  if (stats.notClosedDays >= SIGNAL_NOT_CLOSED_DAYS) reasons.push('not_closed_streak');
  if (reasons.length === 0) return null;
  return {
    venueId: stats.venueId,
    name: stats.name,
    reasons,
    openComplaints: stats.openComplaints,
    bookings: stats.bookings,
    redeemRate,
    notClosedDays: stats.notClosedDays,
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
