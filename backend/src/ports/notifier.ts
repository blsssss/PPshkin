import type { Booking, Venue } from '../domain/models.ts';

export interface BookingNotice {
  booking: Booking;
  venue: Venue;
}

export interface Notifier {
  bookingCreated(notice: BookingNotice): Promise<void>;
  bookingCancelled(notice: BookingNotice): Promise<void>;
  bookingRedeemed(notice: BookingNotice): Promise<void>;
  bookingExpired(notice: BookingNotice): Promise<void>;
}
