export interface CourseViewerProps {
  /** Course title; also the fallback for detecting the file type when the URL has no extension. */
  title: string;
  /** Public URL of the original uploaded file (studio_courses.source_file_url). null → extracted text only. */
  fileUrl: string | null;
  /** Server-extracted text: shown for pasted-text courses and whenever the file can't be rendered. */
  rawText: string;
  onClose: () => void;
}
