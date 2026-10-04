#!/usr/bin/env node
/**
 * Side-by-side model benchmark on YOUR real course text (costs a few cents).
 *
 *   OPENROUTER_API_KEY=sk-or-... node scripts/bench-models.mjs path/to/cours.txt [model-a] [model-b] ...
 *
 * Defaults compare the previous and the current CHEAP_MODEL on two real
 * MedArt tasks (a structured résumé and 8 exam QCMs, JSON output). Prints
 * latency, tokens/second, prompt/completion tokens and the exact cost
 * reported by OpenRouter, and writes every raw answer to bench-output/ so
 * medical accuracy can be compared by reading them side by side.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

const [, , sourcePath, ...modelArgs] = process.argv;
const apiKey = process.env.OPENROUTER_API_KEY;
if (!sourcePath || !apiKey) {
  console.error("Usage: OPENROUTER_API_KEY=... node scripts/bench-models.mjs cours.txt [model ...]");
  process.exit(1);
}
// Defaults: every before/after pair of the 2026-10 cost passes (Studio: 3.7 Flash → 3.1 Flash-Lite; CHEAP: qwen-2.5-72b → qwen3-235b).
const models = modelArgs.length > 0 ? modelArgs : ["google/gemini-3.7-flash", "google/gemini-3.1-flash-lite", "qwen/qwen-2.5-72b-instruct", "qwen/qwen3-235b-a22b-2507"];
const source = readFileSync(sourcePath, "utf8").slice(0, 40_000);

const TASKS = {
  resume: `Tu es professeur de médecine. À partir UNIQUEMENT du cours fourni, rédige un résumé structuré en JSON {"sections":[{"titre":"...","points":["..."]}]} : définitions, physiopathologie, clinique, paraclinique, traitement, avec toutes les valeurs chiffrées exactes du texte. N'ajoute aucun fait absent du texte.`,
  qcm: `Tu es examinateur en faculté de médecine. À partir UNIQUEMENT du cours fourni, génère EXACTEMENT 8 QCM en JSON {"questions":[{"vignette":"...","options":["A","B","C","D","E"],"correct":0,"explications":["...x5"]}]}. Une seule bonne réponse par question ; chaque explication doit être vérifiable dans le texte source.`,
};

mkdirSync("bench-output", { recursive: true });
const rows = [];
for (const model of models) {
  for (const [task, system] of Object.entries(TASKS)) {
    const started = Date.now();
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "X-Title": "MedArt bench" },
      body: JSON.stringify({
        model,
        max_tokens: 8000,
        temperature: 0.2,
        response_format: { type: "json_object" },
        usage: { include: true },
        messages: [
          { role: "system", content: system },
          { role: "user", content: `Cours :\n"""\n${source}\n"""` },
        ],
      }),
    });
    const seconds = (Date.now() - started) / 1000;
    const data = await res.json().catch(() => ({}));
    const text = data?.choices?.[0]?.message?.content ?? JSON.stringify(data).slice(0, 500);
    let validJson = false;
    try {
      JSON.parse(text);
      validJson = true;
    } catch {
      validJson = false;
    }
    const usage = data?.usage ?? {};
    const file = `bench-output/${basename(sourcePath)}.${task}.${model.replace(/[/:]/g, "_")}.json`;
    writeFileSync(file, text);
    rows.push({
      model,
      task,
      status: res.status,
      seconds: seconds.toFixed(1),
      tokPerSec: usage.completion_tokens ? (usage.completion_tokens / seconds).toFixed(0) : "-",
      promptTokens: usage.prompt_tokens ?? "-",
      completionTokens: usage.completion_tokens ?? "-",
      costUsd: typeof usage.cost === "number" ? usage.cost.toFixed(5) : "-",
      validJson,
      file,
    });
    console.log(`✓ ${model} · ${task} · ${seconds.toFixed(1)} s`);
  }
}
console.table(rows);
