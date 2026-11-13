-- "Examen de Module" — regeneration allowance (max 5 per student, all modules).
--
-- schema.sql declared these objects but no migration ever shipped them, so a
-- database created from migrations is missing them and every "Régénérer"
-- fails with: Could not find the function
-- public.reserve_module_exam_regenerate(p_cap, p_user_id) in the schema cache.
--
-- Idempotent: safe to run more than once.

alter table public.profiles
  add column if not exists module_exam_regenerations_used integer not null default 0;

-- Atomically reserves one regeneration. Returns the post-increment count, or
-- NULL (no row) when the student already reached p_cap.
--
-- FUNCTION  reserve_module_exam_regenerate(p_user_id uuid, p_cap integer)
--             → integer
--   Purpose     Consumes one « Examen de Module » regeneration from the
--               student's allowance, atomically: a single UPDATE that adds 1
--               to profiles.module_exam_regenerations_used only while it is
--               below p_cap.
--   Returns     The new count. No value (NULL) when nothing was updated: the
--               cap is reached, or p_user_id has no profiles row.
--   Runs as     the caller (SECURITY INVOKER); language sql;
--               search_path = public.
--   Privileges  In this file: EXECUTE revoked from public, anon,
--               authenticated; EXECUTE granted to service_role.
--   Called by   lib/exam-generation.ts
--   Also in     supabase/schema.sql
create or replace function public.reserve_module_exam_regenerate(p_user_id uuid, p_cap integer)
returns integer
language sql
security invoker
set search_path = public
as $$
  update public.profiles
  set module_exam_regenerations_used = module_exam_regenerations_used + 1
  where id = p_user_id
    and module_exam_regenerations_used < p_cap
  returning module_exam_regenerations_used;
$$;

-- Gives a reservation back when the generation failed downstream.
--
-- FUNCTION  refund_module_exam_regenerate(p_user_id uuid) → void
--   Purpose     Gives one « Examen de Module » regeneration back (for a
--               reservation whose generation then failed): subtracts 1 from
--               profiles.module_exam_regenerations_used, never going below 0.
--   Returns     Nothing.
--   Runs as     the caller (SECURITY INVOKER); language sql;
--               search_path = public.
--   Privileges  In this file: EXECUTE revoked from public, anon,
--               authenticated; EXECUTE granted to service_role.
--   Called by   app/api/exam/generate/route.ts, app/api/exam/run/route.ts
--   Also in     supabase/schema.sql
create or replace function public.refund_module_exam_regenerate(p_user_id uuid)
returns void
language sql
security invoker
set search_path = public
as $$
  update public.profiles
  set module_exam_regenerations_used = greatest(module_exam_regenerations_used - 1, 0)
  where id = p_user_id;
$$;

-- Server-only (called with the service role from app/api/exam/generate).
-- Functions are executable by PUBLIC by default, which anon/authenticated
-- inherit — revoke from PUBLIC too, otherwise a signed-in student could call
-- them directly with any p_user_id.
revoke execute on function public.reserve_module_exam_regenerate(uuid, integer) from public, anon, authenticated;
revoke execute on function public.refund_module_exam_regenerate(uuid) from public, anon, authenticated;
grant execute on function public.reserve_module_exam_regenerate(uuid, integer) to service_role;
grant execute on function public.refund_module_exam_regenerate(uuid) to service_role;

-- Make PostgREST see the new functions immediately (no "schema cache" error).
notify pgrst, 'reload schema';
