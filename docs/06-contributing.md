# 6. Contribution Guidelines

[← Back to index](./README.md)

---

## 6.1 Commands

```bash
npm install          # install dependencies
npm run dev          # dev server → http://localhost:3000
npm run build        # production build (authoritative type check)
npm start            # serve a production build locally
npm run lint         # ESLint / next lint

npx tsc --noEmit     # fast type check — run this constantly
```

### The quality gate before every commit

```bash
npx tsc --noEmit && npm run lint && npm run build
```

All three must pass. Known-acceptable output: exactly **two** ESLint `<img>`
warnings (`app/dashboard/(shell)/assistant/page.tsx`,
`components/course/workspace/InfographicViewer.tsx`). Anything else is new.

> **Windows note:** concurrent `next build` runs, or a build running while the
> dev server is live, can abort with `UNKNOWN: unknown error, write` or
> `Cannot find module for page: /_document`. Those are filesystem races on
> `.next`, not real failures. Stop the dev server, `rm -rf .next`, rebuild, and
> confirm you get a full route table before believing a build "passed".

---

## 6.2 Environment variables

| Variable | Scope | Required for |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | public | App boot |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public | Auth, browser queries |
| `SUPABASE_URL` | **server** | All route handlers |
| `SUPABASE_SERVICE_ROLE_KEY` | **server** | All route handlers (bypasses RLS) |
| `OPENROUTER_API_KEY` | **server** | Every AI feature |
| `CHARGILY_SECRET_KEY` | **server** | Payments |
| `CHARGILY_API_BASE` | server | Test vs live payment endpoint |
| `APP_URL` | server | Chargily callback/webhook URLs in production |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | public | Google Drive import |
| `VAPID_PUBLIC_KEY` / `NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | mixed | Web Push |
| `CRON_SECRET` | **server** | `POST /api/push/dispatch` |

**The rule:** `NEXT_PUBLIC_` is inlined into the browser bundle. Anything not
carrying that prefix must never be read from a file reachable by a
`"use client"` component. `.env.local.example` is the canonical list — keep it
updated when you add a variable.

> `NEXT_PUBLIC_*` values are baked in **at build time**, not read at runtime.
> Changing one in Vercel requires a **redeploy**; the running deployment keeps
> the old value.

---

## 6.3 How to add a new feature

Worked example: a "Mnémotechniques" Studio section.

### 1. Type and schema first

```ts
// types/studio-course.ts — what the app believes
export interface Mnemonic { id: string; concept: string; device: string; }

// lib/ai/studio-schemas.ts — what we accept from the model
export const MnemonicsSchema = z.object({
  mnemonics: z.array(z.object({
    id: z.string(), concept: z.string().min(3), device: z.string().min(10),
  })).min(5),
});
```

### 2. Prompt

Add `MNEMONICS_SYSTEM_PROMPT` to `lib/ai/studio-prompts.ts`. Never inline a
prompt in a route handler.

### 3. Database

Add the column to `studio_courses` in `supabase/schema.sql`, **and run it
against the live database** — there is no migration runner.

### 4. Route handler

Follow the gate order exactly:

```ts
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });

  const rl = rateLimit(`studio-mnemonics:${user.id}`, RATE_LIMITS.ai);
  if (!rl.allowed) return NextResponse.json(
    { success: false, error: "Trop de requêtes — réessaie dans quelques minutes." },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds(rl)) } }
  );

  let body: unknown;
  try { body = await request.json(); }
  catch (error) { return NextResponse.json({ success: false, error: `Corps de requête JSON invalide : ${errorMessage(error)}` }, { status: 400 }); }

  const { courseId } = (body ?? {}) as { courseId?: unknown };
  if (typeof courseId !== "number" || !Number.isFinite(courseId)) {
    return NextResponse.json({ success: false, error: "'courseId' est requis." }, { status: 400 });
  }

  // ⚠️ ownership — the admin client bypasses RLS
  const supabase = getSupabaseAdmin();
  const { data: course } = await supabase
    .from("studio_courses").select("raw_text")
    .eq("id", courseId).eq("user_id", user.id)   // ← never omit
    .maybeSingle();
  if (!course) return NextResponse.json({ success: false, error: "Cours introuvable." }, { status: 404 });

  const gate = await reserveGeneration(user);
  if (!gate.allowed) return NextResponse.json({ success: false, error: gate.reason }, { status: 403 });

  try {
    const raw = await callOpenRouter([...], { model: CHEAP_MODEL, maxTokens: 8000, timeoutMs: 200_000 });
    const parsed = MnemonicsSchema.safeParse(parseJsonResponse(raw));
    if (!parsed.success) throw new Error("Format de réponse invalide.");
    // persist…
    return NextResponse.json({ success: true, data: parsed.data });
  } catch (error) {
    await refundGeneration(user);          // ← never charge for a failure
    const status = error instanceof OpenRouterError ? error.status : 502;
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status });
  }
}
```

### 5. UI

Add the tile to the Studio panel and a viewer component under
`components/course/workspace/`. Wire loading and error states — the generation
takes real time.

### 6. Verify

`npx tsc --noEmit && npm run lint && npm run build`, then exercise the feature
in the browser.

---

## 6.4 Conventions

### API responses

| Shape | Count | Status |
|---|---|---|
| `{ success: boolean, … }` | 64 of 80 routes | **The convention — use this** |
| Bare `{ error }` / `{ data }` | 16 routes | Legacy, predates the convention |

New routes **must** use `{ success: true, … }` / `{ success: false, error }`.
The 16 legacy routes are a known, tracked inconsistency; migrating one means
updating its client call sites in the same commit, so it is done opportunistically
rather than in a risky sweep.

HTTP status codes carry meaning and are relied on by client retry logic:
`400` bad input · `401` unauthenticated · `403` quota/forbidden · `404` not found
or not owned · `413` too large · `429` rate limited · `502` upstream failure ·
`504` upstream timeout.

### Errors

**User-facing messages are in French** and must never leak internals. Full
detail goes to `console.error` for the server logs.

```ts
// ❌ leaks schema/constraint names to the browser
return NextResponse.json({ error: `Échec : ${error.message} (code ${error.code})` }, { status: 500 });

