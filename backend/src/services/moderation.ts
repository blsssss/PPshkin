import { withTransaction, type Pool, type Queryable } from '../db/pool.ts';
import type { AuditChannel } from '../domain/audit.ts';
import type { CompanyVerification } from '../domain/models.ts';
import {
  COMPANY_NOTE_LIMIT,
  COMPLAINTS_PER_DAY,
  COMPLAINT_TEXT_LIMIT,
  SIGNAL_NOT_CLOSED_DAYS,
  SIGNAL_WINDOW_DAYS,
  venueSignals,
  type AdminComplaint,
  type CompanyDecision,
  type Complaint,
  type ComplaintDecision,
  type ComplaintReason,
  type ComplaintStatus,
  type VenueSignal,
} from '../domain/moderation.ts';
import type { Notifications } from '../ports/notifier.ts';
import * as audit from '../repositories/audit.ts';
import * as bookings from '../repositories/bookings.ts';
import * as companies from '../repositories/companies.ts';
import * as complaints from '../repositories/complaints.ts';
import * as moderation from '../repositories/moderation.ts';
import * as users from '../repositories/users.ts';
import * as venues from '../repositories/venues.ts';
import type { Clock } from '../shared/clock.ts';
import type { CompaniesService, CompanyView, CreatedInvite } from './companies.ts';
import type { ReportsService } from './reports.ts';
import { badRequest, conflict, forbidden, notFound } from '../shared/errors.ts';

export interface ComplaintInput {
  venueId: number;
  bookingId?: number;
  reason: ComplaintReason;
  text?: string;
}

export interface ModerationService {
  isAdmin(userId: number): boolean;
  listCompaniesForReview(adminId: number, verification: CompanyVerification): Promise<CompanyView[]>;
  decideCompanyVerification(
    adminId: number,
    companyId: number,
    decision: { decision: CompanyDecision; note?: string | undefined },
    channel: AuditChannel,
  ): Promise<CompanyView>;
  createOwnerInviteAsAdmin(adminId: number, companyId: number, channel: AuditChannel): Promise<CreatedInvite>;
  createComplaint(userId: number, input: ComplaintInput): Promise<Complaint>;
  listComplaints(userId: number): Promise<Complaint[]>;
  listForReview(adminId: number, status: ComplaintStatus | null): Promise<AdminComplaint[]>;
  resolveComplaint(
    adminId: number,
    id: number,
    decision: { status: ComplaintDecision; resolution?: string },
    channel: AuditChannel,
  ): Promise<AdminComplaint>;
  blockVenue(adminId: number, venueId: number, reason: string, channel: AuditChannel): Promise<void>;
  unblockVenue(adminId: number, venueId: number, channel: AuditChannel): Promise<void>;
  blockUser(adminId: number, userId: number, reason: string, channel: AuditChannel): Promise<void>;
  unblockUser(adminId: number, userId: number, channel: AuditChannel): Promise<void>;
  signals(): Promise<VenueSignal[]>;
}

export interface ModerationDependencies {
  pool: Pool;
  clock: Clock;
  notifications: Notifications;
  adminIds: readonly number[];
  companies: Pick<CompaniesService, 'createOwnerInviteAsAdmin' | 'listForVerification' | 'findView'>;
  reports: Pick<ReportsService, 'venuesWithNotClosedStreak'>;
  verificationRequired?: boolean;
}

export const REVIEW_LIMIT = 50;

const DAY_MS = 86_400_000;

const adminOnly = () => notFound('not_found', 'Not found');
const venueNotFound = () => notFound('venue_not_found', 'Venue not found');
const userNotFound = () => notFound('user_not_found', 'User not found');
const bookingNotFound = () => notFound('booking_not_found', 'Booking not found');

export async function requireUnblockedUser(db: Queryable, userId: number): Promise<void> {
  const state = await moderation.shareUser(db, userId);
  if (state?.blockedAt) throw forbidden('user_blocked', 'The account is blocked by the administrator');
}

function cleanReason(reason: string): string {
  const trimmed = reason.trim();
  if (trimmed.length === 0 || trimmed.length > 500) {
    throw badRequest('validation_failed', 'Request validation failed', [
      { path: 'reason', message: 'must be 1 to 500 characters' },
    ]);
  }
  return trimmed;
}

