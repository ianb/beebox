/**
 * The form of `docs/box/whats-new.md`, the person's changelog. Entries are
 * added by hand when work lands (the finish skill), so the check holds them
 * to one shape: a dated line with one category, short, newest first. The word
 * limit and date rule are the agent changelog's. Plan: plan:whats-new.
 */

import { ENTRY_LIKE, MAX_WORDS, realDate } from "./agent-changes.js";

/** New: something to see or use. Changed: works differently. Agent: seen only through what the agent does. */
export const WHATS_NEW_CATEGORIES = ["New", "Changed", "Agent"] as const;

const ENTRY_LINE = /^- (\d{4}-\d{2}-\d{2}) \*\*(\w+)\*\*: (\S.*)$/;
const FORM = `- YYYY-MM-DD **${WHATS_NEW_CATEGORIES.join("|")}**: text`;
const CATEGORIES: ReadonlySet<string> = new Set(WHATS_NEW_CATEGORIES);

/** Every way the doc breaks its form, one message each; empty when it holds. */
export function whatsNewProblems(text: string): string[] {
  const problems: string[] = [];
  let previous: number | null = null;
  for (const [index, raw] of text.split("\n").entries()) {
    if (!ENTRY_LIKE.test(raw)) continue;
    const line = String(index + 1);
    const match = ENTRY_LINE.exec(raw);
    const date = match?.[1];
    const time = date === undefined ? null : realDate(date);
    if (match === null || time === null || !CATEGORIES.has(match[2] ?? "")) {
      problems.push(`line ${line} is not "${FORM}"`);
      continue;
    }
    const words = (match[3] ?? "").split(/\s+/).length;
    if (words > MAX_WORDS) problems.push(`line ${line} has ${String(words)} words; the limit is ${String(MAX_WORDS)}`);
    if (previous !== null && time > previous) problems.push(`line ${line} is out of order; entries are newest first`);
    previous = time;
  }
  return problems;
}
