import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { callOpenRouter, OpenRouterError, USE_MOCK_AI } from "@/lib/ai/openrouter";
import { errorMessage } from "@/lib/course-generation-shared";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";

const VISUAL_PROMPT_SYSTEM_PROMPT = `Tu es un expert médical et un designer d'infographies. L'utilisateur va te fournir un texte médical. Extrais les 4 ou 5 concepts clés, et rédige un "Image Generation Prompt" en anglais ultra-précis pour un modèle de génération d'images. Le prompt doit décrire une mind map médicale élégante, sur fond clair, avec le titre au centre et des branches connectant les concepts. Précise que le texte doit être "crystal clear and highly legible".

RÈGLE ABSOLUE : réponds UNIQUEMENT avec le prompt anglais final, en une seule ligne, sans guillemets, sans préambule, sans markdown.`;

/**
 * A real, stable, CC-licensed medical mind-map-style image (verified live,
 * same one used as MindMapStudio's static fallback) — returned instead of a
 * real (paid, per-call) Ideogram request whenever USE_MOCK_AI is on, exactly
 * like every other generation route in this app stays $0 in local dev.
 */
const MOCK_IMAGE_URL = "https://upload.wikimedia.org/wikipedia/commons/2/22/Cubital_Fossa2.png";

const MOCK_VISUAL_PROMPT =
  "An elegant medical mind map infographic on a clean white background, a bold central title node connected by smooth curved branches to 4-5 key concept nodes, crystal clear and highly legible sans-serif typography, flat vector illustration style, soft pastel accent colors, high resolution, no watermarks.";

/**
 * ⚠️ TEMPORARY TEST MODE — hybrid architecture test (2026-08-02): Ideogram
 * now generates a TEXT-FREE background only (icons/shapes/branches, zero
 * typography) — the real medical labels are overlaid as HTML/CSS on top in
 * MindMapStudio.tsx, sidestepping image models' well-known weakness at
 * rendering legible text entirely, instead of trying to prompt around it.
 *   - Step A returns the active test course's hardcoded prompt instead of
 *     calling OpenRouter (real or mock) at all.
 *   - Step B calls the REAL Ideogram API even if USE_MOCK_AI is on.
 * BUDGET GUARD: see CACHE_FILE_PATH below — Step B checks for a cached
 * local file FIRST and returns it without ever touching Ideogram again once
 * one exists, so this can be tested/reloaded any number of times for the
 * price of exactly one real generation PER COURSE (each has its own cache
 * file — switching TEMP_TEST_COURSE never re-spends on a course already
 * cached, and never touches another course's cache).
 * REVERT: set TEMP_TEST_MODE back to `false` once satisfied with the
 * result, or once OpenRouter/the full per-course flow is ready to test for
 * real.
 */
const TEMP_TEST_MODE = true;

/** Which hardcoded test course is currently active — switch this to flip between already-cached courses without spending anything. */
type TempTestCourse = "hic" | "pleuresie";
const TEMP_TEST_COURSE: TempTestCourse = "pleuresie";

/**
 * Local disk cache for the TEMP_TEST_MODE background — Ideogram's own URLs
 * are ephemeral (expire), so the generated image is downloaded once and
 * saved here; every subsequent request (page reload, tile re-click) is
 * served straight from disk, $0, no API call. This is a dev-only mechanism
 * (writes to the local filesystem) — a real per-course production version
 * would need Supabase Storage or similar instead, since most hosting
 * platforms don't offer a persistent writable filesystem.
 */
const CACHE_DIR = path.join(process.cwd(), "public", "generated");

