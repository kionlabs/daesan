alter table daesan.team_members
  add column if not exists commission_rate_text text,
  add column if not exists power_usage_text text;

drop function if exists daesan.get_team_baseline(text);
create function daesan.get_team_baseline(p_secret text)
returns table (
  member_id uuid, team_id uuid, team_name text, normalized_team text, source_key text,
  source_row_number integer, sequence_number text, member_name text, normalized_member text,
  contact text, normalized_phone text, category text, electronic_fax text, bank_name text,
  company_name text, normalized_company text, commission_rate_text text, power_usage_text text,
  commission_rate numeric, power_usage_kw numeric
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
    member.company_name, member.normalized_company, member.commission_rate_text, member.power_usage_text,
    member.commission_rate, member.power_usage_kw
  from daesan.team_members member
  join daesan.teams team on team.id = member.team_id
  where team.is_active
  order by member.source_row_number;
end;
$$;

revoke all on function daesan.get_team_baseline(text) from public, anon;
grant execute on function daesan.get_team_baseline(text) to authenticated;

alter function daesan.apply_team_import(text, jsonb) rename to apply_team_import_core;
revoke all on function daesan.apply_team_import_core(text, jsonb) from public, anon, authenticated;

create function daesan.apply_team_import(p_file_name text, p_rows jsonb)
returns table (batch_id uuid, new_count integer, changed_count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch_id uuid;
  v_new_count integer;
  v_changed_count integer;
  v_row jsonb;
  v_member_id uuid;
  v_source_key text;
begin
  select result.batch_id, result.new_count, result.changed_count
  into v_batch_id, v_new_count, v_changed_count
  from daesan.apply_team_import_core(p_file_name, p_rows) result;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    if v_row->>'status' = 'changed' then
      v_member_id := nullif(v_row->>'existingMemberId', '')::uuid;
    elsif v_row->>'status' = 'new' then
      v_source_key := private.normalize_team_text(v_row->>'teamName') || '|' ||
        private.normalize_team_text(v_row->>'memberName') || '|' ||
        private.normalize_team_phone(v_row->>'contact');
      select id into v_member_id from daesan.team_members where source_key = v_source_key order by created_at desc limit 1;
    else
      continue;
    end if;

    update daesan.team_members
    set commission_rate_text = nullif(v_row->>'commissionRateText', ''),
        power_usage_text = nullif(v_row->>'powerUsageText', ''),
        updated_at = now()
    where id = v_member_id;

    update daesan.team_import_changes
    set after_data = after_data || jsonb_build_object(
      'commissionRateText', nullif(v_row->>'commissionRateText', ''),
      'powerUsageText', nullif(v_row->>'powerUsageText', '')
    )
    where batch_id = v_batch_id and member_id = v_member_id;
  end loop;

  return query select v_batch_id, v_new_count, v_changed_count;
end;
$$;

revoke all on function daesan.apply_team_import(text, jsonb) from public, anon;
grant execute on function daesan.apply_team_import(text, jsonb) to authenticated;

notify pgrst, 'reload schema';