export function createModerationService({
  pool,
  clock,
  notifications,
  adminIds,
  companies: companyViews,
  reports,
  verificationRequired = false,
}: ModerationDependencies): ModerationService {
  const admins = new Set(adminIds);
  const isAdmin = (userId: number) => admins.has(userId);

  function requireAdmin(userId: number): void {
    if (!isAdmin(userId)) throw adminOnly();
  }

  async function review(id: number): Promise<AdminComplaint> {
    const found = await complaints.findAdminView(pool, id);
    if (!found) throw notFound('complaint_not_found', 'Complaint not found');
    return found;
  }

  return {
    isAdmin,

    async listCompaniesForReview(adminId, verification) {
      requireAdmin(adminId);
      return companyViews.listForVerification(verification, REVIEW_LIMIT);
    },

    async decideCompanyVerification(adminId, companyId, input, channel) {
      requireAdmin(adminId);
      const note = input.note?.trim() ?? '';
      if (note.length > COMPANY_NOTE_LIMIT || (input.decision === 'rejected' && note.length === 0)) {
        throw badRequest('validation_failed', 'Request validation failed', [
          {
            path: 'note',
            message:
              note.length > COMPANY_NOTE_LIMIT
                ? `must be at most ${String(COMPANY_NOTE_LIMIT)} characters`
                : 'a rejection needs a reason',
          },
        ]);
      }
      const now = clock.now();
      await withTransaction(pool, async (client) => {
        const current = await companies.lockById(client, companyId);
        if (!current) throw notFound('company_not_found', 'Company not found');
        if (current.verification !== 'pending') {
          throw conflict('not_pending', 'The company is not waiting for a decision');
        }
        await companies.decide(client, companyId, {
          verification: input.decision,
          note: note.length === 0 ? null : note,
          at: now,
        });
        await audit.record(
          client,
          {
            venueId: null,
            companyId,
            actorUserId: adminId,
            action: input.decision === 'verified' ? 'admin.company.verify' : 'admin.company.reject',
            target: { type: 'company', id: companyId },
            channel,
            details: note.length === 0 ? {} : { note },
          },
          now,
        );
        for (const ownerId of await companies.listOwnerIds(client, companyId)) {
          await notifications.enqueue(client, { kind: 'company_decided', companyId, ownerId }, now);
        }
      });
      notifications.flush();
      const view = await companyViews.findView(companyId);
      if (!view) throw notFound('company_not_found', 'Company not found');
      return view;
    },

    async createOwnerInviteAsAdmin(adminId, companyId, channel) {
      requireAdmin(adminId);
      return companyViews.createOwnerInviteAsAdmin(adminId, companyId, channel);
    },

    async createComplaint(userId, input) {
      const now = clock.now();
      const text = input.text?.trim() ?? '';
      if (text.length > COMPLAINT_TEXT_LIMIT) {
        throw badRequest('validation_failed', 'Request validation failed', [
          { path: 'text', message: `must be at most ${String(COMPLAINT_TEXT_LIMIT)} characters` },
        ]);
      }
      const created = await withTransaction(pool, async (client) => {
        await users.lock(client, userId);
        const booking =
          input.bookingId === undefined ? null : await bookings.findForUser(client, userId, input.bookingId);
        if (input.bookingId !== undefined && booking?.venueId !== input.venueId) throw bookingNotFound();
        const venue = booking
          ? (await venues.findByIds(client, [booking.venueId]))[0]
          : await venues.findVisible(client, input.venueId, userId, verificationRequired);
        if (!venue) throw venueNotFound();
        if (booking && (await complaints.existsForBooking(client, booking.id))) {
          throw conflict('complaint_exists', 'A complaint about this booking is already filed');
        }
        const today = await complaints.countByReporterSince(client, userId, new Date(now.getTime() - DAY_MS));
        if (today >= COMPLAINTS_PER_DAY) {
          throw conflict('complaint_limit', `At most ${String(COMPLAINTS_PER_DAY)} complaints a day`);
        }
        const complaint = await complaints.insertIfBookingFree(client, {
          reporterId: userId,
          venueId: venue.id,
          bookingId: booking?.id ?? null,
          reason: input.reason,
          text: text.length === 0 ? null : text,
          createdAt: now,
        });
        if (!complaint) throw conflict('complaint_exists', 'A complaint about this booking is already filed');
        for (const adminId of admins) {
          await notifications.enqueue(
            client,
            { kind: 'complaint_created', complaintId: complaint.id, adminId },
            now,
          );
        }
        return complaint;
      });
      if (admins.size > 0) notifications.flush();
      return created;
    },

    listComplaints: (userId) => complaints.listForReporter(pool, userId),

    async listForReview(adminId, status) {
      requireAdmin(adminId);
      return complaints.listForReview(pool, status, REVIEW_LIMIT);
    },

    async resolveComplaint(adminId, id, decision, channel) {
      requireAdmin(adminId);
      const now = clock.now();
      const resolution = decision.resolution?.trim() ?? '';
      if (resolution.length > 500) {
        throw badRequest('validation_failed', 'Request validation failed', [
          { path: 'resolution', message: 'must be at most 500 characters' },
        ]);
      }
      await withTransaction(pool, async (client) => {
        const current = await complaints.lockStatus(client, id);
        if (!current) throw notFound('complaint_not_found', 'Complaint not found');
        if (current.status !== 'open') throw conflict('already_resolved', 'The complaint is already decided');
        const context = await complaints.findContext(client, id);
        if (!context) throw notFound('complaint_not_found', 'Complaint not found');
        await complaints.decide(client, id, {
          status: decision.status,
          resolution: resolution.length === 0 ? null : resolution,
          resolvedBy: adminId,
          at: now,
        });
        await audit.record(
          client,
          {
            venueId: context.complaint.venueId,
            actorUserId: adminId,
            action: 'admin.complaint.resolve',
            target: { type: 'complaint', id },
            channel,
            details: { status: decision.status, reason: context.complaint.reason },
          },
          now,
        );
        await notifications.enqueue(
          client,
          { kind: 'complaint_decided', complaintId: id, reporterId: context.reporterId },
          now,
        );
        if (decision.status === 'resolved') {
          const [venue] = await venues.findByIds(client, [context.complaint.venueId]);
          if (venue)
            await notifications.enqueue(client, { kind: 'venue_complaint', complaintId: id, venue }, now);
        }
      });
      notifications.flush();
      return review(id);
    },

    async blockVenue(adminId, venueId, reasonInput, channel) {
      requireAdmin(adminId);
      const reason = cleanReason(reasonInput);
      const now = clock.now();
      await withTransaction(pool, async (client) => {
        const state = await moderation.lockVenue(client, venueId);
        if (!state) throw venueNotFound();
        if (state.blockedAt) throw conflict('already_blocked', 'The venue is already blocked');
        await moderation.setVenueBlock(client, venueId, { at: now, reason });
        const cancelled = await bookings.cancelActiveInVenue(client, venueId, now);
        await moderation.cancelLiveDealsInVenue(client, venueId, now);
        const [venue] = await venues.findByIds(client, [venueId]);
        if (!venue) throw venueNotFound();
        for (const booking of cancelled) {
          await notifications.enqueue(client, { kind: 'booking_venue_blocked', booking, venue }, now);
        }
        await notifications.enqueue(client, { kind: 'venue_blocked', venue, blockedAt: now }, now);
        await audit.record(
          client,
          {
            venueId,
            actorUserId: adminId,
            action: 'admin.venue.block',
            target: { type: 'venue', id: venueId },
            channel,
            details: { reason, cancelledBookings: cancelled.length },
          },
          now,
        );
      });
      notifications.flush();
    },

    async unblockVenue(adminId, venueId, channel) {
      requireAdmin(adminId);
      const now = clock.now();
      await withTransaction(pool, async (client) => {
        const state = await moderation.lockVenue(client, venueId);
        if (!state) throw venueNotFound();
        if (!state.blockedAt) throw conflict('not_blocked', 'The venue is not blocked');
        await moderation.setVenueBlock(client, venueId, null);
        await audit.record(
          client,
          {
            venueId,
            actorUserId: adminId,
            action: 'admin.venue.unblock',
            target: { type: 'venue', id: venueId },
            channel,
            details: {},
          },
          now,
        );
      });
    },

    async blockUser(adminId, userId, reasonInput, channel) {
      requireAdmin(adminId);
      const reason = cleanReason(reasonInput);
      if (userId <= 0) throw userNotFound();
      if (isAdmin(userId)) throw conflict('cannot_block_admin', 'An administrator cannot be blocked');
      const now = clock.now();
      const cancelled = await withTransaction(pool, async (client) => {
        const state = await moderation.lockUser(client, userId);
        if (!state) throw userNotFound();
        if (state.blockedAt) throw conflict('already_blocked', 'The user is already blocked');
        await moderation.setUserBlock(client, userId, { at: now, reason });
        const released = await bookings.cancelActiveForUser(client, userId, now);
        const places = await venues.findByIds(client, [
          ...new Set(released.map((booking) => booking.venueId)),
        ]);
        for (const booking of released) {
          const venue = places.find((place) => place.id === booking.venueId);
          if (venue)
            await notifications.enqueue(client, { kind: 'venue_booking_cancelled', booking, venue }, now);
        }
        await audit.record(
          client,
          {
            venueId: null,
            actorUserId: adminId,
            action: 'admin.user.block',
            target: { type: 'user', id: userId },
            channel,
            details: { reason, cancelledBookings: released.length },
          },
          now,
        );
        return released;
      });
      if (cancelled.length > 0) notifications.flush();
    },

    async unblockUser(adminId, userId, channel) {
      requireAdmin(adminId);
      const now = clock.now();
      await withTransaction(pool, async (client) => {
        const state = await moderation.lockUser(client, userId);
        if (!state) throw userNotFound();
        if (!state.blockedAt) throw conflict('not_blocked', 'The user is not blocked');
        await moderation.setUserBlock(client, userId, null);
        await audit.record(
          client,
          {
            venueId: null,
            actorUserId: adminId,
            action: 'admin.user.unblock',
            target: { type: 'user', id: userId },
            channel,
            details: {},
          },
          now,
        );
      });
    },

    async signals() {
      const now = clock.now();
      const since = new Date(now.getTime() - SIGNAL_WINDOW_DAYS * DAY_MS);
      const streaks = new Map(
        (await reports.venuesWithNotClosedStreak(now, SIGNAL_NOT_CLOSED_DAYS)).map((streak) => [
          streak.venueId,
          streak.days.length,
        ]),
      );
      const stats = await moderation.venueSignalStats(pool, since);
      return venueSignals(
        stats.map((entry) => ({ ...entry, notClosedDays: streaks.get(entry.venueId) ?? 0 })),
      );
    },
  };
}
