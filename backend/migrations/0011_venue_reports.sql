create table deal_closeouts (
  deal_id bigint primary key references deals (id) on delete cascade,
  venue_id bigint not null references venues (id) on delete cascade,
  written_off integer not null check (written_off between 0 and 1000),
  closed_by bigint references users (id) on delete set null,
  channel text not null check (channel in ('bot', 'miniapp')),
  closed_at timestamptz not null,
  updated_at timestamptz not null
);

create index deal_closeouts_venue on deal_closeouts (venue_id, closed_at desc);

create table venue_report_runs (
  venue_id bigint not null references venues (id) on delete cascade,
  kind text not null check (kind in ('day_close', 'weekly')),
  period_start date not null,
  sent_at timestamptz not null,
  primary key (venue_id, kind, period_start)
);

alter table deals add column source text not null default 'manual' check (source in ('manual', 'pos'));
