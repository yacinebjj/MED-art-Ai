# 4. Database & Auth (Supabase)

[← Back to index](./README.md)

---

## 4.1 The three Supabase clients — pick the right one

This is the single most consequential choice you will make in any new file.
Getting it wrong either leaks the service-role key to the browser or silently
bypasses every access control in the system.

| Factory | File | Key | RLS | Use from |
|---|---|---|---|---|
| `createClient()` | `lib/supabase/client.ts` | anon (public) | **enforced** | Browser / `"use client"` |
| `getSupabaseAdmin()` | `lib/supabase/server.ts` | **service-role** | **BYPASSED** | Route handlers only |
| `createServerClient(...)` | `lib/supabase/middleware.ts` | anon | enforced | `middleware.ts` only |

### `lib/supabase/client.ts` — a deliberate singleton

Returns **the same instance** on every call, app-wide, and is configured with
`autoRefreshToken: false`. Both details are load-bearing:

Every `GoTrueClient` runs its own background refresh timer. Supabase refresh
tokens are **single-use and rotating**. Multiple clients in one tab meant
multiple timers racing to rotate the same token; the loser got
`Invalid Refresh Token: Already Used` and concluded the session was dead.

One shared instance removes one racer. `autoRefreshToken: false` removes the
other — `middleware.ts` already refreshes the cookie server-side on every
navigation, so the browser's own unattended timer is redundant. Explicit calls
like `supabase.auth.getUser()` still refresh on demand.

> **Do not** call `createBrowserClient` directly in a component. Always go
> through `createClient()`.

### The service-role trap

`getSupabaseAdmin()` **bypasses Row Level Security completely.** RLS will not
save you in a route handler.

```ts
// ❌ IDOR: any authenticated user can read any course by guessing an integer id
const { data } = await supabase.from("studio_courses").select("*").eq("id", courseId);

// ✅ ownership enforced in the query itself
const { data } = await supabase
  .from("studio_courses").select("*")
  .eq("id", courseId)
  .eq("user_id", user.id);
```

This is not hypothetical. A confirmed IDOR shipped in this codebase: the chat
route derived a course id from a client-supplied `slug`
(`studio-course-<N>`) and passed it to a retrieval helper that queried by
`course_id` alone through the admin client. Because `studio_courses.id` is a
sequential `bigint`, any student could read any other student's private course
content by iterating small integers. Fixed by verifying ownership before the
id is ever used.

**Also apply `.eq("user_id", user.id)` to `UPDATE` and `DELETE`, not just a
preceding `SELECT`** — doing the ownership check in the mutation itself makes it
atomic and race-free.

---

## 4.2 Schema overview — 44 tables

Every table has RLS **enabled** (44/44), with 46 policies.

### Access patterns

| Pattern | Count | Meaning |
|---|---|---|
| `auth.uid()`-scoped policies | 36 references | The row belongs to a user; the anon key may read/write only their own |
| `using (false)` — "Deny all client access" | 23 tables | Server-only. The browser can never touch these; reachable exclusively via the service-role client |

The `using (false)` pattern is the important one to understand: those tables
(caches, chunk indexes, generated-content stores, usage counters) are
**deliberately unreachable from the browser**. Their protection is "no client
access at all" — which is airtight *until* a server route reads them with the
admin client and forgets its own ownership check. That is precisely how the IDOR
above happened.

### Table families

| Family | Tables | Purpose |
|---|---|---|
| **Identity & billing** | `profiles`, `subscriptions`, `payments` | User profile, plan state, payment audit trail |
| **Curriculum (public)** | `curriculum_specialties`, `curriculum_academic_years`, `curriculum_teaching_units`, `curriculum_modules` | Reference catalogue — no user data |
| **Studio (core product)** | `studio_courses`, `studio_content_cache`, `studio_content_variations`, `studio_course_chunks`, `studio_course_explication_chapters`, `studio_infographic_cache`, `studio_podcast_cache`, `studio_slides_cache`, `studio_cross_university_reuse_log` | Uploaded courses + every generated section, plus cross-student caches |
| **Legacy public courses** | `courses`, `courses_cache`, `course_content_cache`, `course_chunks`, `course_source_chunks`, `course_explication_chapters`, `user_courses`, `modules` | Earlier pipeline, still present |
| **Learning & SRS** | `qcm_attempts`, `user_module_flashcards`, `flashcards_content_cache` | Spaced repetition state |
| **Exams** | `module_generated_exams`, `user_exam_attempts`, `exam_content_cache`, `exam_content_variations`, `exam_harvested_qcms` | Exam generator + attempt history |
| **Study tools** | `user_notes`, `course_highlights`, `study_plans`, `study_plan_tasks`, `course_chat_history`, `course_workspace_cache`, `lecture_notes_jobs` | Notes, highlights, planner, chat history |
| **Social** | `chat_groups`, `chat_members`, `chat_messages` | Group study chat (Supabase Realtime) |
| **Platform limits** | `platform_daily_generation_usage`, `dashboard_assistant_daily_usage` | Global spend guards |

