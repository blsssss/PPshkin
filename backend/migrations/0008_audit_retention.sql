create table audit_events (
  id bigserial primary key,
  venue_id bigint not null references venues (id) on delete cascade,
  actor_user_id bigint references users (id) on delete set null,
  action text not null,
  target_type text not null check (target_type in ('booking', 'deal', 'menu_item', 'menu_import', 'venue', 'staff')),
  target_id bigint,
  details jsonb not null default '{}',
  created_at timestamptz not null
);

create index audit_events_venue_created on audit_events (venue_id, created_at desc);
alter table users add column last_seen_at timestamptz;
