-- Pricing v4 (lib/pricing.ts): the Cohorte plans are no longer sold; the tier
-- id "promo" is now the Groupe de 10 (exactly 10 seats, each member pays
-- their share, any duration).
--
-- billing_pools.size accepted 5, 15 or 40: a 10-seat pool would be rejected
-- at insert. 15 and 40 stay allowed so pools opened before v4 keep their own
-- size until they complete or expire. Prices are stored per pool
-- (price_per_member), so open pools keep the price they were created with.
--
-- Idempotent: safe to re-run.

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

notify pgrst, 'reload schema';