### `studio_courses` — the central table

One row per uploaded course; **one column per generated section**:
`raw_text`, `explication`, `resume`, `cas_clinique`, `qcms` (jsonb),
`exemples_analogies`, `flashcard_queue` (jsonb), `source_file_url`,
`curriculum_module_id`, `user_id`, `updated_at`.

Sections are columns rather than rows because the UI always loads a whole course
at once, and each section is generated independently.

---

## 4.3 Authentication

### Sign-up / sign-in

Both run **client-side**, directly against Supabase Auth:

- `components/auth/LoginForm.tsx` → `supabase.auth.signInWithPassword(...)`
- `components/auth/RegisterForm.tsx` → `supabase.auth.signUp({ …, options: { emailRedirectTo: `${window.location.origin}/auth/callback` } })`

`emailRedirectTo` must stay derived from `window.location.origin` — never
hardcoded — so it works across localhost, previews and production.

### Email confirmation

`app/auth/callback/route.ts` exchanges the one-time `code` for a session
(`exchangeCodeForSession`), then redirects.

> **Security note:** the `next` query parameter is passed through
> `sanitizeRedirectPath()` (`lib/safe-redirect.ts`), which forces it to a
> same-origin relative path. Without that guard, `?next=@evil.com` makes
> `origin + next` parse with `evil.com` as the host — a real open-redirect that
> shipped and was fixed. The same guard applies in `LoginForm`.

### Session lifecycle

1. Supabase stores the session in cookies.
2. `middleware.ts` → `updateSession()` refreshes it on every non-API request.
3. API routes call `getAuthenticatedUser()` (`lib/supabase/session-server.ts`),
   which reads and refreshes as needed.
4. `AuthProvider` exposes the user to the React tree via `useAuth()`.

### Route protection

Two independent layers:

**Middleware** (`lib/supabase/middleware.ts`) guards page navigation:

```ts
const PROTECTED_PREFIXES = ["/dashboard", "/study"];
// unauthenticated + protected prefix → redirect to /login?next=<pathname>
// authenticated + on /login, /register or / → redirect to /dashboard
```

**Route handlers** guard data. Every one of the 74 protected routes starts with
`getAuthenticatedUser()`. Middleware is not a substitute — it deliberately does
not run on `/api/**`.

### The 401 retry exception

`isRetryable()` in `lib/studio-explication-client.ts` treats **401 as
retryable**, which looks wrong and is not. Two concurrent authenticated requests
can race the single-use refresh-token rotation; the loser gets a hard 401 even
though the session is alive and the browser's cookie has already been updated by
the winner. A single retry after a short backoff succeeds. Treating 401 as
permanent meant losing a multi-minute generation to a self-resolving race.

---

## 4.4 Storage

| Bucket | Contents | Size limit |
|---|---|---|
| `course-sources` | Uploaded PDF/DOCX/PPTX/TXT | 100 MB (bucket-level) |
| `lecture-recordings` | Audio chunks for transcription | 24 MB per chunk |

Both are provisioned lazily by an `ensure…Bucket()` helper
(`lib/course-source-storage.ts`, `lib/lecture-notes-storage.ts`).

> The bucket-level `fileSizeLimit` matters: `/api/upload/sign` validates a
> **client-declared** `fileSize` before issuing a signed URL, so it can be lied
> to. The bucket limit is the only check the actual bytes must pass.

---

## 4.5 Working with the schema safely

1. **Read `supabase/schema.sql` first** — it documents intent and the reasoning
   behind non-obvious tables.
2. **Verify against the live database** — there is no migration runner, and
   drift is known to exist.
3. **New table checklist:**
   - [ ] `alter table … enable row level security;`
   - [ ] Either an `auth.uid()`-scoped policy, or `using (false)` if server-only
   - [ ] Add it to `schema.sql`
   - [ ] If server-only, remember RLS will not protect it from your own route —
         scope every query by `user_id`

[Next: Third-Party Integrations →](./05-integrations.md)
