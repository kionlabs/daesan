alter table daesan.team_members
  add column if not exists sequence_number text,
  add column if not exists electronic_fax text,
  add column if not exists bank_name text;

update daesan.team_members
set sequence_number = (source_row_number - 4)::text
where sequence_number is null;

drop function if exists daesan.get_team_baseline(text);
create function daesan.get_team_baseline(p_secret text)
returns table (
  member_id uuid, team_id uuid, team_name text, normalized_team text, source_key text,
  source_row_number integer, sequence_number text, member_name text, normalized_member text,
  contact text, normalized_phone text, category text, electronic_fax text, bank_name text,
  company_name text, normalized_company text, commission_rate numeric, power_usage_kw numeric
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_admin(auth.uid()) then
    raise exception 'admin access required' using errcode = '42501';
  end if;
  if p_secret is null or not exists (
    select 1 from daesan.team_compare_config config
    where config.singleton
      and config.secret_hash = encode(extensions.digest(p_secret, 'sha256'), 'hex')
  ) then
    raise exception 'comparison access denied' using errcode = '42501';
  end if;

  return query
  select member.id, team.id, team.team_name, team.normalized_name, member.source_key,
    member.source_row_number, member.sequence_number, member.member_name, member.normalized_name,
    member.contact, member.normalized_phone, member.category, member.electronic_fax, member.bank_name,
    member.company_name, member.normalized_company, member.commission_rate, member.power_usage_kw
  from daesan.team_members member
  join daesan.teams team on team.id = member.team_id
  where team.is_active
  order by member.source_row_number;
end;
$$;

revoke all on function daesan.get_team_baseline(text) from public, anon;
grant execute on function daesan.get_team_baseline(text) to authenticated;

create or replace function daesan.apply_team_import(p_file_name text, p_rows jsonb)
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

  insert into daesan.team_import_batches (id, imported_by, file_name, result)
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

    insert into daesan.teams (team_name, normalized_name)
    values (v_team_name, v_normalized_team)
    on conflict (normalized_name) do update set
      team_name = excluded.team_name,
      is_active = true,
      updated_at = now()
    returning id into v_team_id;

    if v_status = 'new' then
      if exists (select 1 from daesan.team_members where source_key = v_normalized_team || '|' || v_normalized_member || '|' || v_normalized_phone) then
        raise exception 'team member already exists' using errcode = '23505';
      end if;
      insert into daesan.team_members (
        team_id, source_row_number, sequence_number, source_key, member_name, normalized_name,
        contact, normalized_phone, category, electronic_fax, bank_name, company_name,
        normalized_company, commission_rate, power_usage_kw
      ) values (
        v_team_id, (v_row->>'rowNumber')::integer, nullif(v_row->>'sequenceNumber', ''),
        v_normalized_team || '|' || v_normalized_member || '|' || v_normalized_phone,
        v_member_name, v_normalized_member, v_contact, v_normalized_phone, nullif(v_category, ''),
        nullif(v_row->>'electronicFax', ''), nullif(v_row->>'bankName', ''), nullif(v_company_name, ''),
        v_normalized_company, nullif(v_row->>'commissionRate', '')::numeric,
        nullif(v_row->>'powerUsageKw', '')::numeric
      ) returning id into v_member_id;
      v_new_count := v_new_count + 1;
      v_before := null;
    else
      v_member_id := nullif(v_row->>'existingMemberId', '')::uuid;
      select jsonb_build_object(
        'sequenceNumber', m.sequence_number, 'teamName', t.team_name, 'category', m.category,
        'memberName', m.member_name, 'contact', m.contact, 'electronicFax', m.electronic_fax,
        'bankName', m.bank_name, 'companyName', m.company_name, 'commissionRate', m.commission_rate,
        'powerUsageKw', m.power_usage_kw
      ) into v_before
      from daesan.team_members m join daesan.teams t on t.id = m.team_id
      where m.id = v_member_id
      for update of m;
      if not found then
        raise exception 'existing team member not found' using errcode = 'P0002';
      end if;

      update daesan.team_members set
        team_id = v_team_id,
        source_row_number = (v_row->>'rowNumber')::integer,
        sequence_number = nullif(v_row->>'sequenceNumber', ''),
        source_key = v_normalized_team || '|' || v_normalized_member || '|' || v_normalized_phone,
        member_name = v_member_name,
        normalized_name = v_normalized_member,
        contact = v_contact,
        normalized_phone = v_normalized_phone,
        category = nullif(v_category, ''),
        electronic_fax = nullif(v_row->>'electronicFax', ''),
        bank_name = nullif(v_row->>'bankName', ''),
        company_name = nullif(v_company_name, ''),
        normalized_company = v_normalized_company,
        commission_rate = nullif(v_row->>'commissionRate', '')::numeric,
        power_usage_kw = nullif(v_row->>'powerUsageKw', '')::numeric,
        updated_at = now()
      where id = v_member_id;
      v_changed_count := v_changed_count + 1;
    end if;

    v_after := jsonb_build_object(
      'sequenceNumber', nullif(v_row->>'sequenceNumber', ''), 'teamName', v_team_name,
      'category', nullif(v_category, ''), 'memberName', v_member_name, 'contact', v_contact,
      'electronicFax', nullif(v_row->>'electronicFax', ''), 'bankName', nullif(v_row->>'bankName', ''),
      'companyName', nullif(v_company_name, ''), 'commissionRate', nullif(v_row->>'commissionRate', '')::numeric,
      'powerUsageKw', nullif(v_row->>'powerUsageKw', '')::numeric
    );
    insert into daesan.team_import_changes (batch_id, member_id, change_type, before_data, after_data)
    values (v_batch_id, v_member_id, v_status, v_before, v_after);
  end loop;

  update daesan.team_import_batches
  set new_count = v_new_count, changed_count = v_changed_count
  where id = v_batch_id;

  return query select v_batch_id, v_new_count, v_changed_count;
end;
$$;

revoke all on function daesan.apply_team_import(text, jsonb) from public, anon;
grant execute on function daesan.apply_team_import(text, jsonb) to authenticated;

notify pgrst, 'reload schema';
