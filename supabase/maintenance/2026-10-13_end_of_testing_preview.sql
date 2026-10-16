-- END OF TESTING — PREVIEW (read-only, deletes nothing).
-- Run this first in Supabase → SQL Editor. It lists how many rows
-- 2026-10-13_end_of_testing_reset.sql would delete, table by table.
-- Tables that don't exist in this database are reported as "absent".

create temp table if not exists _reset_preview (category text, table_name text, rows_now text);
truncate _reset_preview;

do $$
declare
  t record;
  n bigint;
begin
  for t in
    select * from (values
      -- Student study activity
      ('activity', 'course_chat_history'), ('activity', 'qcm_attempts'), ('activity', 'course_highlights'),
      ('activity', 'user_notes'), ('activity', 'study_plan_tasks'), ('activity', 'study_plans'),
      ('activity', 'lecture_notes_jobs'), ('activity', 'user_exam_attempts'), ('activity', 'module_generated_exams'),
      ('activity', 'user_lab_history'), ('activity', 'user_sync_documents'), ('activity', 'user_module_flashcards'),
      -- Test courses (+ their cascaded chunk/chapter/QCM tables)
      ('courses', 'studio_cross_university_reuse_log'), ('courses', 'exam_harvested_qcms'),
      ('courses', 'studio_course_explication_chapters'), ('courses', 'studio_course_chunks'), ('courses', 'studio_courses'),
      ('courses', 'course_content_cache'), ('courses', 'user_courses'), ('courses', 'course_chunks'), ('courses', 'modules'),
      -- Shared AI caches
      ('cache', 'studio_content_cache'), ('cache', 'studio_content_variations'), ('cache', 'flashcards_content_cache'),
      ('cache', 'studio_infographic_cache'), ('cache', 'studio_slides_cache'), ('cache', 'studio_podcast_cache'),
      ('cache', 'course_workspace_cache'), ('cache', 'exam_content_cache'), ('cache', 'exam_content_variations'),
      ('cache', 'lab_course_cache'), ('cache', 'ai_generation_ledger'), ('cache', 'courses_cache'),
      -- Usage counters from the testing period
      ('counters', 'platform_daily_generation_usage'), ('counters', 'dashboard_assistant_daily_usage')
    ) as v(category, table_name)
  loop
    if to_regclass('public.' || t.table_name) is null then
      insert into _reset_preview values (t.category, t.table_name, 'absent');
    else
      execute format('select count(*) from public.%I', t.table_name) into n;
      insert into _reset_preview values (t.category, t.table_name, n::text);
    end if;
  end loop;
end $$;

-- What is KEPT: accounts, profiles (only AI/test fields are reset), subscriptions,
-- payments, billing pools, devices, group chats, curriculum, legacy showcase courses.
select * from _reset_preview
union all
select 'kept', 'auth.users', (select count(*) from auth.users)::text
union all
select 'kept', 'subscriptions', (select count(*) from public.subscriptions)::text
union all
select 'kept', 'payments', (select count(*) from public.payments)::text
union all
select 'kept', 'curriculum_modules', (select count(*) from public.curriculum_modules)::text;
