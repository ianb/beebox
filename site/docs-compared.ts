// Compared pages (plan: "Comparisons"): the caveat block the build generates
// from `compared:` frontmatter, rather than trusting hand-written prose to
// stay accurate.

import type { ComparedFrontmatter } from "./docs-types.js";

const STALE_DAYS = 180;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Render the caveat block prepended to a compared/ page, after its header
 * line. `now` is injectable for tests; defaults to the real current time.
 */
export function renderComparedCaveat(compared: ComparedFrontmatter, params?: { now?: Date }): string[] {
  const now = params?.now ?? new Date();
  const lines = [
    `Compared: ${compared.date} — ${compared.subject}; Bee Box at ${compared.beebox}`,
    `Looked for: ${compared["looked-for"].join(", ")}`,
    `Not looked for: ${compared["not-looked-for"].join(", ")}`,
    "Since then: both projects have changed; treat this page as a snapshot.",
  ];
  const ageDays = (now.getTime() - new Date(compared.date).getTime()) / MS_PER_DAY;
  if (ageDays > STALE_DAYS) {
    lines.push("Stale: this comparison is more than six months old.");
  }
  return lines;
}
