-- DEVICE LIMIT (2026-10-11): one account can be used on at most 2 devices.
--
-- Run once in the Supabase SQL editor. Idempotent: safe to run more than once.
-- Until it runs, lib/devices.ts detects the missing table / functions and
-- lets every request through — nothing breaks.
--
-- A "device" is a browser profile: the httpOnly `medart_device` cookie
-- (random UUID) set on the first authenticated request. Signing out frees
-- the slot. From a third device the student sees their two devices and can
-- replace one — at most once per 24 h, so a shared account cannot just keep
-- kicking the other person out.

create table if not exists user_devices (
  user_id text not null,
  device_id text not null,
  label text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (user_id, device_id)
);

create table if not exists user_device_replacements (
  id bigserial primary key,
  user_id text not null,
  replaced_device_id text not null,
  new_device_id text not null,
  created_at timestamptz not null default now()
);
create index if not exists user_device_replacements_user_idx on user_device_replacements (user_id, created_at desc);

alter table user_devices enable row level security;
alter table user_device_replacements enable row level security;
-- No policies: only the server (service role) reads or writes these tables.

-- Registers / refreshes this device. Returns 'ok' (registered, already or
-- now) or 'limit' (p_max other devices already registered). The advisory
-- lock serializes two NEW devices of the same account signing in at the
-- same moment, so they cannot both take the last slot.
create or replace function claim_user_device(p_user_id text, p_device_id text, p_label text, p_max integer)
returns text
language plpgsql
as $$
declare
  v_count integer;
begin
  perform pg_advisory_xact_lock(hashtext('user_devices:' || p_user_id));
  update user_devices set last_seen_at = now(), label = coalesce(p_label, label)
    where user_id = p_user_id and device_id = p_device_id;
  if found then
    return 'ok';
  end if;
  select count(*) into v_count from user_devices where user_id = p_user_id;
  if v_count >= p_max then
    return 'limit';
  end if;
  insert into user_devices (user_id, device_id, label) values (p_user_id, p_device_id, p_label);
  return 'ok';
end;
$$;

-- Replaces p_old_device_id by this device. Returns 'ok', 'cooldown' (a
-- replacement already happened within p_cooldown_hours), or 'not_found'.
create or replace function replace_user_device(p_user_id text, p_old_device_id text, p_new_device_id text, p_label text, p_cooldown_hours integer)
returns text
language plpgsql
as $$
begin
  perform pg_advisory_xact_lock(hashtext('user_devices:' || p_user_id));
  if exists (
    select 1 from user_device_replacements
    where user_id = p_user_id and created_at > now() - make_interval(hours => p_cooldown_hours)
  ) then
    return 'cooldown';
  end if;
  delete from user_devices where user_id = p_user_id and device_id = p_old_device_id;
  if not found then
    return 'not_found';
  end if;
  insert into user_devices (user_id, device_id, label) values (p_user_id, p_new_device_id, p_label)
    on conflict (user_id, device_id) do update set last_seen_at = now();
  insert into user_device_replacements (user_id, replaced_device_id, new_device_id) values (p_user_id, p_old_device_id, p_new_device_id);
  return 'ok';
end;
$$;

revoke execute on function claim_user_device(text, text, text, integer) from public, anon, authenticated;
revoke execute on function replace_user_device(text, text, text, text, integer) from public, anon, authenticated;
grant execute on function claim_user_device(text, text, text, integer) to service_role;
grant execute on function replace_user_device(text, text, text, text, integer) to service_role;

notify pgrst, 'reload schema';
