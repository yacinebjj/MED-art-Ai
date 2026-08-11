import { GoogleGenAI } from "@google/genai";

// "gemini-2.5-flash" (the client's first choice) 404s on this specific key —
// confirmed for real: "This model models/gemini-2.5-flash is no longer
// available to new users." "gemini-flash-latest" is Google's own
// always-current alias for their recommended flash model, confirmed working
// with this key — avoids hardcoding a dated model id that gets deprecated
// again later.
const DEFAULT_MODEL = "gemini-flash-latest";

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  if (client) return client;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new GeminiError("GEMINI_API_KEY n'est pas configurée sur le serveur.", 500);
  }
  client = new GoogleGenAI({ apiKey });
  return client;
}

export class GeminiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/**
 * Thin wrapper around Google's official @google/genai SDK — mirrors
 * lib/ai/openrouter.ts's callOpenRouter shape (system + user prompt in,
 * plain string out, own error class carrying a status) so it's a drop-in
 * swap at call sites. Uses Gemini's native JSON mode (responseMimeType)
 * instead of relying on markdown-fence-stripping for structured output.
 */
export async function callGemini(
  systemPrompt: string,
  userPrompt: string,
  options?: { maxTokens?: number; model?: string }
): Promise<string> {
  const ai = getClient();

  let response;
  try {
    response = await ai.models.generateContent({
      model: options?.model ?? DEFAULT_MODEL,
      contents: userPrompt,
      config: {
        systemInstruction: systemPrompt,
        maxOutputTokens: options?.maxTokens ?? 8192,
        responseMimeType: "application/json",
      },
    });
  } catch (error) {
    console.error("Gemini call failed", error);
    const message = error instanceof Error ? error.message : String(error);
    // The SDK throws plain Errors (not a typed ApiError) for most HTTP failures — parse a status code out of the message when present (e.g. "got status: 400 Bad Request") so a bad/expired key or wrong model id surfaces clearly instead of a generic 502.
    const statusMatch = message.match(/\b(400|401|403|404|429|500|503)\b/);
    const status = statusMatch ? Number(statusMatch[1]) : 502;
    throw new GeminiError(`L'appel à Gemini a échoué : ${message.slice(0, 300)}`, status);
  }

  const text = response.text;
  if (typeof text !== "string" || !text.trim()) {
    console.error("Gemini returned an unexpected payload", JSON.stringify(response).slice(0, 500));
    throw new GeminiError("Réponse Gemini inattendue (aucun texte généré).", 502);
  }

  return text;
}
