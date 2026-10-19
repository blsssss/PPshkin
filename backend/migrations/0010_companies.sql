create table companies (
  id bigserial primary key,
  kind text check (kind in ('legal', 'individual')),
  inn text unique check (inn ~ '^(\d{10}|\d{12})$'),
  ogrn text check (ogrn ~ '^(\d{13}|\d{15})$'),
  kpp text check (kpp ~ '^\d{9}$'),
  name text not null check (length(name) between 1 and 300),
  address text check (length(address) <= 500),
  okved text,
  registry_status text check (registry_status in ('ACTIVE', 'LIQUIDATING', 'LIQUIDATED', 'BANKRUPT', 'REORGANIZING')),
  registry_checked_at timestamptz,
  verification text not null default 'unverified'
    check (verification in ('unverified', 'pending', 'verified', 'rejected')),
  verification_note text check (length(verification_note) <= 500),
  verified_at timestamptz,
  created_by bigint references users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((inn is null) = (kind is null)),
  check (verification = 'unverified' or inn is not null)
);

create table memberships (
  id bigserial primary key,
  company_id bigint not null references companies (id) on delete cascade,
  user_id bigint not null references users (id) on delete cascade,
  role text not null check (role in ('owner', 'manager', 'cashier')),
  venue_id bigint references venues (id) on delete cascade,
  invited_by bigint references users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, user_id),
  check (role <> 'owner' or venue_id is null)
);
create index memberships_user on memberships (user_id);

create table company_invites (
  id bigserial primary key,
  company_id bigint not null references companies (id) on delete cascade,
  venue_id bigint references venues (id) on delete cascade,
  role text not null check (role in ('owner', 'manager', 'cashier')),
  token_hash text not null unique,
  created_by bigint references users (id) on delete set null,
  expires_at timestamptz not null,
  accepted_by bigint references users (id) on delete set null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (role <> 'owner' or venue_id is null)
);
create index company_invites_company on company_invites (company_id, created_at desc);

alter table venues add column company_id bigint references companies (id) on delete restrict;
create index venues_company on venues (company_id) where company_id is not null;
alter table bookings add column redeemed_by bigint references users (id) on delete set null;

with legacy as (
  select id, owner_id, name from venues where owner_id is not null and not is_demo
), created as (
  insert into companies (name, created_by)
  select name, owner_id from legacy
  returning id, created_by
), owners as (
  insert into memberships (company_id, user_id, role)
  select id, created_by, 'owner' from created
)
update venues v
   set company_id = c.id, owner_id = null
  from created c
 where v.owner_id = c.created_by and not v.is_demo;
