alter table venues add column demo_source_id bigint references venues (id) on delete set null;
alter table venues add constraint venues_demo_source_only_demo check (demo_source_id is null or is_demo);
create index venues_demo_source on venues (demo_source_id) where demo_source_id is not null;
