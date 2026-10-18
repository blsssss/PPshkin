alter table bookings add column channel text check (channel in ('bot', 'miniapp'));
alter table users add column acquisition text check (length(acquisition) <= 64);
alter table users add column acquired_at timestamptz;
alter table deals add column list_price_rub integer check (list_price_rub >= 0);

create table deal_impressions (
  deal_id bigint not null references deals (id) on delete cascade,
  user_id bigint references users (id) on delete set null,
  day date not null,
  source text not null check (source in ('catalog', 'venue_card', 'deal_card')),
  created_at timestamptz not null
);

create unique index deal_impressions_once on deal_impressions (deal_id, user_id, day);
create index deal_impressions_created on deal_impressions (created_at);
