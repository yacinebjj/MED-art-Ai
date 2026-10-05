-- MONETIZATION v2 (2026-10-07): strict quotas, one-time free trial, and
-- pooled purchases (Promo 15/15, Groupe 5/5) with automatic refund requests.
--
-- Run once in the Supabase SQL editor. Idempotent: safe to run more than once.
-- Until it runs, lib/subscription.ts falls back to the previous quota logic
-- (it detects the missing columns / functions) — nothing breaks.

-- ---------------------------------------------------------------------------
-- 1. Plan ids (same set as lib/pricing.ts; promo_quad / promo_annual stay
--    valid for subscriptions bought before this change, they are no longer sold).
-- ---------------------------------------------------------------------------
alter table subscriptions drop constraint if exists subscriptions_plan_check;
alter table subscriptions add constraint subscriptions_plan_check
  check (plan in (
    'freemium',
    'individual_monthly', 'individual_quad', 'individual_annual',
    'group_monthly', 'group_quad', 'group_annual',
    'promo_monthly', 'promo_quad', 'promo_annual'
  ));

-- ---------------------------------------------------------------------------
-- 2. New usage counters. Monthly ones roll over with generations_period_start
--    (lib/subscription.ts ensureFreshUsagePeriod); free_* are LIFETIME (the
--    free trial is one-time) and are never reset. Nothing ever decrements a
--    counter when the student deletes something.
-- ---------------------------------------------------------------------------
alter table subscriptions add column if not exists courses_created_used integer not null default 0;
alter table subscriptions add column if not exists exams_used integer not null default 0;
alter table subscriptions add column if not exists syntheses_used integer not null default 0;
alter table subscriptions add column if not exists audio_used integer not null default 0;
alter table subscriptions add column if not exists audio_daily_used integer not null default 0;
alter table subscriptions add column if not exists audio_daily_reset_at timestamptz;
alter table subscriptions add column if not exists free_courses_used integer not null default 0;
alter table subscriptions add column if not exists free_messages_used integer not null default 0;

-- Existing free accounts: a course they already created counts as their free course.
update subscriptions s set free_courses_used = 1
where s.plan = 'freemium' and s.free_courses_used = 0
  and exists (select 1 from studio_courses c where c.user_id::text = s.user_id);

-- Atomic check-and-increment on a whitelisted counter. Returns the new value,
-- or NULL when the cap is reached (same contract as reserve_generations_used).
create or replace function reserve_usage_counter(p_user_id text, p_column text, p_cap integer)
returns integer
language plpgsql
as $$
declare
  v_new integer;
begin
  if p_column not in ('courses_created_used', 'exams_used', 'syntheses_used', 'free_courses_used', 'free_messages_used') then
    raise exception 'reserve_usage_counter: unknown counter %', p_column;
  end if;
  execute format(
    'update subscriptions set %1$I = %1$I + 1, updated_at = now() where user_id = $1 and %1$I < $2 returning %1$I',
    p_column
  ) into v_new using p_user_id, p_cap;
  return v_new;
end;
$$;

-- Only for a generation that FAILED (never for a deletion).
create or replace function refund_usage_counter(p_user_id text, p_column text)
returns void
language plpgsql
as $$
begin
  if p_column not in ('courses_created_used', 'exams_used', 'syntheses_used', 'free_courses_used', 'free_messages_used') then
    raise exception 'refund_usage_counter: unknown counter %', p_column;
  end if;
  execute format('update subscriptions set %1$I = greatest(%1$I - 1, 0), updated_at = now() where user_id = $1', p_column)
    using p_user_id;
end;
$$;

-- Audio → Smart Notes: 1 per day AND 30 per month, both checked in one statement.
create or replace function reserve_audio_session(p_user_id text, p_daily_cap integer, p_monthly_cap integer)
returns integer
language sql
as $$
  update subscriptions
  set audio_daily_used = audio_daily_used + 1, audio_used = audio_used + 1, updated_at = now()
  where user_id = p_user_id and audio_daily_used < p_daily_cap and audio_used < p_monthly_cap
  returning audio_used;
$$;

create or replace function refund_audio_session(p_user_id text)
returns void
language sql
as $$
  update subscriptions
  set audio_daily_used = greatest(audio_daily_used - 1, 0), audio_used = greatest(audio_used - 1, 0), updated_at = now()
  where user_id = p_user_id;
$$;

-- One quota unit per recorded lecture (an upload id), however many chunks it has.
create table if not exists audio_quota_sessions (
  user_id uuid not null references auth.users (id) on delete cascade,
  upload_id text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, upload_id)
);
alter table audio_quota_sessions enable row level security;
drop policy if exists "Deny all client access" on audio_quota_sessions;
create policy "Deny all client access" on audio_quota_sessions for all using (false);

