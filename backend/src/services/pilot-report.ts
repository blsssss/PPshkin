import type { Queryable } from '../db/pool.ts';
import type { ReportData } from '../domain/reports.ts';
import { csvLine, perWeek, periodDays, ratio, type Ratio } from '../domain/pilot-metrics.ts';
import * as metrics from '../repositories/pilot-metrics.ts';
import * as venueRepository from '../repositories/venues.ts';
import { isLocalDate } from '../shared/time.ts';
import { buildVenueReport } from './reports.ts';

export interface PilotReportQuery {
  from: string;
  to: string;
  venueId: number | null;
}

export interface VenueCounts {
  listed: number;
  sold: number;
  writtenOff: number;
  closedListed: number;
  offersShown: number;
  offersAccepted: number;
  catalogBookings: number;
  dealImpressions: number;
  newGuests: number;
  redeemingGuests: number;
  newGuestDiscountRub: number;
  newGuestListPriceRub: number;
  bookingsCreated: number;
  bookingsRedeemed: number;
}

export interface VenueMetrics extends VenueCounts {
  soldShare: Ratio;
  writeOffShare: Ratio;
  offerAcceptance: Ratio;
  catalogConversion: Ratio;
  newGuestsPerWeek: number;
  newGuestShare: Ratio;
  costPerGuest: Ratio;
  redeemShare: Ratio;
}

export interface ChannelMetrics {
  acquisition: string;
  newGuests: number;
  retentionD7: Ratio;
}

export interface PilotReport {
  period: { from: string; to: string; days: number };
  venues: ({ venueId: number; name: string } & VenueMetrics)[];
  total: VenueMetrics;
  deletedAccountBookings: number;
  retentionD7: Ratio;
  channels: ChannelMetrics[];
  funnel: metrics.Funnel;
}

const REPORT_FORMATS = ['csv', 'json'] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];

const EMPTY_COUNTS: VenueCounts = {
  listed: 0,
  sold: 0,
  writtenOff: 0,
  closedListed: 0,
  offersShown: 0,
  offersAccepted: 0,
  catalogBookings: 0,
  dealImpressions: 0,
  newGuests: 0,
  redeemingGuests: 0,
  newGuestDiscountRub: 0,
  newGuestListPriceRub: 0,
  bookingsCreated: 0,
  bookingsRedeemed: 0,
};

function withRatios(counts: VenueCounts, days: number): VenueMetrics {
  return {
    ...counts,
    soldShare: ratio(counts.sold, counts.listed),
    writeOffShare: ratio(counts.writtenOff, counts.closedListed),
    offerAcceptance: ratio(counts.offersAccepted, counts.offersShown),
    catalogConversion: ratio(counts.catalogBookings, counts.dealImpressions),
    newGuestsPerWeek: perWeek(counts.newGuests, days),
    newGuestShare: ratio(counts.newGuests, counts.redeemingGuests),
    costPerGuest: ratio(counts.newGuestDiscountRub, counts.newGuestListPriceRub),
    redeemShare: ratio(counts.bookingsRedeemed, counts.bookingsCreated),
  };
}

function sum(list: readonly VenueCounts[]): VenueCounts {
  const total = { ...EMPTY_COUNTS };
  for (const counts of list) {
    for (const key of Object.keys(total) as (keyof VenueCounts)[]) total[key] += counts[key];
  }
  return total;
}

export function parseReportArgs(argv: readonly string[]): PilotReportQuery & { format: ReportFormat } {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === undefined || !flag.startsWith('--') || value === undefined) {
      throw new Error(
        'usage: pilot-report --from YYYY-MM-DD --to YYYY-MM-DD [--venue <id>] [--format csv|json]',
      );
    }
    values.set(flag.slice(2), value);
  }
  const from = values.get('from');
  const to = values.get('to');
  if (from === undefined || to === undefined || !isLocalDate(from) || !isLocalDate(to) || from > to) {
    throw new Error('--from and --to must be dates YYYY-MM-DD, --from not later than --to');
  }
  const venue = values.get('venue');
  const venueId = venue === undefined ? null : Number(venue);
  if (venueId !== null && (!Number.isSafeInteger(venueId) || venueId <= 0)) {
    throw new Error('--venue must be a positive venue id');
  }
  const format = values.get('format') ?? 'csv';
  if (!REPORT_FORMATS.some((known) => known === format)) throw new Error('--format must be csv or json');
  return { from, to, venueId, format: format as ReportFormat };
}

function closedListed(report: ReportData | undefined): number {
  return (report?.rows ?? []).reduce((total, row) => total + (row.writtenOff === null ? 0 : row.listed), 0);
}

