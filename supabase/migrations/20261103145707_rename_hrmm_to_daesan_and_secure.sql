-- Add `daesan` to the project's exposed Data API schemas before applying this migration.
create schema if not exists daesan;

alter table hrmm.staffs set schema daesan;
alter table hrmm.markets set schema daesan;
alter table hrmm.schedules set schema daesan;
alter table hrmm.revenues set schema daesan;
alter table hrmm.teams set schema daesan;
alter table hrmm.team_members set schema daesan;
alter table hrmm.team_compare_config set schema daesan;
alter table hrmm.profiles set schema daesan;
alter table hrmm.admin_invite_allowlist set schema daesan;
alter table hrmm.team_import_batches set schema daesan;
alter table hrmm.team_import_changes set schema daesan;

alter function hrmm.get_team_baseline(text) set schema daesan;
alter function hrmm.apply_team_import(text, jsonb) set schema daesan;

do $$
declare
  sequence_record record;
begin
  for sequence_record in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'hrmm' and c.relkind = 'S'
  loop
    execute format('alter sequence hrmm.%I set schema daesan', sequence_record.relname);
  end loop;
end;
$$;

-- Rebuild functions whose stored bodies contain the old qualified schema name.
do $$
declare
  function_record record;
  definition text;
begin
  for function_record in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('private', 'daesan')
      and p.prokind = 'f'
      and pg_get_functiondef(p.oid) like '%hrmm.%'
  loop
    definition := replace(pg_get_functiondef(function_record.oid), 'hrmm.', 'daesan.');
    execute definition;
  end loop;
end;
$$;

revoke all on schema daesan from public, anon;
grant usage on schema daesan to authenticated, service_role;

alter table daesan.staffs enable row level security;
alter table daesan.markets enable row level security;
alter table daesan.schedules enable row level security;
alter table daesan.revenues enable row level security;

drop policy if exists "Allow public read access to revenues" on daesan.revenues;
drop policy if exists "Allow public write access to revenues" on daesan.revenues;

drop policy if exists "admins_manage_staffs" on daesan.staffs;
create policy "admins_manage_staffs"
on daesan.staffs for all to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

drop policy if exists "admins_manage_markets" on daesan.markets;
create policy "admins_manage_markets"
on daesan.markets for all to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

drop policy if exists "admins_manage_schedules" on daesan.schedules;
create policy "admins_manage_schedules"
on daesan.schedules for all to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

drop policy if exists "admins_manage_revenues" on daesan.revenues;
create policy "admins_manage_revenues"
on daesan.revenues for all to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

revoke all on all tables in schema daesan from anon;
revoke all on all sequences in schema daesan from anon;
revoke execute on all functions in schema daesan from anon;

grant select, insert, update, delete on daesan.staffs, daesan.markets, daesan.schedules, daesan.revenues to authenticated;
grant usage, select on all sequences in schema daesan to authenticated;
grant select on daesan.profiles, daesan.team_import_batches, daesan.team_import_changes to authenticated;
grant execute on function daesan.get_team_baseline(text) to authenticated;
grant execute on function daesan.apply_team_import(text, jsonb) to authenticated;

alter default privileges for role postgres in schema daesan
  revoke select, insert, update, delete on tables from anon, authenticated;
alter default privileges for role postgres in schema daesan
  revoke usage, select on sequences from anon, authenticated;
alter default privileges for role postgres in schema daesan
  revoke execute on functions from public, anon, authenticated;

notify pgrst, 'reload schema';
