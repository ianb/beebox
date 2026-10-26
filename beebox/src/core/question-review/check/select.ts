/**
 * Which questions the daily `question-review` procedure takes up
 * (`docs/implemented-plans/questions-later-and-figure-it-out.md`, Track F).
 *
 * A pure function over already-loaded cards, so thresholds, the latch, and the
 * cap are testable without a box. The thresholds live here and nowhere else.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** A put-away question with no box decision comes back for review after this long. */
export const DISMISSED_REVIEW_AFTER_MS = 3 * MS_PER_DAY;
/** A question still waiting for the person after this long comes back for review. */
export const PENDING_REVIEW_AFTER_MS = 14 * MS_PER_DAY;
/** A question reviewed within this window is not taken up again. */
export const REVIEW_LATCH_WINDOW_MS = 14 * MS_PER_DAY;
/** Most questions one brief carries; the rest stay eligible for later runs. */
export const MAX_QUESTIONS_PER_REVIEW = 5;

/** One valid question card as selection sees it. */
export interface ReviewCandidate {
  /** Box-relative path. */
  path: string;
  prompt: string;
  state: "pending" | "answered" | "dismissed" | "expired";
  askedAt: string | undefined;
  dismissedAt: string | undefined;
  hasProvisional: boolean;
}

export interface SelectedQuestion {
  path: string;
  prompt: string;
  state: "pending" | "dismissed";
  /** When the wait began: `dismissed-at` for a dismissed question, `asked-at` for a pending one. */
  since: string;
  /** Milliseconds from `since` to now. */
  waitedMs: number;
}

/** The questions to review now, oldest wait first, at most {@link MAX_QUESTIONS_PER_REVIEW}. */
export function selectQuestionsForReview(input: {
  candidates: readonly ReviewCandidate[];
  /** Question path to the ISO time it was last reviewed. */
  reviewed: Readonly<Record<string, string>>;
  now: Date;
}): SelectedQuestion[] {
  const nowMs = input.now.getTime();
  const selected: SelectedQuestion[] = [];

  for (const candidate of input.candidates) {
    const entry = qualifies(candidate, nowMs);
    if (entry === null) continue;
    const reviewedAt = input.reviewed[candidate.path];
    if (reviewedAt !== undefined && nowMs - Date.parse(reviewedAt) < REVIEW_LATCH_WINDOW_MS) continue;
    selected.push(entry);
  }

  return selected
    .toSorted((a, b) => b.waitedMs - a.waitedMs || a.path.localeCompare(b.path))
    .slice(0, MAX_QUESTIONS_PER_REVIEW);
}

function qualifies(candidate: ReviewCandidate, nowMs: number): SelectedQuestion | null {
  if (candidate.state === "dismissed") {
    if (candidate.hasProvisional || candidate.dismissedAt === undefined) return null;
    return entryIf(candidate, { state: "dismissed", since: candidate.dismissedAt, thresholdMs: DISMISSED_REVIEW_AFTER_MS, nowMs });
  }
  if (candidate.state === "pending") {
    if (candidate.askedAt === undefined) return null;
    return entryIf(candidate, { state: "pending", since: candidate.askedAt, thresholdMs: PENDING_REVIEW_AFTER_MS, nowMs });
  }
  return null;
}

function entryIf(
  candidate: ReviewCandidate,
  { state, since, thresholdMs, nowMs }: { state: "pending" | "dismissed"; since: string; thresholdMs: number; nowMs: number },
): SelectedQuestion | null {
  const waitedMs = nowMs - Date.parse(since);
  if (waitedMs < thresholdMs) return null;
  return { path: candidate.path, prompt: candidate.prompt, state, since, waitedMs };
}
