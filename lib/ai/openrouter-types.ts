/**
 * Exact response shapes for every OpenRouter endpoint this app calls.
 *
 * Extracted from lib/ai/openrouter.ts rather than left as inline `any` at
 * each call site — these are genuine I/O boundaries (a third-party JSON
 * payload, unknown until read), but "unknown until read" is an argument for
 * validating the shape once here, not for typing every field access `any`
 * downstream. Every field below is a field some call site in this codebase
 * actually reads; nothing here is speculative.
 *
 * These describe the WIRE shape only. They are deliberately permissive
 * (every field optional) because OpenRouter is a third party and its exact
 * response can vary by model/provider underneath the OpenAI-compatible
 * surface — every read of these types in this codebase already goes through
 * an explicit runtime check (`typeof content !== "string"`, `finish_reason
 * === "length"`, etc.) before being trusted, and that discipline stays
 * unchanged. The type exists to make THAT checking code self-documenting
 * and to catch a typo'd field path at compile time, not to assert the
 * payload is exhaustively known.
 */

export interface OpenRouterUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

/** `choices[].message.content` for a normal text completion (callOpenRouter). */
export interface OpenRouterMessage {
  role?: string;
  content?: string | null;
  /** Only present on an image-generation response (generateOpenRouterImage) — `modalities: ["text", "image"]`. */
  images?: { type?: string; image_url?: { url?: string } }[];
  /** Only present on a PDF-OCR response (extractPdfTextViaOcr) — the `file-parser` plugin's extracted text, separate from the model's own reply. */
  annotations?: { type?: string; file?: { content?: { type?: string; text?: string }[] } }[];
}

export interface OpenRouterChoice {
  /** `"length"` means the response was cut off by `max_tokens` — genuinely incomplete, not a normal stop. See OpenRouterError.truncated. */
  finish_reason?: string;
  message?: OpenRouterMessage;
}

/** The standard `/chat/completions` response shape — callOpenRouter, generateOpenRouterImage, extractPdfTextViaOcr all hit this same endpoint. */
export interface OpenRouterChatCompletionResponse {
  choices?: OpenRouterChoice[];
  usage?: OpenRouterUsage;
}

/** One SSE `data: {...}` chunk from the streaming chat-completions endpoint (generateOpenRouterAudio, streamOpenRouter). */
export interface OpenRouterStreamChunk {
  choices?: {
    finish_reason?: string;
    delta?: {
      content?: string;
      /** Audio-modality delta (generateOpenRouterAudio) — base64 PCM chunk plus its running transcript. */
      audio?: { data?: string; transcript?: string };
    };
  }[];
  usage?: OpenRouterUsage;
}

/** `/audio/transcriptions` response shape (transcribeAudioViaOpenRouter) — unrelated to the chat-completions shape above. */
export interface OpenRouterTranscriptionResponse {
  text?: string;
  usage?: OpenRouterUsage;
}
