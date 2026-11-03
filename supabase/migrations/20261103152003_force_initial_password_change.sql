alter table daesan.profiles
  add column if not exists must_change_password boolean not null default true,
  add column if not exists password_changed_at timestamptz;

create or replace function private.is_admin(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from daesan.profiles
    where id = p_user_id
      and is_active
      and role in ('owner', 'admin')
      and not must_change_password
  );
$$;

revoke all on function private.is_admin(uuid) from public, anon;
grant execute on function private.is_admin(uuid) to authenticated;

create or replace function private.handle_auth_password_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Admin-created users receive a password before their first sign-in. Only a
  -- later password update from an established user session clears the flag.
  if old.encrypted_password is distinct from new.encrypted_password
     and new.last_sign_in_at is not null then
    update daesan.profiles
    set must_change_password = false,
        password_changed_at = now(),
        updated_at = now()
    where id = new.id;
  end if;
  return new;
end;
$$;

revoke all on function private.handle_auth_password_change() from public, anon, authenticated;

drop trigger if exists on_auth_user_password_changed_daesan_profile on auth.users;
create trigger on_auth_user_password_changed_daesan_profile
after update of encrypted_password on auth.users
for each row
when (old.encrypted_password is distinct from new.encrypted_password)
execute function private.handle_auth_password_change();
