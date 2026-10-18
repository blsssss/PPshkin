create table notifications (
  id bigserial primary key,
  user_id bigint not null references users (id) on delete cascade,
  kind text not null,
  dedup_key text not null unique,
  subject jsonb not null,
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'skipped', 'unreachable', 'failed', 'expired')),
  silent boolean not null default false,
  attempts integer not null default 0,
  send_after timestamptz not null,
  expires_at timestamptz not null,
  claimed_at timestamptz,
  sent_at timestamptz,
  message_id text,
  last_error text,
  created_at timestamptz not null
);

create index notifications_due on notifications (send_after) where status = 'pending';
create index notifications_user_created on notifications (user_id, created_at desc);
create index notifications_created on notifications (created_at);
