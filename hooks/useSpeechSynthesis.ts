"use client";

import { useSyncExternalStore } from "react";

/**
 * Read-aloud for assistant replies via the browser's built-in
 * `speechSynthesis` — zero API cost, works offline on most devices, and
 * (unlike a generated-audio endpoint) starts instantly. One reply speaks at
 * a time; starting another stops the first. State lives at module scope so
 * every message's button shares it through useSyncExternalStore.
 */

type Listener = () => void;
const listeners = new Set<Listener>();
let speakingId: string | null = null;
// Bumped on every stop/start so the queued-utterance callbacks of a
// cancelled reply can tell they are stale and must not chain the next chunk.
let generation = 0;

function setSpeakingId(next: string | null) {
  speakingId = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isSpeechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
}

/** Markdown -> plain prose a voice can read: no fences, table pipes, heading marks, link URLs or emoji. */
export function toSpeakableText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*[-*+•]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/^\s*\|?[\s:|-]{3,}\|?\s*$/gm, " ")
    .replace(/\|/g, ", ")
    .replace(/[*_~#>]+/g, "")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, ", ")
    .trim();
}

const FRENCH_HINTS = /\b(le|la|les|des|une|est|sont|pour|avec|dans|qui|que|et|du|au|ce|cette|sur|par)\b/gi;
const ENGLISH_HINTS = /\b(the|and|is|are|of|with|for|that|this|which|to|in|on|by|from)\b/gi;

/** BCP-47 tag for the reply: Arabic script wins, then a French-vs-English word count, else the app language. */
export function detectSpeechLang(text: string, appLanguage: "fr" | "en"): string {
  const sample = text.slice(0, 600);
  const arabic = (sample.match(/[؀-ۿ]/g) ?? []).length;
  const letters = (sample.match(/[A-Za-zÀ-ÿ؀-ۿ]/g) ?? []).length;
  if (letters > 0 && arabic / letters > 0.3) return "ar-SA";
  const french = (sample.match(FRENCH_HINTS) ?? []).length;
  const english = (sample.match(ENGLISH_HINTS) ?? []).length;
  if (french === 0 && english === 0) return appLanguage === "en" ? "en-US" : "fr-FR";
  return english > french ? "en-US" : "fr-FR";
}

// Chrome cuts a single utterance off after ~15s, so speak sentence-sized pieces.
function chunkForSpeech(text: string, maxChars = 180): string[] {
  const sentences = text.match(/[^.!?؟…]+[.!?؟…]*\s*/g) ?? [text];
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (current && current.length + sentence.length > maxChars) {
      chunks.push(current.trim());
      current = "";
    }
    if (sentence.length > maxChars) {
      for (let i = 0; i < sentence.length; i += maxChars) chunks.push(sentence.slice(i, i + maxChars).trim());
    } else {
      current += sentence;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter(Boolean);
}

export function stopSpeaking(): void {
  if (!isSpeechSupported()) return;
  generation++;
  window.speechSynthesis.cancel();
  setSpeakingId(null);
}

export type SpeakResult = { ok: true } | { ok: false; reason: "unsupported" | "empty" | "no-voice"; lang?: string };

/**
 * `onError` fires (once) when the browser itself fails the utterance after it
 * was accepted — e.g. "not-allowed" (no recent tap), "audio-busy",
 * "synthesis-failed". A stop initiated by the user ("interrupted"/"canceled")
 * is NOT an error and never reaches it.
 */
export function speak(id: string, markdown: string, appLanguage: "fr" | "en", onError?: (code: string) => void): SpeakResult {
  if (!isSpeechSupported()) return { ok: false, reason: "unsupported" };
  const text = toSpeakableText(markdown);
  if (!text) return { ok: false, reason: "empty" };

  const lang = detectSpeechLang(text, appLanguage);
  const prefix = lang.slice(0, 2).toLowerCase();
  const voices = window.speechSynthesis.getVoices();
  // An empty list just means the browser hasn't loaded voices yet — speak
  // anyway; only refuse when voices ARE listed and none speaks this language.
  const voice = voices.find((v) => v.lang.toLowerCase().startsWith(prefix));
  if (voices.length > 0 && !voice) return { ok: false, reason: "no-voice", lang };

  window.speechSynthesis.cancel();
  const myGeneration = ++generation;
  const chunks = chunkForSpeech(text);
  setSpeakingId(id);

  const speakChunk = (index: number) => {
    if (generation !== myGeneration) return;
    if (index >= chunks.length) {
      setSpeakingId(null);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(chunks[index]);
    utterance.lang = lang;
    if (voice) utterance.voice = voice;
    utterance.rate = 0.95; // a touch slower: medical terms are easier to catch
    utterance.onend = () => speakChunk(index + 1);
    utterance.onerror = (event) => {
      if (generation !== myGeneration) return;
      setSpeakingId(null);
      if (event.error !== "interrupted" && event.error !== "canceled") onError?.(event.error);
    };
    window.speechSynthesis.speak(utterance);
  };
  speakChunk(0);
  return { ok: true };
}

/** Which reply (if any) is being read aloud right now. */
export function useSpeakingId(): string | null {
  return useSyncExternalStore(subscribe, () => speakingId, () => null);
}
