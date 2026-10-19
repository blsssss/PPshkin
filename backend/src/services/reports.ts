import { withTransaction, type Pool, type Queryable } from '../db/pool.ts';
import { renderReportCsv } from '../documents/csv.ts';
import { renderReportPdf } from '../documents/pdf.ts';
import type { Venue } from '../domain/models.ts';
import {
  buildReport,
  CLOSEOUT_EDIT_WINDOW_MS,
  DAY_CLOSE_DELAY_MINUTES,
  isCountedDeal,
  NOT_CLOSED_STREAK_DAYS,
  notClosedByDay,
  notClosedStreak,
  previousWeek,
  reportRow,
  weekdayOf,
  type ReportData,
  type ReportDealFacts,
} from '../domain/reports.ts';
import { escapeMarkdown } from '../integrations/max/messenger.ts';
import type { Messenger } from '../ports/messenger.ts';
import type { Notifications } from '../ports/notifier.ts';
import * as deals from '../repositories/deals.ts';
import * as reports from '../repositories/reports.ts';
import * as users from '../repositories/users.ts';
import * as venues from '../repositories/venues.ts';
import type { BackgroundTasks } from '../shared/background.ts';
import type { Clock } from '../shared/clock.ts';
import { conflict, notFound, unavailable, unprocessable } from '../shared/errors.ts';
import { addDays, atLocalTime, dayRange, localDate, localParts, minutesOfDay } from '../shared/time.ts';
import { resolveVenueAccess, type VenueActor } from './access.ts';
import { assertDates, resolvePeriod, type AnalyticsPeriod } from './analytics.ts';
import type { BookingsService } from './bookings.ts';
import { dealStatus } from './deals.ts';

