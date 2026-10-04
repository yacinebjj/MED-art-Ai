-- Profile photo URL. schema.sql declared it but no migration ever shipped it,
-- so uploads failed with: Could not find the 'avatar_url' column of
-- 'profiles' in the schema cache. (Until this runs, app/api/profile/avatar
-- keeps the URL in the auth user's metadata instead, so photos still work.)
--
-- Idempotent: safe to run more than once.

alter table public.profiles add column if not exists avatar_url text;

notify pgrst, 'reload schema';
