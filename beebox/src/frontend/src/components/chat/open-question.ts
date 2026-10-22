/**
 * Which pending question the empty root chat asks (docs/implemented-plans/front-door.md,
 * Track A). The box starts with one question; any box with pending questions
 * shows its newest in the empty root chat, one at a time, with the count of
 * the others. Pure, so the choice is testable without a DOM.
 */

import type { QuestionInfo } from "../questions/QuestionForm";

/** What the empty chat shows and the send carries: one pending question card. */
export interface OpenQuestion {
  /** Box-relative card path; the send payload's `openQuestion`. */
  path: string;
  prompt: string;
  memo: string | null;
  inputType: "text" | "select" | "confirm";
  /** The labels of a select question, listed in the line itself: the first `OPTIONS_SHOWN` of them. */
  options: string[];
  /** How many select options beyond `options` the Questions page holds; 0 when all are listed. */
  optionsBeyond: number;
  /** How many other pending questions wait on the Questions page. */
  more: number;
}

/** A select question lists at most this many options in its line; the rest are on the Questions page. */
const OPTIONS_SHOWN = 6;

/**
 * The newest pending question with a prompt, by `asked-at` then by path, and
 * how many other pending cards there are. A card that failed to parse
 * (`invalid`) has no prompt to ask, so it is never shown, but it counts toward
 * `more` so the Questions page link still reaches it: a card the scan could
 * not read has no `state`, so an invalid card counts whenever it is not known
 * to be settled. Null when nothing is pending.
 */
export function pickOpenQuestion(items: readonly QuestionInfo[]): OpenQuestion | null {
  const pending = items.filter((q) => q.state === "pending" || (q.invalid === true && q.state === undefined));
  const askable = pending
    .filter((q) => q.invalid !== true && q.prompt !== undefined)
    .toSorted((a, b) => (b.askedAt ?? "").localeCompare(a.askedAt ?? "") || b.relativePath.localeCompare(a.relativePath));
  const [newest] = askable;
  if (newest === undefined || newest.prompt === undefined) return null;
  return {
    path: newest.relativePath,
    prompt: newest.prompt,
    memo: newest.memo === undefined || newest.memo.trim() === "" ? null : newest.memo,
    inputType: newest.inputType ?? "text",
    options: (newest.options ?? []).slice(0, OPTIONS_SHOWN),
    optionsBeyond: Math.max(0, (newest.options ?? []).length - OPTIONS_SHOWN),
    more: pending.length - 1,
  };
}

/**
 * The question as one spoken line. A select question lists its options in the
 * sentence ("Finance or Personal?"), since the person answers by typing or
 * speaking and the agent passes the label; no buttons (question 13 in the
 * plan), and no choice the card cannot record. Past `OPTIONS_SHOWN` the line
 * says how many more the Questions page holds. Text and confirm prompts read
 * as written.
 */
export function openQuestionLine(question: Pick<OpenQuestion, "prompt" | "inputType" | "options" | "optionsBeyond">): string {
  if (question.inputType !== "select" || question.options.length === 0) return question.prompt;
  const choices = question.optionsBeyond > 0 ? [...question.options, `one of ${question.optionsBeyond} more`] : question.options;
  const listed = choices.length === 1 ? choices[0] : choices.length === 2 ? choices.join(" or ") : `${choices.slice(0, -1).join(", ")}, or ${choices.at(-1)}`;
  return `${question.prompt} ${listed}?`;
}

/** "and N more" for the other pending questions; null when this is the only one. */
export function moreQuestionsLabel(more: number): string | null {
  return more <= 0 ? null : `and ${more} more`;
}
