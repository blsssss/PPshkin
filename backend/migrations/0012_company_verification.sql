alter table companies
  add column manager_name text check (length(manager_name) <= 300),
  add column submitted_by bigint references users (id) on delete set null;

update companies set submitted_by = created_by where verification <> 'unverified';

alter table audit_events add column company_id bigint references companies (id) on delete set null;
create index audit_events_company_created on audit_events (company_id, created_at desc) where company_id is not null;

alter table audit_events drop constraint audit_events_target_type_check;
alter table audit_events add constraint audit_events_target_type_check
  check (target_type in ('booking', 'deal', 'menu_item', 'menu_import', 'venue', 'staff', 'complaint', 'user', 'company'));
