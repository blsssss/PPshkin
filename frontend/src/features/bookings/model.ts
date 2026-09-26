import type { Schemas } from '../../api/client.ts';

export type Booking = Schemas['Booking'];
type BookingStatus = Booking['status'];

export const MAX_ACTIVE_BOOKINGS = 3;
export const WARNING_MS = 5 * 60_000;

export function formatCode(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

export function spelledCode(code: string): string {
  return code.split('').join(' ');
}

export function msLeft(expiresAt: string, now: number): number {
  return Math.max(0, new Date(expiresAt).getTime() - now);
}

export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export interface NewBookingParams {
  venueId: number;
  menuItemId: number;
  dealId: number | null;
  offerId: number | null;
}

function id(value: string | null): number | null {
  if (value === null || !/^[1-9]\d{0,15}$/.test(value)) return null;
  return Number(value);
}

export function parseNewBooking(params: URLSearchParams): NewBookingParams | null {
  const venueId = id(params.get('venueId'));
  const menuItemId = id(params.get('menuItemId'));
  if (venueId === null || menuItemId === null) return null;
  return { venueId, menuItemId, dealId: id(params.get('dealId')), offerId: id(params.get('offerId')) };
}

export type CreateAction = 'bookings' | 'venue' | 'eat' | 'refresh';

const UNAVAILABLE_TEXT = 'Эта позиция больше недоступна';

export const CREATE_ERRORS: Record<string, { actions: readonly CreateAction[]; text?: string }> = {
  too_many_bookings: { actions: ['bookings'] },
  booking_exists: { actions: ['bookings'] },
  venue_closed: { actions: ['venue', 'eat'] },
  deal_not_active: { actions: ['refresh', 'eat'] },
  deal_sold_out: { actions: ['refresh', 'eat'] },
  menu_item_not_found: { actions: ['venue', 'eat'], text: UNAVAILABLE_TEXT },
  deal_not_found: { actions: ['venue', 'eat'] },
  menu_item_unavailable: { actions: ['venue', 'eat'] },
  offer_not_found: { actions: ['eat'] },
};

export const HISTORY_LABELS: Record<Exclude<BookingStatus, 'active'>, string> = {
  redeemed: 'Получена',
  cancelled: 'Отменена',
  expired: 'Истекла',
};
