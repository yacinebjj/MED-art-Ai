/**
 * A student's flashcard history for one course (studio_courses.flashcard_queue):
 * every card served to them, oldest first, each with its language. It is
 * what "unseen" is computed against (app/api/flashcards/generate), what the
 * review pool draws from (app/api/flashcards/pool) and where a card is looked
 * up by id (app/api/flashcards/card, lib/push/dispatch.ts).
 *
 * It used to grow without end: every batch appended up to 50 cards and the
 * whole array was read back on every batch, review and push. It now keeps
 * the newest FLASHCARD_HISTORY_PER_LANGUAGE cards of each language. Older
 * cards count as unseen again, so a student who has gone through that many
 * cards of one course is served them again as review before any new
 * generation is needed.
 */

/** Cards kept per course and per language: the newest ones. */
export const FLASHCARD_HISTORY_PER_LANGUAGE = 500;

/** One served card. `lang` is absent on cards served before languages existed — those were French. */
export interface FlashcardHistoryCard {
  id: string;
  question: string;
  answer: string;
  lang?: string;
}

/**
 * Appends `served` to `history`, then keeps only the newest
 * `perLanguage` cards of each language, in their original order. The cap
 * is per language so that studying in one language never pushes the other
 * language's cards out — a course with no card left in a language counts as
 * never drawn there, and entering it is charged again (generate route).
 * Cards already in the history (same id) are not added twice, and entries
 * that are not cards are dropped.
 *
 * @param history - The course's current history, oldest first (null = empty).
 * @param served - The cards just served, in serving order.
 * @param perLanguage - Cards kept per language (default FLASHCARD_HISTORY_PER_LANGUAGE).
 * @returns The new history, oldest first.
 */
export function appendToFlashcardHistory<T extends FlashcardHistoryCard>(
  history: readonly T[] | null | undefined,
  served: readonly T[],
  perLanguage: number = FLASHCARD_HISTORY_PER_LANGUAGE
): T[] {
  const isCard = (card: unknown): card is T => !!card && typeof card === "object" && typeof (card as T).id === "string";
  const known = new Set<string>();
  const merged: T[] = [];
  for (const card of [...(history ?? []), ...served]) {
    if (!isCard(card) || known.has(card.id)) continue;
    known.add(card.id);
    merged.push(card);
  }

  const keptPerLanguage = new Map<string, number>();
  const kept: T[] = [];
  for (let i = merged.length - 1; i >= 0; i--) {
    const language = merged[i].lang ?? "fr";
    const count = keptPerLanguage.get(language) ?? 0;
    if (count >= perLanguage) continue;
    keptPerLanguage.set(language, count + 1);
    kept.push(merged[i]);
  }
  return kept.reverse();
}