// ✅
console.error("[route] Échec insertion:", error);
return NextResponse.json({ success: false, error: "L'opération a échoué. Réessaie." }, { status: 500 });
```

### Comments

This codebase comments **why**, not what — especially where a value looks
arbitrary or a structure looks over-engineered. Most such comments record a real
incident. When you change one of those values, **update its comment with your
new reasoning**; a stale rationale is worse than none.

### Naming

`PascalCase` components and types · `camelCase` variables and functions ·
`SCREAMING_SNAKE_CASE` constants · `kebab-case.ts` logic files ·
`PascalCase.tsx` components · imports always via `@/…`.

---

## 6.5 Known technical debt

Tracked honestly, in rough priority order:

| # | Item | Impact |
|---|---|---|
| 1 | **No migration runner.** `schema.sql` is intent; the live DB is reality, and they can drift | High — a missing column fails at runtime |
| 2 | **Rate limiting is in-process** (`lib/rate-limit.ts`), so the real ceiling is `limit × instances` on Vercel | High under load. Upstash Redis migration is sketched in-file |
| 3 | **16 routes** use the legacy response shape | Medium — inconsistent client handling |
| 4 | **No automated tests.** Verification is `tsc` + lint + build + manual | Medium |
| 5 | **No generated Supabase types** — the admin client is `SupabaseClient<any, any, any>` | Medium — no compile-time column safety |
| 6 | **Two stale duplicate Vercel projects** (`med-art-ai`, `med-art-ai-vz6g`) deploy from the same repo. The real one is **`med-art-ai-febc`** | Low, but confusing: failing checks on the duplicates are noise |
| 7 | Two `<img>` lint warnings | Cosmetic |

---

## 6.6 Deployment

Pushing to `main` triggers Vercel automatically. **Three** projects build from
this repo; only **`med-art-ai-febc`** (https://med-art-ai-febc.vercel.app) is
production. Verify the right one:

```bash
curl -s "https://api.github.com/repos/yacinebjj/MED-art-Ai/commits/<sha>/status" \
  | grep -B3 '"context": "Vercel – med-art-ai-febc"'
```

Then confirm the site actually serves:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://med-art-ai-febc.vercel.app/
```

---

## 6.7 Roadmap

**Near term**
1. Adopt a migration tool (Supabase CLI migrations) — closes debt #1
2. Move rate limiting to Upstash Redis — closes #2
3. Generate Supabase types — closes #5
4. Add tests around the money/quota paths: `reserveGeneration`/`refundGeneration`,
   the Chargily webhook, and the Explication part orchestrator

**Medium term**
5. Migrate the 16 legacy routes to the standard response shape
6. Tighten the CSP — the current policy allows `'unsafe-inline'`/`'unsafe-eval'`
   because Next's App Router hydration needs it without a nonce. A nonce-based
   CSP is a real, separate piece of work
7. Structured logging + error tracking (Sentry or equivalent). Today diagnosis
   depends on `console.error` and Vercel log retention
8. Retire the legacy public-course pipeline (`courses`, `course_chunks`, …) once
   nothing depends on it

**Longer term**
9. Observability on generation cost per student — spend guards exist
   (`platform_daily_generation_usage`) but there is no dashboard
10. Formalise the cross-university content-reuse similarity threshold (currently
    0.85, set from a single observed pair — `studio_cross_university_reuse_log`
    is the audit trail for revisiting it)

---

## 6.8 Where to start reading

1. `lib/ai/openrouter.ts` — the AI gateway and its timeout semantics
2. `lib/studio-explication-delta.ts` + `lib/studio-explication-client.ts` — the
   most complex flow, and the one that teaches the platform's constraints
3. `app/dashboard/module/[id]/page.tsx` — the product's centre of gravity
4. `supabase/schema.sql` — the data model
5. `lib/supabase/*.ts` — the three clients and when each applies

[← Back to index](./README.md)
