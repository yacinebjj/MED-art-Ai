/**
 * One Anki-style Q&A flashcard, pooled from a course's own
 * `studio_courses.flashcard_queue` (see supabase/schema.sql). Deliberately
 * NOT QCM-shaped anymore — no options/correct-answer-labels/explanation —
 * this feature moved entirely away from multiple-choice (see
 * lib/ai/flashcard-prompts.ts's header comment).
 */
export interface FlashcardPoolItem {
  id: string;
  question: string;
  answer: string;
  courseTitle: string;
  moduleId: number;
}
