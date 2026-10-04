/** Shape returned by app/api/lecture-notes/study-kit and rendered by the Audio Studio's tabs. */
export interface LectureFlashcard {
  front: string;
  back: string;
}

export interface LectureHighYieldPoint {
  point: string;
  why: string;
  /** Empty string when the notes mention no classic trap for this point. */
  trap: string;
}

export interface LectureMindmapBranch {
  label: string;
  children: string[];
}

export interface LectureStudyKit {
  flashcards: LectureFlashcard[];
  highYield: LectureHighYieldPoint[];
  mindmap: { center: string; branches: LectureMindmapBranch[] };
}