export async function buildPilotReport(
  db: Queryable,
  query: PilotReportQuery,
  now: Date,
): Promise<PilotReport> {
  const period = { from: query.from, to: query.to, venueId: query.venueId };
  const days = periodDays(query.from, query.to);
  const [venues, offers, catalog, guests, cost, outcomes, cohorts, acquisitions, entry] = await Promise.all([
    metrics.pilotVenues(db, period),
    metrics.offerAcceptance(db, period),
    metrics.catalogConversion(db, period),
    metrics.guestCounts(db, period),
    metrics.newGuestCost(db, period),
    metrics.bookingOutcomes(db, period),
    metrics.retentionD7(db, period, now),
    metrics.newGuestsByAcquisition(db, period),
    metrics.funnel(db, period),
  ]);
  const reports = new Map(
    await Promise.all(
      (
        await venueRepository.findByIds(
          db,
          venues.map((venue) => venue.id),
        )
      ).map(
        async (venue) => [venue.id, await buildVenueReport(db, venue, query.from, query.to, now)] as const,
      ),
    ),
  );
  const counted = venues.map((venue): { venueId: number; name: string } & VenueCounts => ({
    venueId: venue.id,
    name: venue.name,
    listed: reports.get(venue.id)?.listed ?? 0,
    sold: reports.get(venue.id)?.soldViaApp ?? 0,
    writtenOff: reports.get(venue.id)?.writtenOff ?? 0,
    closedListed: closedListed(reports.get(venue.id)),
    offersShown: offers.get(venue.id)?.shown ?? 0,
    offersAccepted: offers.get(venue.id)?.accepted ?? 0,
    catalogBookings: catalog.get(venue.id)?.bookings ?? 0,
    dealImpressions: catalog.get(venue.id)?.impressions ?? 0,
    newGuests: reports.get(venue.id)?.newGuests ?? 0,
    redeemingGuests: guests.get(venue.id)?.redeemingGuests ?? 0,
    newGuestDiscountRub: cost.get(venue.id)?.discountRub ?? 0,
    newGuestListPriceRub: cost.get(venue.id)?.listPriceRub ?? 0,
    bookingsCreated: outcomes.get(venue.id)?.created ?? 0,
    bookingsRedeemed: outcomes.get(venue.id)?.redeemed ?? 0,
  }));
  const acquisitionNames = [
    ...new Set([...cohorts.map((c) => c.acquisition), ...acquisitions.map((a) => a.acquisition)]),
  ].sort();
  return {
    period: { from: query.from, to: query.to, days },
    venues: counted.map((venue) => ({ ...venue, ...withRatios(venue, days) })),
    total: withRatios(sum(counted), days),
    deletedAccountBookings: [...outcomes.values()].reduce((total, row) => total + row.withoutGuest, 0),
    retentionD7: ratio(
      cohorts.reduce((total, cohort) => total + cohort.retained, 0),
      cohorts.reduce((total, cohort) => total + cohort.cohort, 0),
    ),
    channels: acquisitionNames.map((acquisition) => {
      const cohort = cohorts.find((candidate) => candidate.acquisition === acquisition);
      return {
        acquisition,
        newGuests: acquisitions.find((candidate) => candidate.acquisition === acquisition)?.newGuests ?? 0,
        retentionD7: ratio(cohort?.retained ?? 0, cohort?.cohort ?? 0),
      };
    }),
    funnel: entry,
  };
}

const VENUE_COLUMNS = [
  'venue_id',
  'venue',
  'listed',
  'sold',
  'sold_share',
  'written_off',
  'closed_listed',
  'written_off_share',
  'offers_shown',
  'offers_accepted',
  'offer_acceptance',
  'catalog_bookings',
  'deal_impressions',
  'catalog_conversion',
  'new_guests',
  'new_guests_per_week',
  'redeeming_guests',
  'new_guest_share',
  'new_guest_discount_rub',
  'new_guest_list_price_rub',
  'cost_per_guest',
  'bookings_created',
  'bookings_redeemed',
  'redeem_share',
] as const;

function venueCells(id: number | null, name: string, row: VenueMetrics): (string | number | null)[] {
  return [
    id,
    name,
    row.listed,
    row.sold,
    row.soldShare.value,
    row.writtenOff,
    row.closedListed,
    row.writeOffShare.value,
    row.offersShown,
    row.offersAccepted,
    row.offerAcceptance.value,
    row.catalogBookings,
    row.dealImpressions,
    row.catalogConversion.value,
    row.newGuests,
    row.newGuestsPerWeek,
    row.redeemingGuests,
    row.newGuestShare.value,
    row.newGuestDiscountRub,
    row.newGuestListPriceRub,
    row.costPerGuest.value,
    row.bookingsCreated,
    row.bookingsRedeemed,
    row.redeemShare.value,
  ];
}

export function renderPilotReport(report: PilotReport, format: ReportFormat): string {
  if (format === 'json') return `${JSON.stringify(report, null, 2)}\n`;
  const { funnel } = report;
  return [
    csvLine(['period', report.period.from, report.period.to, report.period.days]),
    '',
    csvLine(VENUE_COLUMNS),
    ...report.venues.map((venue) => csvLine(venueCells(venue.venueId, venue.name, venue))),
    csvLine(venueCells(null, 'Итого', report.total)),
    '',
    csvLine(['row', 'bookings']),
    csvLine(['Брони удалённых аккаунтов', report.deletedAccountBookings]),
    '',
    csvLine(['acquisition', 'new_guests', 'cohort_d7', 'retained_d7', 'retention_d7']),
    ...report.channels.map((channel) =>
      csvLine([
        channel.acquisition,
        channel.newGuests,
        channel.retentionD7.denominator,
        channel.retentionD7.numerator,
        channel.retentionD7.value,
      ]),
    ),
    csvLine([
      'all',
      report.total.newGuests,
      report.retentionD7.denominator,
      report.retentionD7.numerator,
      report.retentionD7.value,
    ]),
    '',
    csvLine(['funnel_step', 'users']),
    csvLine(['signed_in', funnel.signedIn]),
    csvLine(['consented', funnel.consented]),
    csvLine(['first_meal', funnel.firstMeal]),
    csvLine(['first_offer', funnel.firstOffer]),
    csvLine(['first_booking', funnel.firstBooking]),
    csvLine(['first_redeemed', funnel.firstRedeemed]),
    '',
  ].join('\n');
}
