import type { Pool } from '../db/pool.ts';
import { AUDIT_PAGE_SIZE } from '../domain/audit.ts';
import * as audit from '../repositories/audit.ts';
import { badRequest } from '../shared/errors.ts';
import { dayRange, isLocalDate } from '../shared/time.ts';
import { requireOwnedVenue } from './venues.ts';

export interface AuditQuery {
  from?: string;
  to?: string;
  cursor?: string;
}

export interface AuditEventView {
  id: number;
  action: string;
  actor: { userId: number; name: string | null; role: 'owner' } | null;
  target: { type: string; id: number | null };
  details: Record<string, unknown>;
  createdAt: Date;
}

export interface AuditPageView {
  items: AuditEventView[];
  nextCursor: string | null;
}

export interface AuditService {
  list(ownerId: number, query: AuditQuery): Promise<AuditPageView>;
}

const CURSOR = /^[1-9][0-9]{0,17}$/;
const EARLIEST = new Date(0);
const LATEST = new Date(8_640_000_000_000_000);

function invalid(path: string, message: string) {
  return badRequest('validation_failed', 'Request validation failed', [{ path, message }]);
}

function view(row: audit.AuditRow): AuditEventView {
  return {
    id: row.id,
    action: row.action,
    actor: row.actorUserId === null ? null : { userId: row.actorUserId, name: row.actorName, role: 'owner' },
    target: { type: row.targetType, id: row.targetId },
    details: row.details,
    createdAt: row.createdAt,
  };
}

export function createAuditService({ pool }: { pool: Pool }): AuditService {
  return {
    async list(ownerId, query) {
      for (const field of ['from', 'to'] as const) {
        const value = query[field];
        if (value !== undefined && !isLocalDate(value))
          throw invalid(field, 'must be a date in YYYY-MM-DD format');
      }
      if (query.from !== undefined && query.to !== undefined && query.from > query.to) {
        throw invalid('from', 'must not be later than to');
      }
      if (query.cursor !== undefined && !CURSOR.test(query.cursor))
        throw invalid('cursor', 'is not a cursor');
      const venue = await requireOwnedVenue(pool, ownerId);
      const rows = await audit.listInVenue(pool, venue.id, {
        from: query.from === undefined ? EARLIEST : dayRange(query.from, venue.timezone).from,
        to: query.to === undefined ? LATEST : dayRange(query.to, venue.timezone).to,
        beforeId: query.cursor === undefined ? null : Number(query.cursor),
        limit: AUDIT_PAGE_SIZE + 1,
      });
      const page = rows.slice(0, AUDIT_PAGE_SIZE);
      const last = page.at(-1);
      return {
        items: page.map(view),
        nextCursor: rows.length > AUDIT_PAGE_SIZE && last ? String(last.id) : null,
      };
    },
  };
}
