const IDEOGRAM_URL = "https://api.ideogram.ai/generate";

export class IdeogramError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/**
 * Thin wrapper around Ideogram's image-generation REST API — mirrors
 * lib/ai/openrouter.ts's callOpenRouter shape (own error class carrying a
 * status, explicit failure messages, never a silent empty return).
 *
 * `magic_prompt_option: "OFF"` is deliberate: Ideogram's "Magic Prompt"
 * feature rewrites/embellishes the given prompt before generating, which
 * could paraphrase away the exact-text instructions baked into a prompt
 * (both the original text-free Mind Map hybrid's "no text anywhere" rule,
 * and v6's "the banner must read exactly '...'" quoted labels). Sending the
 * prompt verbatim, unmodified, is what makes either instruction style
 * actually enforceable.
 */
export async function generateIdeogramImage(prompt: string, aspectRatio: string = "ASPECT_1_1"): Promise<string> {
  const apiKey = process.env.IDEOGRAM_API_KEY;
  if (!apiKey) {
    throw new IdeogramError("IDEOGRAM_API_KEY n'est pas configurée sur le serveur.", 500);
  }

  let res: Response;
  try {
    res = await fetch(IDEOGRAM_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Api-Key": apiKey,
      },
      body: JSON.stringify({
        image_request: {
          prompt,
          aspect_ratio: aspectRatio,
          model: "V_2",
          magic_prompt_option: "OFF",
        },
      }),
    });
  } catch (error) {
    console.error("Ideogram fetch failed", error);
    throw new IdeogramError("L'appel à Ideogram a échoué. Réessaie dans un instant.", 502);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`Ideogram API error (${res.status})`, body.slice(0, 500));
    throw new IdeogramError(`Ideogram a renvoyé une erreur (${res.status}) : ${body.slice(0, 300) || "réponse vide"}`, res.status);
  }

  const data = await res.json();
  const url = data?.data?.[0]?.url;
  if (typeof url !== "string" || !url) {
    console.error("Ideogram returned an unexpected payload", JSON.stringify(data).slice(0, 500));
    throw new IdeogramError("Réponse Ideogram inattendue (aucune URL d'image).", 502);
  }

  return url;
}
