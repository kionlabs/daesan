create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table if not exists hrmm.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  display_name text not null,
  role text not null default 'employee' check (role in ('owner', 'admin', 'schedule_manager', 'settlement_manager', 'employee', 'external_sales')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists hrmm.admin_invite_allowlist (
  email text primary key,
  display_name text not null,
  intended_role text not null default 'admin' check (intended_role in ('owner', 'admin', 'schedule_manager', 'settlement_manager', 'employee', 'external_sales')),
  invited_at timestamptz,
  claimed_by uuid references auth.users(id) on delete set null,
  claimed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists hrmm.team_import_batches (
  id uuid primary key default gen_random_uuid(),
  imported_by uuid not null references auth.users(id) on delete restrict,
  file_name text not null,
  applied_at timestamptz not null default now(),
  new_count integer not null default 0 check (new_count >= 0),
  changed_count integer not null default 0 check (changed_count >= 0),
  result text not null check (result in ('succeeded', 'failed')),
  error_message text,
  created_at timestamptz not null default now()
);

create table if not exists hrmm.team_import_changes (
  id bigint generated always as identity primary key,
  batch_id uuid not null references hrmm.team_import_batches(id) on delete restrict,
  member_id uuid not null references hrmm.team_members(id) on delete restrict,
  change_type text not null check (change_type in ('new', 'changed')),
  before_data jsonb,
  after_data jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_team_import_batches_imported_by on hrmm.team_import_batches(imported_by, applied_at desc);
create index if not exists idx_team_import_changes_batch_id on hrmm.team_import_changes(batch_id);

alter table hrmm.profiles enable row level security;
alter table hrmm.admin_invite_allowlist enable row level security;
alter table hrmm.team_import_batches enable row level security;
alter table hrmm.team_import_changes enable row level security;

revoke all on hrmm.profiles, hrmm.admin_invite_allowlist, hrmm.team_import_batches, hrmm.team_import_changes from anon, authenticated;
grant select on hrmm.profiles to authenticated;
grant select on hrmm.team_import_batches, hrmm.team_import_changes to authenticated;

create or replace function private.is_admin(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from hrmm.profiles
    where id = p_user_id
      and is_active
      and role in ('owner', 'admin')
  );
$$;

revoke all on function private.is_admin(uuid) from public, anon;
grant execute on function private.is_admin(uuid) to authenticated;

drop policy if exists "profiles_read_own_or_admin" on hrmm.profiles;
create policy "profiles_read_own_or_admin"
on hrmm.profiles for select to authenticated
using (id = (select auth.uid()) or (select private.is_admin()));

drop policy if exists "admins_read_import_batches" on hrmm.team_import_batches;
create policy "admins_read_import_batches"
on hrmm.team_import_batches for select to authenticated
using ((select private.is_admin()));

drop policy if exists "admins_read_import_changes" on hrmm.team_import_changes;
create policy "admins_read_import_changes"
on hrmm.team_import_changes for select to authenticated
using ((select private.is_admin()));

create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  allowed hrmm.admin_invite_allowlist%rowtype;
begin
  select * into allowed
  from hrmm.admin_invite_allowlist
  where lower(email) = lower(new.email);

  if found then
    insert into hrmm.profiles (id, email, display_name, role)
    values (new.id, lower(new.email), allowed.display_name, allowed.intended_role)
    on conflict (id) do update set
      email = excluded.email,
      display_name = excluded.display_name,
      role = excluded.role,
      is_active = true,
      updated_at = now();

    update hrmm.admin_invite_allowlist
    set claimed_by = new.id, claimed_at = now()
    where lower(email) = lower(new.email);
  end if;
  return new;
end;
$$;

revoke all on function private.handle_new_auth_user() from public, anon, authenticated;
drop trigger if exists on_auth_user_created_hrmm_profile on auth.users;
create trigger on_auth_user_created_hrmm_profile
after insert on auth.users
for each row execute function private.handle_new_auth_user();

create or replace function private.normalize_team_text(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(regexp_replace(trim(coalesce(p_value, '')), '\s+', ' ', 'g'));
$$;

create or replace function private.normalize_team_phone(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(coalesce(p_value, ''), '\D', '', 'g');
$$;

revoke all on function private.normalize_team_text(text), private.normalize_team_phone(text) from public, anon, authenticated;

alter table hrmm.team_members drop constraint if exists team_members_source_row_number_key;
create index if not exists idx_team_members_source_row_number on hrmm.team_members(source_row_number);

create or replace function hrmm.apply_team_import(p_file_name text, p_rows jsonb)
returns table (batch_id uuid, new_count integer, changed_count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_batch_id uuid := gen_random_uuid();
  v_row jsonb;
  v_team_id uuid;
  v_member_id uuid;
  v_before jsonb;
  v_after jsonb;
  v_new_count integer := 0;
  v_changed_count integer := 0;
  v_status text;
  v_team_name text;
  v_member_name text;
  v_contact text;
  v_category text;
  v_company_name text;
  v_normalized_team text;
  v_normalized_member text;
  v_normalized_phone text;
  v_normalized_company text;
begin
  if v_user_id is null or not private.is_admin(v_user_id) then
    raise exception 'admin access required' using errcode = '42501';
  end if;
  if nullif(trim(p_file_name), '') is null or length(p_file_name) > 255 then
    raise exception 'invalid file name' using errcode = '22023';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 or jsonb_array_length(p_rows) > 1000 then
    raise exception 'invalid import rows' using errcode = '22023';
  end if;

  insert into hrmm.team_import_batches (id, imported_by, file_name, result)
  values (v_batch_id, v_user_id, p_file_name, 'succeeded');

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_status := v_row->>'status';
    if v_status not in ('new', 'changed') then
      raise exception 'unsupported import status' using errcode = '22023';
    end if;

    v_team_name := trim(coalesce(v_row->>'teamName', ''));
    v_member_name := trim(coalesce(v_row->>'memberName', ''));
    v_contact := trim(coalesce(v_row->>'contact', ''));
    v_category := trim(coalesce(v_row->>'category', ''));
    v_company_name := trim(coalesce(v_row->>'companyName', ''));
    v_normalized_team := private.normalize_team_text(v_team_name);
    v_normalized_member := private.normalize_team_text(v_member_name);
    v_normalized_phone := private.normalize_team_phone(v_contact);
    v_normalized_company := private.normalize_team_text(v_company_name);

    if v_normalized_team = '' or v_normalized_member = '' or v_normalized_phone = '' then
      raise exception 'required team identity is missing' using errcode = '22023';
    end if;

    insert into hrmm.teams (team_name, normalized_name)
    values (v_team_name, v_normalized_team)
    on conflict (normalized_name) do update set
      team_name = excluded.team_name,
      is_active = true,
      updated_at = now()
    returning id into v_team_id;

    if v_status = 'new' then
      if exists (
        select 1 from hrmm.team_members
        where source_key = v_normalized_team || '|' || v_normalized_member || '|' || v_normalized_phone
      ) then
        raise exception 'team member already exists' using errcode = '23505';
      end if;
      insert into hrmm.team_members (
        team_id, source_row_number, source_key, member_name, normalized_name, contact, normalized_phone,
        category, company_name, normalized_company, commission_rate, power_usage_kw
      ) values (
        v_team_id, (v_row->>'rowNumber')::integer,
        v_normalized_team || '|' || v_normalized_member || '|' || v_normalized_phone,
        v_member_name, v_normalized_member, v_contact, v_normalized_phone,
        nullif(v_category, ''), nullif(v_company_name, ''), v_normalized_company,
        nullif(v_row->>'commissionRate', '')::numeric, nullif(v_row->>'powerUsageKw', '')::numeric
      ) returning id into v_member_id;
      v_new_count := v_new_count + 1;
      v_before := null;
    else
      v_member_id := nullif(v_row->>'existingMemberId', '')::uuid;
      select jsonb_build_object(
        'teamName', t.team_name, 'category', m.category, 'memberName', m.member_name,
        'contact', m.contact, 'companyName', m.company_name,
        'commissionRate', m.commission_rate, 'powerUsageKw', m.power_usage_kw
      ) into v_before
      from hrmm.team_members m join hrmm.teams t on t.id = m.team_id
      where m.id = v_member_id
      for update of m;
      if not found then
        raise exception 'existing team member not found' using errcode = 'P0002';
      end if;

      update hrmm.team_members set
        team_id = v_team_id,
        source_row_number = (v_row->>'rowNumber')::integer,
        source_key = v_normalized_team || '|' || v_normalized_member || '|' || v_normalized_phone,
        member_name = v_member_name,
        normalized_name = v_normalized_member,
        contact = v_contact,
        normalized_phone = v_normalized_phone,
        category = nullif(v_category, ''),
        company_name = nullif(v_company_name, ''),
        normalized_company = v_normalized_company,
        commission_rate = nullif(v_row->>'commissionRate', '')::numeric,
        power_usage_kw = nullif(v_row->>'powerUsageKw', '')::numeric,
        updated_at = now()
      where id = v_member_id;
      v_changed_count := v_changed_count + 1;
    end if;

    v_after := jsonb_build_object(
      'teamName', v_team_name, 'category', nullif(v_category, ''), 'memberName', v_member_name,
      'contact', v_contact, 'companyName', nullif(v_company_name, ''),
      'commissionRate', nullif(v_row->>'commissionRate', '')::numeric,
      'powerUsageKw', nullif(v_row->>'powerUsageKw', '')::numeric
    );
    insert into hrmm.team_import_changes (batch_id, member_id, change_type, before_data, after_data)
    values (v_batch_id, v_member_id, v_status, v_before, v_after);
  end loop;

  update hrmm.team_import_batches
  set new_count = v_new_count, changed_count = v_changed_count
  where id = v_batch_id;

  return query select v_batch_id, v_new_count, v_changed_count;
end;
$$;

revoke all on function hrmm.apply_team_import(text, jsonb) from public, anon;
grant execute on function hrmm.apply_team_import(text, jsonb) to authenticated;