-- ---------------------------------------------------------------------------
-- 3. Pooled purchases.
--   mode 'pooled' : every member pays their own share; the subscription
--                   starts for everyone when paid members = size (Promo 15,
--                   Groupe 5). Not full after 7 days → refund requests.
--   mode 'leader' : one student paid for all 5 seats; the 4 others join with
--                   the invite code, no payment.
-- ---------------------------------------------------------------------------
create table if not exists billing_pools (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('promo', 'group')),
  mode text not null check (mode in ('pooled', 'leader')),
  cycle text not null check (cycle in ('monthly', 'quad', 'annual')),
  plan text not null,
  size integer not null check (size in (5, 15)),
  price_per_member integer not null,
  invite_code text not null unique,
  created_by uuid not null references auth.users (id) on delete cascade,
  status text not null default 'open' check (status in ('open', 'complete', 'expired')),
  expires_at timestamptz not null,
  completed_at timestamptz,
  period_end timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists billing_pools_open_idx on billing_pools (status, expires_at);

create table if not exists billing_pool_members (
  id uuid primary key default gen_random_uuid(),
  pool_id uuid not null references billing_pools (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null check (status in ('holding', 'paid', 'activated', 'refund_pending', 'refunded', 'released')),
  chargily_checkout_id text unique,
  amount integer not null default 0,
  hold_expires_at timestamptz,
  paid_at timestamptz,
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pool_id, user_id)
);
create index if not exists billing_pool_members_user_idx on billing_pool_members (user_id, status);

create table if not exists billing_refund_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  pool_id uuid references billing_pools (id) on delete set null,
  member_id uuid unique references billing_pool_members (id) on delete set null,
  chargily_checkout_id text,
  amount integer not null,
  reason text not null check (reason in ('pool_expired', 'pool_overflow')),
  status text not null default 'pending' check (status in ('pending', 'refunded')),
  created_at timestamptz not null default now(),
  refunded_at timestamptz,
  refunded_by text,
  note text
);
create index if not exists billing_refund_requests_status_idx on billing_refund_requests (status, created_at);

alter table billing_pools enable row level security;
alter table billing_pool_members enable row level security;
alter table billing_refund_requests enable row level security;
drop policy if exists "Deny all client access" on billing_pools;
create policy "Deny all client access" on billing_pools for all using (false);
drop policy if exists "Deny all client access" on billing_pool_members;
create policy "Deny all client access" on billing_pool_members for all using (false);
drop policy if exists "Deny all client access" on billing_refund_requests;
create policy "Deny all client access" on billing_refund_requests for all using (false);

-- Holds one seat for a member about to pay (30 min), so a pool can never
-- take more payments than it has seats. Returns 'held' | 'already_paid' |
-- 'full' | 'closed'.
create or replace function billing_pool_hold_seat(p_pool_id uuid, p_user_id uuid, p_hold_minutes integer)
returns text
language plpgsql
as $$
declare
  v_pool billing_pools%rowtype;
  v_member billing_pool_members%rowtype;
  v_taken integer;
begin
  select * into v_pool from billing_pools where id = p_pool_id for update;
  if not found or v_pool.mode <> 'pooled' or v_pool.status <> 'open' or v_pool.expires_at <= now() then
    return 'closed';
  end if;
  select * into v_member from billing_pool_members where pool_id = p_pool_id and user_id = p_user_id;
  if found and v_member.status in ('paid', 'activated') then
    return 'already_paid';
  end if;
  select count(*) into v_taken from billing_pool_members
  where pool_id = p_pool_id and user_id <> p_user_id
    and (status in ('paid', 'activated') or (status = 'holding' and hold_expires_at > now()));
  if v_taken >= v_pool.size then
    return 'full';
  end if;
  insert into billing_pool_members (pool_id, user_id, status, hold_expires_at, amount)
  values (p_pool_id, p_user_id, 'holding', now() + make_interval(mins => p_hold_minutes), v_pool.price_per_member)
  on conflict (pool_id, user_id) do update
    set status = 'holding', hold_expires_at = excluded.hold_expires_at, updated_at = now();
  return 'held';
end;
$$;

create or replace function billing_pool_attach_checkout(p_pool_id uuid, p_user_id uuid, p_checkout_id text)
returns void
language sql
as $$
  update billing_pool_members set chargily_checkout_id = p_checkout_id, updated_at = now()
  where pool_id = p_pool_id and user_id = p_user_id and status = 'holding';
$$;

-- Called by the Chargily webhook (checkout.paid). Returns
-- 'paid' | 'complete' | 'refund' | 'duplicate' | 'unknown'.
-- 'complete' = this payment filled the last seat: the caller activates
-- every paid member. 'refund' = the pool was closed / full when the money
-- arrived: a refund request is recorded, nothing is activated.
create or replace function billing_pool_mark_paid(p_pool_id uuid, p_user_id uuid, p_checkout_id text, p_amount integer)
returns text
language plpgsql
as $$
declare
  v_pool billing_pools%rowtype;
  v_member billing_pool_members%rowtype;
  v_paid integer;
