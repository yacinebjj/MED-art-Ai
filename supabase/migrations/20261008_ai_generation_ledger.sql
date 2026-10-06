-- AI generation ledger (lib/ai/generation-ledger.ts): one content-addressed,
-- single-flight memory for every paid model call whose output is a pure
-- function of its input. `key` = sha256 of the model id + every message +
-- every output-shaping option, so two requests share a row only when the model
-- would have received byte-identical input.
--
-- status 'pending' + lease_until: an instance is generating this key right
-- now; peers wait for it instead of paying for the same tokens.
-- status 'ready' + value: the validated output, served for 0 tokens.
--
-- Service-role only (RLS on, no policies): rows can hold per-student outputs
-- (those keys include the user id), so students never read this table.
--
-- Until this file is run, the app works exactly as before (the ledger detects
-- the missing table and stays out of the way). Idempotent: safe to re-run.

create table if not exists public.ai_generation_ledger (
  key text primary key check (char_length(key) = 64),
  namespace text not null check (char_length(namespace) between 1 and 80),
  status text not null default 'pending' check (status in ('pending', 'ready')),
  value jsonb,
  lease_until timestamptz,
  output_chars integer,
  hits integer not null default 0,
  last_hit_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ai_generation_ledger_expires_idx on public.ai_generation_ledger (expires_at);
create index if not exists ai_generation_ledger_namespace_idx on public.ai_generation_ledger (namespace, created_at desc);

alter table public.ai_generation_ledger enable row level security;

-- Hit counter (observability: which namespaces actually save money).
create or replace function public.ai_ledger_record_hit(p_key text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.ai_generation_ledger
     set hits = hits + 1, last_hit_at = now()
   where key = p_key;
$$;

revoke all on function public.ai_ledger_record_hit(text) from public, anon, authenticated;

-- Savings report, one row per feature:
--   select * from public.ai_generation_ledger_stats;
create or replace view public.ai_generation_ledger_stats as
select
  namespace,
  count(*) filter (where status = 'ready') as stored_outputs,
  coalesce(sum(hits), 0) as calls_served_free,
  coalesce(sum(hits::bigint * coalesce(output_chars, 0)), 0) as output_chars_not_regenerated,
  max(last_hit_at) as last_hit_at
from public.ai_generation_ledger
group by namespace
order by calls_served_free desc;

revoke all on public.ai_generation_ledger_stats from public, anon, authenticated;

notify pgrst, 'reload schema';