// No-text prompts: describe icons/shapes/branches only, with an explicit
// negative constraint against any typography — the real labels are a
// separate HTML/CSS overlay (see MindMapStudio.tsx), not part of the image.
const TEMP_TEST_COURSES: Record<TempTestCourse, { cacheFilename: string; visualPrompt: string }> = {
  hic: {
    cacheFilename: "mindmap-test-hic-background.png",
    visualPrompt: `A clean, elegant flat-design medical infographic background illustration for an Intracranial Hypertension mind map. A large stylized central brain icon with a subtle pressure-gauge/meter graphic overlaid on it, softly glowing to suggest elevated pressure. Five colorful rounded speech-bubble shapes radiate outward from the central brain in a radial mind-map layout, connected to it by smooth curved lines: a blue-toned bubble at the top-left containing a small ventricle/brain-cross-section icon, a red-toned bubble at the top-right containing a tumor/hematoma icon, an orange-toned bubble at the middle-right containing a person-clutching-head pain icon, a green-toned bubble at the bottom-right containing a CT-scanner icon, and a purple-toned bubble at the bottom-left containing a syringe/IV-drip icon. Soft pastel color palette, minimalist flat vector icon style, generous empty white space inside each bubble reserved for text to be added later, subtle drop shadows, high resolution, clean professional medical-app aesthetic.

STRICT NEGATIVE CONSTRAINT: NO TEXT, NO LETTERS, NO WORDS, NO NUMBERS, NO WRITING OF ANY KIND ANYWHERE IN THE IMAGE. Clean blank shapes only — pure iconography and color, zero typography, no watermark, no signature.`,
  },
  // v5 attempt (2026-08-03) tried a full illustrated poster background with
  // ONLY the title baked in as text — even that came back with 2 typos
  // ("COMPRENEDRE", "PLEURÉÉSIE"), and 2 of the 5 requested illustrated
  // clusters (syringe/thoracentesis, diagnostic chart) never appeared at
  // all. Confirms, a third time, that Ideogram's compositional/text
  // reliability can't be trusted for anything this specific. Cache file
  // left on disk (pleuresie-hybrid-background-v5.png, gitignored, dev-only)
  // rather than deleted. FINAL DECISION: back to v2 — Ideogram supplies
  // ONLY a decorative, text-free hero illustration (zero typography, so
  // zero risk of typos); every word of real medical content is the
  // reliable HTML/CSS overlay in MindMapStudio.tsx.
  pleuresie: {
    cacheFilename: "mindmap-test-pleuresie-hero-banner.png",
    visualPrompt: `A warm, hand-drawn educational sketchnote illustration in a flat cartoon medical style, on a soft cream/ivory paper background with a subtle paper texture. The scene shows a friendly, simplified cross-section of human lungs and pleura, with a visible layer of pleural fluid accumulating between the two pleural membranes, rendered in a cute, approachable medical-infographic style. Beside it, a hand-drawn medical syringe performing a thoracentesis (pleural puncture), with a few curved, hand-sketched arrows showing fluid direction and the needle's path. Soft pastel color palette (dusty blue, warm coral, sage green), gentle hand-drawn outlines with slight imperfection, warm and friendly tone, wide horizontal banner composition, high resolution, no watermark, no signature.

STRICT NEGATIVE CONSTRAINT: NO TEXT, NO LETTERS, NO WORDS, NO NUMBERS, NO WRITING OF ANY KIND ANYWHERE IN THE IMAGE. Pure illustration only.`,
  },
};

const ACTIVE_TEST_COURSE = TEMP_TEST_COURSES[TEMP_TEST_COURSE];
const CACHE_FILE_PATH = path.join(CACHE_DIR, ACTIVE_TEST_COURSE.cacheFilename);
const CACHE_PUBLIC_URL = `/generated/${ACTIVE_TEST_COURSE.cacheFilename}`;

interface IdeogramGenerateResponse {
  data?: Array<{ url?: string }>;
}

/** Étape A — OpenRouter turns the raw course text into an English image-generation prompt. */
async function generateVisualPrompt(courseText: string): Promise<string> {
  if (TEMP_TEST_MODE) {
    console.warn(
      `[generate-mindmap] ⚠️ TEMP_TEST_MODE actif (cours="${TEMP_TEST_COURSE}") — Étape A (OpenRouter) court-circuitée, prompt visuel codé en dur utilisé.`
    );
    return ACTIVE_TEST_COURSE.visualPrompt;
  }

  if (USE_MOCK_AI) {
    console.log("[generate-mindmap] MOCK_AI actif — visual prompt simulé, aucun appel réel à OpenRouter.");
    return MOCK_VISUAL_PROMPT;
  }

  const raw = await callOpenRouter(
    [
      { role: "system", content: VISUAL_PROMPT_SYSTEM_PROMPT },
      { role: "user", content: courseText },
    ],
    { maxTokens: 400 }
  );
  return raw.trim();
}

/**
 * Étape B — Ideogram turns the visual prompt into an actual image.
 *
 * Uses Ideogram's real current v3 contract (verified against their official
 * API docs) rather than the older `/generate` JSON-body shape: the endpoint
 * is `/v1/ideogram-v3/generate`, auth is a raw `Api-Key` header (not
 * `Authorization: Bearer`), and the body is `multipart/form-data`, not JSON.
 *
 * Ideogram's returned URLs are EPHEMERAL (their docs' own wording) — fine for
 * showing the image immediately, but not for permanent storage. This route
 * deliberately does not persist imageUrl anywhere for that reason; see the
 * frontend wiring for how it's used instead.
 */
