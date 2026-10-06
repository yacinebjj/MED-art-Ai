-- Pricing v3 (lib/pricing.ts): the Cohorte (tier id "promo") is 40 seats and
-- is sold on every duration (1 month, 4 months, the 8-month study year).
--
-- billing_pools.size only accepted 5 or 15: a 40-seat Cohorte pool would be
-- rejected at insert. 15 stays allowed so pools opened before v3 keep their
-- own size until they complete or expire. The cycle check already allows
-- 'quad' and 'annual' for every kind; prices are stored per pool
-- (price_per_member), so open pools keep the price they were created with.
--
-- Idempotent: safe to re-run.

do $$
declare
  v_constraint text;
begin
  -- The size check was declared inline, so its name is generated: find it.
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
  add constraint billing_pools_size_check check (size in (5, 15, 40));

notify pgrst, 'reload schema';