export const EXPORT_FORMATS = ['csv', 'pdf'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const WEEKLY_REPORT_HOUR = 9;

export interface ReportFile {
  filename: string;
  data: Buffer;
}

export interface CloseoutView {
  dealId: number;
  writtenOff: number;
  closedAt: Date;
  closedBy: string | null;
  channel: reports.CloseoutChannel;
  date: string;
}

export interface NotClosedStreak {
  venueId: number;
  days: string[];
}

export interface ReportsService {
  day(actor: VenueActor, date?: string): Promise<ReportData>;
  period(actor: VenueActor, period: AnalyticsPeriod): Promise<ReportData>;
  closeOut(
    actor: VenueActor,
    dealId: number,
    writtenOff: number | 'rest',
    channel: reports.CloseoutChannel,
  ): Promise<CloseoutView>;
  exportToChat(actor: VenueActor, period: AnalyticsPeriod, format: ExportFormat): Promise<void>;
  build(venue: Venue, from: string, to: string): Promise<ReportData>;
  file(venue: Venue, report: ReportData, format: ExportFormat): Promise<ReportFile>;
  queueDayClose(now: Date): Promise<number>;
  queueWeekly(now: Date): Promise<number>;
  venuesWithNotClosedStreak(now: Date, days?: number): Promise<NotClosedStreak[]>;
}

interface ReportsDependencies {
  pool: Pool;
  clock: Clock;
  bookings: Pick<BookingsService, 'expireDue'>;
  notifications: Notifications;
  messenger: () => Messenger | null;
  background: BackgroundTasks;
}

const DAY_MS = 86_400_000;
const LOOKBACK_DAYS = 2;
const FINISHED = new Set(['ended', 'sold_out', 'cancelled']);
const MONDAY = 1;
const MINUTES_IN_DAY = 24 * 60;
const FOREVER = new Date(8.64e15);

function toFacts(row: reports.DealReportRow, venue: Venue, now: Date): ReportDealFacts {
  const { deal } = row;
  return {
    dealId: deal.id,
    date: localDate(deal.startsAt, venue.timezone),
    menuItemId: deal.menuItemId,
    itemName: row.itemName,
    listPriceRub: row.listPriceRub,
    dealPriceRub: deal.priceRub,
    source: row.source,
    listed: deal.quantityTotal,
    soldViaApp: row.redeemed,
    reserved: row.reserved,
    revenueRub: row.revenueRub,
    writtenOff: row.writtenOff,
    finished: FINISHED.has(dealStatus(deal, venue, now)),
  };
}

function isCounted(row: reports.DealReportRow): boolean {
  return isCountedDeal({ cancelled: row.deal.cancelledAt !== null, bookings: row.bookings });
}

function countedFacts(rows: readonly reports.DealReportRow[], venue: Venue, now: Date): ReportDealFacts[] {
  return rows.filter(isCounted).map((row) => toFacts(row, venue, now));
}

function closingAt(venue: Venue, date: string): Date {
  const open = minutesOfDay(venue.opensAt) ?? 0;
  const close = minutesOfDay(venue.closesAt) ?? 0;
  if (open === close) return atLocalTime(date, MINUTES_IN_DAY - DAY_CLOSE_DELAY_MINUTES, venue.timezone);
  const closingDate = open < close ? date : addDays(date, 1);
  return atLocalTime(closingDate, close + DAY_CLOSE_DELAY_MINUTES, venue.timezone);
}

function byVenue(rows: readonly reports.DealReportRow[]): Map<number, reports.DealReportRow[]> {
  const grouped = new Map<number, reports.DealReportRow[]>();
  for (const row of rows) {
    grouped.set(row.deal.venueId, [...(grouped.get(row.deal.venueId) ?? []), row]);
  }
  return grouped;
}

async function venuesById(db: Queryable, ids: Iterable<number>): Promise<Map<number, Venue>> {
  return new Map((await venues.findByIds(db, [...ids])).map((venue) => [venue.id, venue]));
}

export async function buildVenueReport(
  db: Queryable,
  venue: Venue,
  from: string,
  to: string,
  now: Date,
): Promise<ReportData> {
  const start = dayRange(from, venue.timezone).from;
  const end = dayRange(to, venue.timezone).to;
  const [rows, newGuests] = await Promise.all([
    reports.listDealFacts(db, { venueId: venue.id, onlyOpen: false }, start, end),
    reports.countNewGuests(db, venue.id, start, end),
  ]);
  return buildReport({
    from,
    to,
    timezone: venue.timezone,
    deals: countedFacts(rows, venue, now),
    newGuests,
  });
}

export function createReportsService({
  pool,
  clock,
  bookings,
  notifications,
  messenger,
  background,
}: ReportsDependencies): ReportsService {
  function build(venue: Venue, from: string, to: string): Promise<ReportData> {
    return buildVenueReport(pool, venue, from, to, clock.now());
  }

  async function authorize(actor: VenueActor, period: AnalyticsPeriod) {
    assertDates(period);
    const { venue } = await resolveVenueAccess(pool, actor, 'analytics.view');
    const { from, to } = resolvePeriod(period, localDate(clock.now(), venue.timezone));
    await bookings.expireDue({ venueId: venue.id });
    return { venue, from, to };
  }

  async function file(venue: Venue, report: ReportData, format: ExportFormat): Promise<ReportFile> {
    const data =
      format === 'csv' ? renderReportCsv(report) : await renderReportPdf({ venueName: venue.name, report });
    return { filename: `report-${report.from}_${report.to}.${format}`, data };
  }

  return {
    async day(actor, date) {
      const { venue, from } = await authorize(actor, { from: date, to: date });
      return build(venue, from, from);
    },

    async period(actor, period) {
      const { venue, from, to } = await authorize(actor, period);
      return build(venue, from, to);
    },

    async closeOut(actor, dealId, writtenOff, channel) {
      const { venue } = await resolveVenueAccess(pool, actor, 'deal.edit');
      await bookings.expireDue({ venueId: venue.id });
      return withTransaction(pool, async (client) => {
        if (!(await deals.lockInVenue(client, venue.id, dealId))) {
          throw notFound('deal_not_found', 'Deal not found');
        }
        const [found] = await reports.listDealFacts(
          client,
          { venueId: venue.id, onlyOpen: false },
          new Date(0),
          FOREVER,
          dealId,
        );
        if (!found) throw notFound('deal_not_found', 'Deal not found');
        const now = clock.now();
        if (!FINISHED.has(dealStatus(found.deal, venue, now))) {
          throw conflict('deal_not_finished', 'The deal is still running, mark the write-off after it ends');
        }
        const existing = await reports.findCloseout(client, dealId);
        if (existing && now.getTime() - existing.closedAt.getTime() > CLOSEOUT_EDIT_WINDOW_MS) {
          throw conflict(
            'closeout_locked',
            'The write-off can be changed within 48 hours after the first mark',
          );
        }
        const free = found.deal.quantityTotal - found.redeemed - found.reserved;
        const marked = writtenOff === 'rest' ? Math.max(0, free) : writtenOff;
        if (marked > free) {
          throw unprocessable(
            'writeoff_too_large',
            'The write-off exceeds the portions that were neither sold nor reserved',
          );
        }
        const saved = await reports.saveCloseout(
          client,
          { dealId, venueId: venue.id, writtenOff: marked, closedBy: actor.userId, channel },
          now,
        );
        const closer = await users.findById(client, actor.userId);
        return {
          dealId: saved.dealId,
          writtenOff: saved.writtenOff,
          closedAt: saved.closedAt,
          closedBy: closer?.firstName ?? null,
          channel: saved.channel,
          date: localDate(found.deal.startsAt, venue.timezone),
        };
      });
    },

    async exportToChat(actor, period, format) {
      const live = messenger();
      if (!live)
        throw unavailable('messenger_unavailable', 'The bot is not running, the file cannot be sent');
      const { venue, from, to } = await authorize(actor, period);
      const report = await build(venue, from, to);
      background.run('export-venue-report', async () => {
        const document = await file(venue, report, format);
        const token = await live.uploadFile(document.data, document.filename);
        await live.sendToUser(actor.userId, {
          text: `Отчёт «${escapeMarkdown(venue.name)}», ${from} - ${to}`,
          fileTokens: [token],
        });
      });
    },

    build,
    file,

    async queueDayClose(now) {
      const since = new Date(now.getTime() - LOOKBACK_DAYS * DAY_MS);
      const rows = await reports.listDealFacts(pool, { venueId: null, onlyOpen: true }, since, now);
      const grouped = byVenue(rows);
      const places = await venuesById(pool, grouped.keys());
      let queued = 0;
      for (const [venueId, venueRows] of grouped) {
        const venue = places.get(venueId);
        if (!venue) continue;
        const dates = countedFacts(venueRows, venue, now)
          .map(reportRow)
          .filter((row) => row.notClosed)
          .map((row) => row.date);
        for (const date of [...new Set(dates)].sort()) {
          if (now < closingAt(venue, date)) continue;
          const claimed = await withTransaction(pool, async (client) => {
            if (!(await reports.claimRun(client, venueId, 'day_close', date, now))) return false;
            await notifications.enqueue(
              client,
              { kind: 'venue_report_ready', venue, period: 'day', date },
              now,
            );
            return true;
          });
          if (claimed) queued += 1;
        }
      }
      if (queued > 0) notifications.flush();
      return queued;
    },

    async queueWeekly(now) {
      const places = await venues.findByIds(pool, await reports.listReportVenueIds(pool));
      let queued = 0;
      for (const venue of places) {
        const { date: today, hour } = localParts(now, venue.timezone);
        if (weekdayOf(today) !== MONDAY || hour < WEEKLY_REPORT_HOUR) continue;
        const week = previousWeek(today);
        if (await reports.hasRun(pool, venue.id, 'weekly', week.from)) continue;
        const weekRows = await reports.listDealFacts(
          pool,
          { venueId: venue.id, onlyOpen: false },
          dayRange(week.from, venue.timezone).from,
          dayRange(week.to, venue.timezone).to,
        );
        const hadDeals = weekRows.some(isCounted);
        const claimed = await withTransaction(pool, async (client) => {
          if (!(await reports.claimRun(client, venue.id, 'weekly', week.from, now))) return false;
          if (!hadDeals) return false;
          await notifications.enqueue(
            client,
            { kind: 'venue_report_ready', venue, period: 'week', date: week.from },
            now,
          );
          return true;
        });
        if (claimed) queued += 1;
      }
      if (queued > 0) notifications.flush();
      return queued;
    },

    async venuesWithNotClosedStreak(now, days = NOT_CLOSED_STREAK_DAYS) {
      const since = new Date(now.getTime() - (days + 2) * DAY_MS);
      const rows = await reports.listDealFacts(pool, { venueId: null, onlyOpen: true }, since, now);
      const grouped = byVenue(rows);
      const places = await venuesById(pool, grouped.keys());
      const found: NotClosedStreak[] = [];
      for (const [venueId, venueRows] of grouped) {
        const venue = places.get(venueId);
        if (!venue) continue;
        const missed = notClosedByDay(countedFacts(venueRows, venue, now).map(reportRow));
        const streak = notClosedStreak(missed, localDate(now, venue.timezone), days);
        if (streak) found.push({ venueId, days: streak });
      }
      return found.sort((left, right) => left.venueId - right.venueId);
    },
  };
}
