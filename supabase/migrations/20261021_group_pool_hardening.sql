-- GROUP POOL HARDENING (2026-10-21) — Groupe de 10 launch.
--
-- Run once in the Supabase SQL editor. Idempotent: safe to run more than once.
-- The app keeps working before it runs (lib/billing-pools.ts falls back), but
-- a Groupe de 10 cannot be CREATED until section 1 has run.
--
--  1. billing_pools.size accepts 10 (same fix as 20261011_pricing_v4_group_10.sql,
--     repeated here in case that one was never applied): without it every
--     « Lancer le Groupe de 10 » fails with « Impossible de créer le groupe ».
--  2. billing_refund_requests.reason accepts the two automatic refunds the app
--     now records: a second payment of an already-paid member, and a payment
--     for a pool that no longer exists.
--  3. Every account gets its subscriptions row (the signup trigger normally
--     creates it): without it the billing page shows « Ta consommation n'est
--     pas disponible ».
--  4. Deadline grace: a member who reserved a seat before the 7-day deadline
--     can still finish paying (the seat is held SEAT_HOLD_MINUTES, 35 min,
--     plus 10 minutes for a late Edahabia / CIB confirmation); the pool is
--     only closed once no reservation is running or just ended.

-- ---------------------------------------------------------------------------
-- 1. Pool sizes: 5 (Groupe), 10 (Groupe de 10), 15 / 40 (older pools).
-- ---------------------------------------------------------------------------
do $$
declare
  v_constraint text;
begin
  for v_constraint in
    select con.conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
     where rel.relname = 'billing_pools'
       and con.contype = 'c'
       and pg_get_constraintdef(con.oid) ilike '%size%'
  loop
    execute format('alter table public.billing_pools drop constraint %I', v_constraint);
  end loop;
end $$;

alter table public.billing_pools
  add constraint billing_pools_size_check check (size in (5, 10, 15, 40));

-- ---------------------------------------------------------------------------
-- 2. Refund reasons.
-- ---------------------------------------------------------------------------
do $$
declare
  v_constraint text;
begin
  for v_constraint in
    select con.conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
     where rel.relname = 'billing_refund_requests'
       and con.contype = 'c'
       and pg_get_constraintdef(con.oid) ilike '%reason%'
  loop
    execute format('alter table public.billing_refund_requests drop constraint %I', v_constraint);
  end loop;
end $$;

alter table public.billing_refund_requests
  add constraint billing_refund_requests_reason_check
  check (reason in ('pool_expired', 'pool_overflow', 'duplicate_payment', 'orphan_payment'));

-- One refund request per extra payment is looked up by checkout id.
create index if not exists billing_refund_requests_checkout_idx on public.billing_refund_requests (chargily_checkout_id);

-- ---------------------------------------------------------------------------
-- 3. Missing subscriptions rows (same values as the signup trigger).
-- ---------------------------------------------------------------------------
insert into public.subscriptions (user_id, email, plan, status, period_start, generations_used, generations_period_start, highlight_messages_used, chat_messages_used)
select u.id::text, u.email, 'freemium', 'active', now(), 0, now(), 0, 0
from auth.users u
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Deadline grace for payments already in progress.
-- ---------------------------------------------------------------------------

-- Closes every pooled purchase past its deadline once no seat reservation is
-- still running (or ended less than 10 minutes ago — the same grace
-- billing_pool_mark_paid gives a confirmation that lands just after the
-- hold): paid members get an automatic refund request, holds are released.
-- Returns pools closed.
create or replace function billing_pools_expire()
returns integer
language plpgsql
as $$
declare
  v_count integer := 0;
  v_pool record;
begin
  for v_pool in
    select p.id
      from billing_pools p
     where p.status = 'open'
       and p.mode = 'pooled'
       and p.expires_at <= now()
       and not exists (
         select 1 from billing_pool_members m
          where m.pool_id = p.id
            and m.status = 'holding'
            and m.hold_expires_at is not null
            and m.hold_expires_at > now() - interval '10 minutes'
       )
    for update of p skip locked
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

-- Called by the Chargily webhook (checkout.paid). Returns
-- 'paid' | 'complete' | 'refund' | 'duplicate' | 'unknown' (unchanged contract).
-- New: past the deadline, a member who still held a seat (reserved before the
-- deadline, hold running or ended less than 10 minutes ago) is accepted while
-- the pool is open, instead of being refunded.
create or replace function billing_pool_mark_paid(p_pool_id uuid, p_user_id uuid, p_checkout_id text, p_amount integer)
returns text
language plpgsql
as $$
declare
  v_pool billing_pools%rowtype;
  v_member billing_pool_members%rowtype;
  v_paid integer;
  v_had_seat boolean := false;
begin
  select * into v_pool from billing_pools where id = p_pool_id for update;
  if not found then
    return 'unknown';
  end if;
  select * into v_member from billing_pool_members where pool_id = p_pool_id and user_id = p_user_id for update;
  if found and v_member.status in ('paid', 'activated', 'refund_pending', 'refunded') then
    return 'duplicate';
  end if;
  if found then
    v_had_seat := v_member.status = 'holding'
      and v_member.hold_expires_at is not null
      and v_member.hold_expires_at > now() - interval '10 minutes';
  else
    insert into billing_pool_members (pool_id, user_id, status, amount)
    values (p_pool_id, p_user_id, 'holding', p_amount)
    returning * into v_member;
  end if;

  select count(*) into v_paid from billing_pool_members where pool_id = p_pool_id and status in ('paid', 'activated');

  if v_pool.status <> 'open' or (v_pool.expires_at <= now() and not v_had_seat) or v_paid >= v_pool.size then
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

-- Same privileges as before: only the server (service role) calls them.
revoke execute on function billing_pools_expire() from public, anon, authenticated;
revoke execute on function billing_pool_mark_paid(uuid, uuid, text, integer) from public, anon, authenticated;
grant execute on function billing_pools_expire() to service_role;
grant execute on function billing_pool_mark_paid(uuid, uuid, text, integer) to service_role;

notify pgrst, 'reload schema';
