/** EXAM GENOME — refusals of a contribution, with the outcome recorded in eg_contributions. Kept apart from ingest.ts so that routes which never ingest do not load the OCR client. */
export type ContributionOutcome = "ingested" | "duplicate" | "out_of_scope" | "unreadable" | "not_an_exam" | "rejected";

export class GenomeIngestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly outcome: ContributionOutcome,
    readonly details: Record<string, unknown> = {}
  ) {
    super(message);
  }
}
