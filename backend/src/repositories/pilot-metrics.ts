import type { Queryable } from '../db/pool.ts';
import { FIRST_REDEEMS } from './reports.ts';

export interface MetricsPeriod {
  from: string;
  to: string;
  venueId: number | null;
}

export interface PilotVenue {
  id: number;
  name: string;
}

export interface OfferAcceptance {
  shown: number;
  accepted: number;
}

export interface CatalogConversion {
  bookings: number;
  impressions: number;
}

export interface GuestCounts {
  newGuests: number;
  redeemingGuests: number;
}

export interface NewGuestCost {
  discountRub: number;
  listPriceRub: number;
}

export interface BookingOutcomes {
  created: number;
  redeemed: number;
  withoutGuest: number;
}

export interface RetentionCohort {
  acquisition: string;
  cohort: number;
  retained: number;
}

export interface AcquisitionGuests {
  acquisition: string;
  newGuests: number;
}

export interface Funnel {
  signedIn: number;
  consented: number;
  firstMeal: number;
  firstOffer: number;
  firstBooking: number;
  firstRedeemed: number;
}

const PILOT_VENUE = `not v.is_demo and ($3::bigint is null or v.id = $3)`;

function localDay(column: string, timeZone: string): string {
  return `((${column}) at time zone ${timeZone})::date between $1::date and $2::date`;
}

const REAL_BOOKING = '(b.user_id is null or b.user_id > 0)';

const NEW_GUESTS = `select f.venue_id, f.user_id
    from (${FIRST_REDEEMS}) f
    join venues v on v.id = f.venue_id
   where ${PILOT_VENUE} and ${localDay('f.first_at', 'v.timezone')}`;

function params(period: MetricsPeriod): unknown[] {
  return [period.from, period.to, period.venueId];
}

function byVenue<T>(rows: readonly ({ venue_id: number } & T)[]): Map<number, T> {
  return new Map(rows.map(({ venue_id, ...rest }) => [venue_id, rest as T]));
}

export async function pilotVenues(db: Queryable, period: MetricsPeriod): Promise<PilotVenue[]> {
  const { rows } = await db.query<PilotVenue>(
    `select v.id, v.name from venues v
      where ${PILOT_VENUE} and $1::date <= $2::date
      order by v.id`,
    params(period),
  );
  return rows;
}

export async function offerAcceptance(
  db: Queryable,
  period: MetricsPeriod,
): Promise<Map<number, OfferAcceptance>> {
  const { rows } = await db.query<{ venue_id: number } & OfferAcceptance>(
    `select o.venue_id, count(*)::int as shown, count(*) filter (where o.status = 'accepted')::int as accepted
       from offers o
       join venues v on v.id = o.venue_id
      where ${PILOT_VENUE} and o.channel in ('bot', 'miniapp')
        and (o.user_id is null or o.user_id > 0)
        and ${localDay('o.created_at', 'v.timezone')}
      group by o.venue_id`,
    params(period),
  );
  return byVenue(rows);
}

export async function catalogConversion(
  db: Queryable,
  period: MetricsPeriod,
): Promise<Map<number, CatalogConversion>> {
  const { rows } = await db.query<{ venue_id: number } & CatalogConversion>(
    `select v.id as venue_id,
            (select count(*)::int from bookings b
              where b.venue_id = v.id and b.offer_id is null and b.deal_id is not null and ${REAL_BOOKING}
                and ${localDay('b.created_at', 'v.timezone')}) as bookings,
            (select count(*)::int from deal_impressions i join deals d on d.id = i.deal_id
              where d.venue_id = v.id and i.day between $1::date and $2::date) as impressions
       from venues v
      where ${PILOT_VENUE}`,
    params(period),
  );
  return byVenue(rows);
}

export async function guestCounts(db: Queryable, period: MetricsPeriod): Promise<Map<number, GuestCounts>> {
  const { rows } = await db.query<{ venue_id: number } & GuestCounts>(
    `select v.id as venue_id,
            (select count(*)::int from (${NEW_GUESTS}) n where n.venue_id = v.id) as "newGuests",
            (select count(distinct b.user_id)::int from bookings b
              where b.venue_id = v.id and b.status = 'redeemed' and b.user_id > 0
                and ${localDay('b.resolved_at', 'v.timezone')}) as "redeemingGuests"
       from venues v
      where ${PILOT_VENUE}`,
    params(period),
  );
  return byVenue(rows);
}

