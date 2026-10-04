import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_BYTES = 3 * 1024 * 1024;
const TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 3;
const MIN_TEXT_CHARS = 200;
const MAX_TEXT_CHARS = 400_000;

/** True for loopback, private, link-local, CGNAT, multicast and other non-public ranges (IPv4 + IPv6). */
function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  const v6 = address.toLowerCase();
  if (v6 === "::" || v6 === "::1") return true;
  if (v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe8") || v6.startsWith("fe9") || v6.startsWith("fea") || v6.startsWith("feb") || v6.startsWith("ff")) return true;
  const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? isPrivateAddress(mapped[1]) : false;
}

/** Rejects anything that isn't a public http(s) host — the SSRF guard, re-applied on every redirect hop. */
async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ImportError("Adresse invalide.", 400);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new ImportError("Seuls les liens http(s) sont acceptés.", 400);
  if (url.username || url.password) throw new ImportError("Les liens avec identifiants ne sont pas acceptés.", 400);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new ImportError("Cette adresse n'est pas accessible.", 400);
  }
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (addresses.length === 0) throw new ImportError("Ce site est introuvable.", 400);
  if (addresses.some((entry) => isPrivateAddress(entry.address))) throw new ImportError("Cette adresse n'est pas accessible.", 400);
  return url;
}

class ImportError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", eacute: "é", egrave: "è", ecirc: "ê", agrave: "à", ccedil: "ç", ocirc: "ô", ucirc: "û", icirc: "î", rsquo: "’", lsquo: "‘", hellip: "…", laquo: "«", raquo: "»", ndash: "–", mdash: "—" };

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/** Readable text of an HTML page: main/article first, chrome (nav, header, footer, scripts) dropped. */
function htmlToText(html: string): { title: string; text: string } {
  const title = decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/\s+/g, " ").trim();
  let body = html.match(/<(article|main)[^>]*>([\s\S]*?)<\/\1>/i)?.[2] ?? html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? html;
  body = body
    .replace(/<(script|style|noscript|svg|nav|header|footer|aside|form|iframe|template)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)[^>]*>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<[^>]+>/g, " ");
  const text = decodeEntities(body)
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v ]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
  return { title, text };
}

async function readLimited(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw new ImportError("Cette page est trop volumineuse (3 Mo maximum).", 413);
    }
    chunks.push(value);
  }
  return new TextDecoder("utf-8").decode(Buffer.concat(chunks.map((c) => Buffer.from(c))));
}

/**
 * POST /api/import/url { url } — fetches ONE public web page and returns its
 * readable text ({ title, text }), which the import modal then feeds into
 * the exact same "texte direct" course creation as pasted text. Server-side
 * fetch guarded against SSRF (public hosts only, checked on every redirect),
 * size- and time-limited. Never stores anything itself.
 */
export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });

  const rl = rateLimit(`import-url:${user.id}`, RATE_LIMITS.mutation);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: "Trop de requêtes — réessaie dans quelques minutes." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds(rl)) } }
    );
  }

  const body = (await request.json().catch(() => null)) as { url?: unknown } | null;
  if (!body || typeof body.url !== "string" || body.url.length > 2048) {
    return NextResponse.json({ success: false, error: "'url' est requis." }, { status: 400 });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let current = await assertPublicUrl(body.url.trim());
    let response: Response | null = null;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      response = await fetch(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: { "User-Agent": "MedArtAI-Importer/1.0 (+course import)", Accept: "text/html,text/plain;q=0.9,*/*;q=0.1" },
      });
      if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
        current = await assertPublicUrl(new URL(response.headers.get("location") as string, current).toString());
        response = null;
        continue;
      }
      break;
    }
    if (!response) throw new ImportError("Trop de redirections.", 400);
    if (!response.ok) throw new ImportError(`La page a répondu avec une erreur (${response.status}).`, 502);

    const contentType = response.headers.get("content-type") ?? "";
    if (!/text\/html|text\/plain|application\/xhtml/i.test(contentType)) {
      throw new ImportError("Ce lien n'est pas une page web lisible. Pour un PDF ou un document, utilise l'onglet Fichiers.", 415);
    }

    const raw = await readLimited(response);
    const { title, text } = /text\/plain/i.test(contentType) ? { title: "", text: raw.trim() } : htmlToText(raw);
    if (text.length < MIN_TEXT_CHARS) {
      throw new ImportError("Cette page ne contient pas assez de texte lisible (elle est peut-être protégée ou générée par JavaScript).", 422);
    }
    return NextResponse.json({ success: true, title: title || current.hostname, text: text.slice(0, MAX_TEXT_CHARS), sourceUrl: current.toString() });
  } catch (error) {
    if (error instanceof ImportError) return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    if (error instanceof Error && error.name === "AbortError") return NextResponse.json({ success: false, error: "La page met trop de temps à répondre." }, { status: 504 });
    console.error("[import/url] Échec:", error);
    return NextResponse.json({ success: false, error: "Impossible de récupérer cette page." }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}
