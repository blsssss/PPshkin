alter table venues
  add column blocked_at timestamptz,
  add column blocked_reason text check (length(blocked_reason) <= 500);

alter table users
  add column blocked_at timestamptz,
  add column blocked_reason text check (length(blocked_reason) <= 500);

create table complaints (
  id bigserial primary key,
  reporter_id bigint references users (id) on delete set null,
  venue_id bigint not null references venues (id) on delete cascade,
  booking_id bigint references bookings (id) on delete set null,
  reason text not null check (reason in ('not_served', 'price_mismatch', 'venue_closed', 'item_missing', 'quality', 'wrong_info', 'other')),
  text text check (length(text) <= 500),
  status text not null default 'open' check (status in ('open', 'resolved', 'rejected')),
  resolution text check (length(resolution) <= 500),
  resolved_by bigint references users (id) on delete set null,
  created_at timestamptz not null,
  resolved_at timestamptz
);

create unique index complaints_one_per_booking on complaints (booking_id) where booking_id is not null;
create index complaints_venue_created on complaints (venue_id, created_at desc);
create index complaints_reporter_created on complaints (reporter_id, created_at desc);
create index complaints_status_created on complaints (status, created_at desc);

alter table audit_events alter column venue_id drop not null;
alter table audit_events drop constraint audit_events_target_type_check;
alter table audit_events add constraint audit_events_target_type_check
  check (target_type in ('booking', 'deal', 'menu_item', 'menu_import', 'venue', 'staff', 'complaint', 'user'));
