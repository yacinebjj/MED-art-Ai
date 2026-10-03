/**
 * Display name of the AI engine shown in the Topbar badge. Mirrors the model
 * constants in lib/ai/openrouter.ts (CHEAP_MODEL = qwen-2.5-72b-instruct for
 * Studio/Lab, FLASHCARD_MODEL = qwen3-30b-a3b-instruct-2507 for flashcards);
 * that module is server-side, so the label is duplicated here rather than
 * imported into the client bundle. Update both together.
 */
export const FLASHCARD_ENGINE_LABEL = "Qwen AI Engine";
