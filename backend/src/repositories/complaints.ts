import pg from 'pg';
import { maybeOne, one, type Queryable } from '../db/pool.ts';
import type {
  AdminComplaint,
  Complaint,
  ComplaintDecision,
  ComplaintReason,
  ComplaintStatus,
} from '../domain/moderation.ts';

interface ComplaintRow {
  id: number;
  venue_id: number;
  booking_id: number | null;
  reason: ComplaintReason;
  status: ComplaintStatus;
  created_at: Date;
  resolved_at: Date | null;
}

interface AdminComplaintRow extends ComplaintRow {
  text: string | null;
  venue_name: string;
  booking_code: string | null;
  item_name: string | null;
  resolution: string | null;
}

export interface ComplaintContext {
  complaint: AdminComplaint;
  reporterId: number | null;
  venueOwnerId: number | null;
}

export interface NewComplaint {
  reporterId: number;
  venueId: number;
  bookingId: number | null;
  reason: ComplaintReason;
  text: string | null;
  createdAt: Date;
}

const COMPLAINT_COLUMNS = 'c.id, c.venue_id, c.booking_id, c.reason, c.status, c.created_at, c.resolved_at';

const ADMIN_COLUMNS = `${COMPLAINT_COLUMNS}, c.text, c.resolution, v.name as venue_name, b.code as booking_code,
  b.item_name`;

const ADMIN_FROM = `complaints c
  join venues v on v.id = c.venue_id
  left join bookings b on b.id = c.booking_id`;

const ONE_PER_BOOKING_INDEX = 'complaints_one_per_booking';
const UNIQUE_VIOLATION = '23505';

function mapComplaint(row: ComplaintRow): Complaint {
  return {
    id: row.id,
    venueId: row.venue_id,
    bookingId: row.booking_id,
    reason: row.reason,
    status: row.status,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}

function mapAdminComplaint(row: AdminComplaintRow): AdminComplaint {
  return {
    ...mapComplaint(row),
    text: row.text,
    venueName: row.venue_name,
    bookingCode: row.booking_code,
    itemName: row.item_name,
    resolution: row.resolution,
  };
}

export async function insertIfBookingFree(db: Queryable, complaint: NewComplaint): Promise<Complaint | null> {
  await db.query('savepoint complaint_insert');
  try {
    const row = await one<ComplaintRow>(
      db,
      `insert into complaints as c (reporter_id, venue_id, booking_id, reason, text, created_at)
       values ($1, $2, $3, $4, $5, $6)
       returning ${COMPLAINT_COLUMNS}`,
      [
        complaint.reporterId,
        complaint.venueId,
        complaint.bookingId,
        complaint.reason,
        complaint.text,
        complaint.createdAt,
      ],
    );
    await db.query('release savepoint complaint_insert');
    return mapComplaint(row);
  } catch (error) {
    const taken =
      error instanceof pg.DatabaseError &&
      error.code === UNIQUE_VIOLATION &&
      error.constraint === ONE_PER_BOOKING_INDEX;
    if (!taken) throw error;
    await db.query('rollback to savepoint complaint_insert');
    return null;
  }
}

export async function existsForBooking(db: Queryable, bookingId: number): Promise<boolean> {
  return (await maybeOne(db, 'select id from complaints where booking_id = $1', [bookingId])) !== null;
}

export async function countByReporterSince(db: Queryable, reporterId: number, since: Date): Promise<number> {
  const row = await one<{ total: number }>(
    db,
    'select count(*)::int as total from complaints where reporter_id = $1 and created_at > $2',
    [reporterId, since],
  );
  return row.total;
}

export async function listForReporter(db: Queryable, reporterId: number): Promise<Complaint[]> {
  const { rows } = await db.query<ComplaintRow>(
    `select ${COMPLAINT_COLUMNS} from complaints c where c.reporter_id = $1 order by c.created_at desc, c.id desc`,
    [reporterId],
  );
  return rows.map(mapComplaint);
}

export async function listForReview(
  db: Queryable,
  status: ComplaintStatus | null,
  limit: number,
): Promise<AdminComplaint[]> {
  const { rows } = await db.query<AdminComplaintRow>(
    `select ${ADMIN_COLUMNS} from ${ADMIN_FROM}
      where ($1::text is null or c.status = $1)
      order by c.created_at desc, c.id desc
      limit $2`,
    [status, limit],
  );
  return rows.map(mapAdminComplaint);
}

export async function findAdminView(db: Queryable, id: number): Promise<AdminComplaint | null> {
  const row = await maybeOne<AdminComplaintRow>(
    db,
    `select ${ADMIN_COLUMNS} from ${ADMIN_FROM} where c.id = $1`,
    [id],
  );
  return row ? mapAdminComplaint(row) : null;
}

export async function findContext(db: Queryable, id: number): Promise<ComplaintContext | null> {
  const row = await maybeOne<AdminComplaintRow & { reporter_id: number | null; owner_id: number | null }>(
    db,
    `select ${ADMIN_COLUMNS}, c.reporter_id, v.owner_id from ${ADMIN_FROM} where c.id = $1`,
    [id],
  );
  return row
    ? { complaint: mapAdminComplaint(row), reporterId: row.reporter_id, venueOwnerId: row.owner_id }
    : null;
}

export async function lockStatus(db: Queryable, id: number): Promise<{ status: ComplaintStatus } | null> {
  return maybeOne<{ status: ComplaintStatus }>(db, 'select status from complaints where id = $1 for update', [
    id,
  ]);
}

export async function decide(
  db: Queryable,
  id: number,
  decision: { status: ComplaintDecision; resolution: string | null; resolvedBy: number; at: Date },
): Promise<void> {
  await db.query(
    `update complaints set status = $2, resolution = $3, resolved_by = $4, resolved_at = $5 where id = $1`,
    [id, decision.status, decision.resolution, decision.resolvedBy, decision.at],
  );
}

export async function eraseForReporter(db: Queryable, reporterId: number): Promise<void> {
  await db.query('update complaints set text = null, reporter_id = null where reporter_id = $1', [
    reporterId,
  ]);
}