export async function newGuestCost(db: Queryable, period: MetricsPeriod): Promise<Map<number, NewGuestCost>> {
  const { rows } = await db.query<{ venue_id: number } & NewGuestCost>(
    `select b.venue_id,
            coalesce(sum(d.list_price_rub - b.price_rub), 0)::int as "discountRub",
            coalesce(sum(d.list_price_rub), 0)::int as "listPriceRub"
       from bookings b
       join deals d on d.id = b.deal_id
       join venues v on v.id = b.venue_id
       join (${NEW_GUESTS}) n on n.venue_id = b.venue_id and n.user_id = b.user_id
      where b.status = 'redeemed' and d.list_price_rub is not null
        and ${localDay('b.resolved_at', 'v.timezone')}
      group by b.venue_id`,
    params(period),
  );
  return byVenue(rows);
}

export async function bookingOutcomes(
  db: Queryable,
  period: MetricsPeriod,
): Promise<Map<number, BookingOutcomes>> {
  const { rows } = await db.query<{ venue_id: number } & BookingOutcomes>(
    `select b.venue_id, count(*)::int as created,
            count(*) filter (where b.status = 'redeemed')::int as redeemed,
            count(*) filter (where b.user_id is null)::int as "withoutGuest"
       from bookings b
       join venues v on v.id = b.venue_id
      where ${PILOT_VENUE} and ${REAL_BOOKING} and ${localDay('b.created_at', 'v.timezone')}
      group by b.venue_id`,
    params(period),
  );
  return byVenue(rows);
}

export async function retentionD7(
  db: Queryable,
  period: Omit<MetricsPeriod, 'venueId'>,
  now: Date,
): Promise<RetentionCohort[]> {
  const { rows } = await db.query<RetentionCohort>(
    `with firsts as (
       select m.user_id, min((m.created_at at time zone u.timezone)::date) as first_day,
              (($3::timestamptz) at time zone u.timezone)::date as today,
              coalesce(u.acquisition, 'unknown') as acquisition
         from meals m
         join users u on u.id = m.user_id
        where m.user_id > 0 and m.source <> 'demo'
        group by m.user_id, u.timezone, u.acquisition
     ), cohort as (
       select f.* from firsts f
        where f.first_day between $1::date and $2::date and f.first_day + 7 <= f.today
     )
     select c.acquisition, count(*)::int as cohort,
            count(*) filter (where exists (
              select 1 from meals m join users u on u.id = m.user_id
               where m.user_id = c.user_id and m.source <> 'demo'
                 and (m.created_at at time zone u.timezone)::date = c.first_day + 7
            ))::int as retained
       from cohort c
      group by c.acquisition
      order by c.acquisition`,
    [period.from, period.to, now],
  );
  return rows;
}

export async function newGuestsByAcquisition(
  db: Queryable,
  period: MetricsPeriod,
): Promise<AcquisitionGuests[]> {
  const { rows } = await db.query<AcquisitionGuests>(
    `select coalesce(u.acquisition, 'unknown') as acquisition, count(*)::int as "newGuests"
       from (${NEW_GUESTS}) n
       join users u on u.id = n.user_id
      group by 1
      order by 1`,
    params(period),
  );
  return rows;
}

export async function funnel(db: Queryable, period: Omit<MetricsPeriod, 'venueId'>): Promise<Funnel> {
  const { rows } = await db.query<Funnel>(
    `with cohort as (
       select u.id from users u
        where u.id > 0 and ${localDay('u.created_at', `'Europe/Moscow'`)}
     )
     select count(*)::int as "signedIn",
            count(*) filter (where exists (
              select 1 from consents c where c.user_id = cohort.id and c.kind = 'personal_data'))::int as consented,
            count(*) filter (where exists (
              select 1 from meals m where m.user_id = cohort.id and m.source <> 'demo'))::int as "firstMeal",
            count(*) filter (where exists (select 1 from offers o where o.user_id = cohort.id))::int as "firstOffer",
            count(*) filter (where exists (select 1 from bookings b where b.user_id = cohort.id))::int as "firstBooking",
            count(*) filter (where exists (
              select 1 from bookings b where b.user_id = cohort.id and b.status = 'redeemed'))::int as "firstRedeemed"
       from cohort`,
    [period.from, period.to],
  );
  const [row] = rows;
  if (!row) throw new Error('Funnel query returned no row');
  return row;
}
