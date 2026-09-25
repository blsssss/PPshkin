create table users (
  id bigint primary key,
  first_name text,
  username text,
  timezone text not null default 'Europe/Moscow',
  kcal_target integer not null default 2000 check (kcal_target between 1000 and 5000),
  goal text check (goal in ('lose', 'maintain', 'gain')),
  disliked_tags text[] not null default '{}',
  location_lat double precision check (location_lat between -90 and 90),
  location_lon double precision check (location_lon between -180 and 180),
  location_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((location_lat is null) = (location_lon is null))
);

create table consents (
  id bigserial primary key,
  user_id bigint not null references users (id) on delete cascade,
  kind text not null check (kind in ('personal_data', 'personalized_offers')),
  version text not null,
  channel text not null check (channel in ('bot', 'miniapp')),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz
);

create unique index consents_one_active on consents (user_id, kind) where revoked_at is null;
create index consents_user on consents (user_id);

create table meals (
  id bigserial primary key,
  user_id bigint not null references users (id) on delete cascade,
  title text not null check (length(title) between 1 and 200),
  kcal_min integer not null check (kcal_min >= 0),
  kcal_max integer not null check (kcal_max <= 10000),
  protein_g double precision check (protein_g >= 0),
  fat_g double precision check (fat_g >= 0),
  carbs_g double precision check (carbs_g >= 0),
  tags text[] not null default '{}',
  source text not null check (source in ('photo', 'text', 'manual', 'booking', 'demo')),
  confidence double precision check (confidence between 0 and 1),
  eaten_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (kcal_max >= kcal_min)
);

create index meals_user_eaten on meals (user_id, eaten_at desc);

create table venues (
  id bigserial primary key,
  owner_id bigint references users (id) on delete set null,
  name text not null check (length(name) between 1 and 120),
  address text not null check (length(address) between 1 and 200),
  category text not null check (category in ('coffee', 'bakery', 'cafe', 'canteen', 'restaurant')),
  lat double precision not null check (lat between -90 and 90),
  lon double precision not null check (lon between -180 and 180),
  opens_at time not null default '08:00',
  closes_at time not null default '22:00',
  timezone text not null default 'Europe/Moscow',
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index venues_one_per_owner on venues (owner_id) where owner_id is not null;

create table menu_items (
  id bigserial primary key,
  venue_id bigint not null references venues (id) on delete cascade,
  name text not null check (length(name) between 1 and 120),
  description text check (length(description) <= 500),
  category text not null check (
    category in ('breakfast', 'main', 'soup', 'salad', 'side', 'bakery', 'dessert', 'snack', 'drink')
  ),
  price_rub integer not null check (price_rub between 0 and 100000),
  weight_g integer check (weight_g between 1 and 5000),
  kcal integer not null check (kcal between 0 and 5000),
  protein_g double precision check (protein_g >= 0),
  fat_g double precision check (fat_g >= 0),
  carbs_g double precision check (carbs_g >= 0),
  nutrition_source text not null check (nutrition_source in ('venue', 'estimate')),
  tags text[] not null default '{}',
  is_available boolean not null default true,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (venue_id, id)
);

create index menu_items_venue on menu_items (venue_id) where archived_at is null;

create table menu_imports (
  id bigserial primary key,
  venue_id bigint not null references venues (id) on delete cascade,
  source text not null check (source in ('photo', 'text')),
  status text not null default 'processing' check (status in ('processing', 'ready', 'failed', 'applied')),
  items jsonb not null default '[]',
  error text,
  model text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index menu_imports_venue on menu_imports (venue_id, created_at desc);

create table deals (
  id bigserial primary key,
  venue_id bigint not null references venues (id) on delete cascade,
  menu_item_id bigint not null,
  price_rub integer not null check (price_rub >= 0),
  quantity_total integer not null check (quantity_total between 1 and 1000),
  quantity_left integer not null,
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  check (quantity_left between 0 and quantity_total),
  check (ends_at > starts_at),
  unique (venue_id, id),
  foreign key (venue_id, menu_item_id) references menu_items (venue_id, id)
);

create index deals_venue on deals (venue_id, ends_at desc);
create index deals_menu_item on deals (menu_item_id);
create index deals_live on deals (ends_at) where cancelled_at is null and quantity_left > 0;

create table offers (
  id bigserial primary key,
  user_id bigint references users (id) on delete set null,
  venue_id bigint not null references venues (id) on delete cascade,
  menu_item_id bigint not null,
  deal_id bigint,
  channel text not null check (channel in ('bot', 'miniapp', 'push')),
  score double precision not null,
  explanation jsonb not null,
  status text not null default 'shown' check (status in ('shown', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  foreign key (venue_id, menu_item_id) references menu_items (venue_id, id),
  foreign key (venue_id, deal_id) references deals (venue_id, id) on delete set null (deal_id)
);

create index offers_user_created on offers (user_id, created_at desc);
create index offers_venue_created on offers (venue_id, created_at desc);
create index offers_menu_item on offers (menu_item_id);
create index offers_deal on offers (deal_id) where deal_id is not null;

create table bookings (
  id bigserial primary key,
  user_id bigint references users (id) on delete set null,
  venue_id bigint not null references venues (id) on delete cascade,
  menu_item_id bigint not null,
  deal_id bigint,
  offer_id bigint references offers (id) on delete set null,
  code text not null check (code ~ '^[A-HJ-NP-Z2-9]{6}$'),
  item_name text not null,
  price_rub integer not null check (price_rub >= 0),
  kcal integer not null check (kcal >= 0),
  status text not null default 'active' check (status in ('active', 'redeemed', 'cancelled', 'expired')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  check ((status = 'active') = (resolved_at is null)),
  foreign key (venue_id, menu_item_id) references menu_items (venue_id, id),
  foreign key (venue_id, deal_id) references deals (venue_id, id) on delete set null (deal_id)
);

create unique index bookings_active_code on bookings (venue_id, code) where status = 'active';
create unique index bookings_one_active_per_deal on bookings (user_id, deal_id)
  where status = 'active' and deal_id is not null;
create index bookings_user_created on bookings (user_id, created_at desc);
create index bookings_venue_created on bookings (venue_id, created_at desc);
create index bookings_expiring on bookings (expires_at) where status = 'active';
create index bookings_menu_item on bookings (menu_item_id);
create index bookings_deal on bookings (deal_id) where deal_id is not null;
create index bookings_offer on bookings (offer_id) where offer_id is not null;

create table chat_states (
  user_id bigint primary key references users (id) on delete cascade,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

create table processed_updates (
  key text primary key,
  processed_at timestamptz not null default now()
);

create index processed_updates_age on processed_updates (processed_at);
