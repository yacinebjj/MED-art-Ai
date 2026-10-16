-- END OF TESTING — RESET. IRREVERSIBLE. Run the preview script first.
--
-- Deletes: every uploaded course and everything generated for it, all shared
-- AI caches, all student study activity (course chats, QCM attempts, notes,
-- highlights, study plans, lecture-note jobs, module exams, lab history,
-- cross-device synced history) and the daily usage counters.
--
-- Keeps: accounts (auth.users), profiles, subscriptions, payments, billing
-- pools, devices, group chats, the curriculum, the legacy showcase `courses`.
-- Profiles only lose their AI/test fields (remediation plan, module
-- summaries, selected course ids, exam-regeneration count).
--
-- Plain DELETEs inside ONE `do` block (a single statement, so atomic), never
-- TRUNCATE ... CASCADE: if anything unexpected blocks a delete (a foreign
-- key added outside schema.sql), the whole block fails and NOTHING is
-- deleted. The last statement prints rows deleted per table.
--
-- Storage files are NOT deleted by this script (Supabase blocks deleting
-- storage objects from SQL) — empty the buckets from the dashboard
-- afterwards, see the checklist at the bottom.

create temp table if not exists _reset_result (step int, table_name text, rows_deleted text);
truncate _reset_result;

do $$
declare
  t record;
  n bigint;
begin
  for t in
    select * from (values
      -- 1. Student study activity
      (1, 'course_chat_history'), (2, 'qcm_attempts'), (3, 'course_highlights'), (4, 'user_notes'),
      (5, 'study_plan_tasks'), (6, 'study_plans'), (7, 'lecture_notes_jobs'), (8, 'user_exam_attempts'),
      (9, 'module_generated_exams'), (10, 'user_lab_history'), (11, 'user_sync_documents'), (12, 'user_module_flashcards'),
      -- 2. Test courses, children first (they also cascade from studio_courses)
      (13, 'studio_cross_university_reuse_log'), (14, 'exam_harvested_qcms'), (15, 'studio_course_explication_chapters'),
      (16, 'studio_course_chunks'), (17, 'studio_courses'),
      (18, 'course_content_cache'), (19, 'user_courses'), (20, 'course_chunks'), (21, 'modules'),
      -- 3. Shared AI caches
      (22, 'studio_content_cache'), (23, 'studio_content_variations'), (24, 'flashcards_content_cache'),
      (25, 'studio_infographic_cache'), (26, 'studio_slides_cache'), (27, 'studio_podcast_cache'),
      (28, 'course_workspace_cache'), (29, 'exam_content_cache'), (30, 'exam_content_variations'),
      (31, 'lab_course_cache'), (32, 'ai_generation_ledger'), (33, 'courses_cache'),
      -- 4. Usage counters from the testing period
      (34, 'platform_daily_generation_usage'), (35, 'dashboard_assistant_daily_usage')
    ) as v(step, table_name)
    order by step
  loop
    if to_regclass('public.' || t.table_name) is null then
      insert into _reset_result values (t.step, t.table_name, 'absent');
    else
      execute format('delete from public.%I', t.table_name);
      get diagnostics n = row_count;
      insert into _reset_result values (t.step, t.table_name, n::text);
    end if;
  end loop;

  -- 5. Per-student AI results and pointers to the deleted courses/exams.
  update public.profiles
  set weakness_remediation_plan = null,
      weakness_remediation_generated_at = null,
      module_global_summaries = '{}',
      flashcard_active_course_ids = '{}',
      module_exam_regenerations_used = 0;
  get diagnostics n = row_count;
  insert into _reset_result values (36, 'profiles (AI fields reset)', n::text);
end $$;

select * from _reset_result order by step;

-- ---------------------------------------------------------------------------
-- AFTER THE SCRIPT — Supabase dashboard → Storage, empty these buckets
-- (open the bucket → select all → Delete, or the bucket's "Empty bucket"):
--   studio-infographics   generated infographics (cache)
--   studio-podcasts       generated podcasts (cache)
--   course-sources        files uploaded with the test courses
--   lecture-recordings    test lecture-note recordings
--   study-plan-sources    files attached to test study plans
-- KEEP: avatars, chat_media (group chats are kept).
-- ---------------------------------------------------------------------------
