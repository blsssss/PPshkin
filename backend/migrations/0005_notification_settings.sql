create table notification_settings (
  user_id bigint primary key references users (id) on delete cascade,
  disabled_kinds text[] not null default '{}',
  quiet_from time default '22:00',
  quiet_until time default '09:00',
  updated_at timestamptz not null,
  check ((quiet_from is null) = (quiet_until is null))
);