begin
  select * into v_pool from billing_pools where id = p_pool_id for update;
  if not found then
    return 'unknown';
  end if;
  select * into v_member from billing_pool_members where pool_id = p_pool_id and user_id = p_user_id for update;
  if found and v_member.status in ('paid', 'activated', 'refund_pending', 'refunded') then
    return 'duplicate';
  end if;
  if not found then
    insert into billing_pool_members (pool_id, user_id, status, amount)
    values (p_pool_id, p_user_id, 'holding', p_amount)
    returning * into v_member;
  end if;

  select count(*) into v_paid from billing_pool_members where pool_id = p_pool_id and status in ('paid', 'activated');

  if v_pool.status <> 'open' or v_pool.expires_at <= now() or v_paid >= v_pool.size then
    update billing_pool_members
    set status = 'refund_pending', chargily_checkout_id = p_checkout_id, amount = p_amount, paid_at = now(), updated_at = now()
    where id = v_member.id;
    insert into billing_refund_requests (user_id, pool_id, member_id, chargily_checkout_id, amount, reason)
    values (p_user_id, p_pool_id, v_member.id, p_checkout_id, p_amount,
            case when v_paid >= v_pool.size then 'pool_overflow' else 'pool_expired' end)
    on conflict (member_id) do nothing;
    return 'refund';
  end if;

  update billing_pool_members
  set status = 'paid', chargily_checkout_id = p_checkout_id, amount = p_amount, paid_at = now(), hold_expires_at = null, updated_at = now()
  where id = v_member.id;

  if v_paid + 1 >= v_pool.size then
    update billing_pools set status = 'complete', completed_at = now() where id = p_pool_id;
    return 'complete';
  end if;
  return 'paid';
end;
$$;

-- Closes every pooled purchase that missed its 7-day deadline: paid members
-- get an automatic refund request, holds are released. Returns pools closed.
create or replace function billing_pools_expire()
returns integer
language plpgsql
as $$
declare
  v_count integer := 0;
  v_pool record;
begin
  for v_pool in
    select id from billing_pools where status = 'open' and mode = 'pooled' and expires_at <= now() for update skip locked
  loop
    update billing_pools set status = 'expired' where id = v_pool.id;
    insert into billing_refund_requests (user_id, pool_id, member_id, chargily_checkout_id, amount, reason)
    select m.user_id, m.pool_id, m.id, m.chargily_checkout_id, m.amount, 'pool_expired'
    from billing_pool_members m where m.pool_id = v_pool.id and m.status = 'paid'
    on conflict (member_id) do nothing;
    update billing_pool_members set status = 'refund_pending', updated_at = now() where pool_id = v_pool.id and status = 'paid';
    update billing_pool_members set status = 'released', updated_at = now() where pool_id = v_pool.id and status = 'holding';
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Leader mode: a seat taken with the invite code (no payment). Returns
-- 'joined' | 'already' | 'full' | 'closed'.
create or replace function billing_pool_join_leader(p_pool_id uuid, p_user_id uuid)
returns text
language plpgsql
as $$
declare
  v_pool billing_pools%rowtype;
  v_taken integer;
begin
  select * into v_pool from billing_pools where id = p_pool_id for update;
  if not found or v_pool.mode <> 'leader' or v_pool.status <> 'complete' or v_pool.period_end is null or v_pool.period_end <= now() then
    return 'closed';
  end if;
  if exists (select 1 from billing_pool_members where pool_id = p_pool_id and user_id = p_user_id) then
    return 'already';
  end if;
  select count(*) into v_taken from billing_pool_members where pool_id = p_pool_id and status = 'activated';
  if v_taken >= v_pool.size then
    return 'full';
  end if;
  insert into billing_pool_members (pool_id, user_id, status, activated_at) values (p_pool_id, p_user_id, 'activated', now());
  return 'joined';
end;
$$;

revoke execute on function reserve_usage_counter(text, text, integer) from public, anon, authenticated;
revoke execute on function refund_usage_counter(text, text) from public, anon, authenticated;
revoke execute on function reserve_audio_session(text, integer, integer) from public, anon, authenticated;
revoke execute on function refund_audio_session(text) from public, anon, authenticated;
revoke execute on function billing_pool_hold_seat(uuid, uuid, integer) from public, anon, authenticated;
revoke execute on function billing_pool_attach_checkout(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function billing_pool_mark_paid(uuid, uuid, text, integer) from public, anon, authenticated;
revoke execute on function billing_pools_expire() from public, anon, authenticated;
revoke execute on function billing_pool_join_leader(uuid, uuid) from public, anon, authenticated;

-- The server (service role) is the only caller.
grant execute on function reserve_usage_counter(text, text, integer) to service_role;
grant execute on function refund_usage_counter(text, text) to service_role;
grant execute on function reserve_audio_session(text, integer, integer) to service_role;
grant execute on function refund_audio_session(text) to service_role;
grant execute on function billing_pool_hold_seat(uuid, uuid, integer) to service_role;
grant execute on function billing_pool_attach_checkout(uuid, uuid, text) to service_role;
grant execute on function billing_pool_mark_paid(uuid, uuid, text, integer) to service_role;
grant execute on function billing_pools_expire() to service_role;
grant execute on function billing_pool_join_leader(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
