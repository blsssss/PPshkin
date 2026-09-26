alter table offers add column decline_reason text check (decline_reason in ('not_today', 'dislike'));
