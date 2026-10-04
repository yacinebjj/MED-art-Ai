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