async function generateImageFromPrompt(visualPrompt: string): Promise<string> {
  // Budget guard — checked FIRST, before anything else: if a previous
  // TEMP_TEST_MODE run already generated and cached this background, serve
  // it straight from disk and never touch Ideogram again for this test.
  if (TEMP_TEST_MODE && fs.existsSync(CACHE_FILE_PATH)) {
    console.warn(
      `[generate-mindmap] ⚠️ TEMP_TEST_MODE — image déjà en cache local (${CACHE_PUBLIC_URL}), AUCUN appel Ideogram — 0$ dépensé.`
    );
    return CACHE_PUBLIC_URL;
  }

  if (USE_MOCK_AI && !TEMP_TEST_MODE) {
    console.log("[generate-mindmap] MOCK_AI actif — image Ideogram simulée, 0$ dépensé.");
    return MOCK_IMAGE_URL;
  }

  if (TEMP_TEST_MODE) {
    console.warn(
      "[generate-mindmap] ⚠️ TEMP_TEST_MODE actif — pas de cache trouvé, appel RÉEL à Ideogram (dépense du crédit réel). Le résultat sera mis en cache pour que ce soit la DERNIÈRE fois."
    );
  }

  const apiKey = process.env.IDEOGRAM_API_KEY;
  if (!apiKey) {
    throw new Error("IDEOGRAM_API_KEY n'est pas configurée sur le serveur.");
  }

  const form = new FormData();
  form.append("prompt", visualPrompt);
  form.append("aspect_ratio", "16x9");
  form.append("rendering_speed", "QUALITY");

  let res: Response;
  try {
    res = await fetch("https://api.ideogram.ai/v1/ideogram-v3/generate", {
      method: "POST",
      headers: { "Api-Key": apiKey },
      body: form,
    });
  } catch (error) {
    throw new Error(`Impossible de contacter Ideogram : ${errorMessage(error)}`);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Ideogram a répondu ${res.status} : ${detail.slice(0, 300)}`);
  }

  const responseBody = (await res.json()) as IdeogramGenerateResponse;
  const remoteImageUrl = responseBody?.data?.[0]?.url;
  if (!remoteImageUrl) {
    throw new Error("Ideogram n'a renvoyé aucune URL d'image exploitable.");
  }

  if (!TEMP_TEST_MODE) {
    return remoteImageUrl;
  }

  // Download the actual bytes NOW and cache them locally — Ideogram's URL
  // expires, so without this the cache would silently start 404ing later.
  // Never re-throws: if caching fails for any reason, fail open by handing
  // back the (still valid, for now) ephemeral URL rather than erroring out
  // a generation that otherwise succeeded.
  try {
    const imageRes = await fetch(remoteImageUrl);
    if (!imageRes.ok) throw new Error(`Téléchargement de l'image échoué (${imageRes.status}).`);
    const buffer = Buffer.from(await imageRes.arrayBuffer());
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(CACHE_FILE_PATH, buffer);
    console.warn(`[generate-mindmap] ✅ Image Ideogram mise en cache localement : ${CACHE_FILE_PATH}`);
    return CACHE_PUBLIC_URL;
  } catch (cacheError) {
    console.error(
      "[generate-mindmap] Mise en cache locale échouée (non bloquant, retour à l'URL Ideogram éphémère) :",
      errorMessage(cacheError)
    );
    return remoteImageUrl;
  }
}

/**
 * Two-step Mind Map image generation: OpenRouter writes the visual prompt,
 * Ideogram renders it. Accepts either `slug` (preferred — the real course's
 * `raw_text` is fetched server-side, exactly like every other generation
 * route; the browser never needs to hold or transmit the full source text)
 * or a direct `content`/`document` string (kept for flexibility/testing,
 * per the original spec's shape).
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      slug?: unknown;
      content?: unknown;
      document?: unknown;
    };

    const slug = typeof body.slug === "string" ? body.slug : undefined;
    let courseText =
      typeof body.content === "string" ? body.content : typeof body.document === "string" ? body.document : undefined;

    if (slug) {
      if (!isSupabaseConfigured()) {
        return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
      }
      const supabase = getSupabaseAdmin();
      const { data: row, error: fetchError } = await supabase
        .from("courses")
        .select("raw_text")
        .eq("slug", slug)
        .maybeSingle();

      if (fetchError) {
        console.error(`[generate-mindmap] Lecture Supabase échouée pour slug="${slug}":`, fetchError.message);
      } else if (row?.raw_text) {
        courseText = row.raw_text;
      }
    }

    if (!courseText || courseText.trim().length < 50) {
      return NextResponse.json(
        { success: false, error: "Aucun contenu source exploitable (fournis 'slug', ou directement 'content'/'document')." },
        { status: 400 }
      );
    }

    const truncatedText = courseText.slice(0, 60_000);

    let visualPrompt: string;
    try {
      visualPrompt = await generateVisualPrompt(truncatedText);
    } catch (error) {
      if (error instanceof OpenRouterError) {
        console.error("[generate-mindmap] Étape A (OpenRouter) échouée:", error.message);
        return NextResponse.json({ success: false, error: `Étape A (prompt visuel) : ${error.message}` }, { status: error.status });
      }
      console.error("[generate-mindmap] Étape A (OpenRouter) échouée:", error);
      return NextResponse.json(
        { success: false, error: `Étape A (prompt visuel) échouée : ${errorMessage(error)}` },
        { status: 502 }
      );
    }

    let imageUrl: string;
    try {
      imageUrl = await generateImageFromPrompt(visualPrompt);
    } catch (error) {
      console.error("[generate-mindmap] Étape B (Ideogram) échouée:", error);
      return NextResponse.json(
        { success: false, error: `Étape B (génération d'image) échouée : ${errorMessage(error)}` },
        { status: 502 }
      );
    }

    return NextResponse.json({ success: true, imageUrl, visualPrompt });
  } catch (error) {
    console.error("[generate-mindmap] Erreur non gérée:", error);
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  }
}
