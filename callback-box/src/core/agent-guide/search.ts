/**
 * Box search. The `contains:` field's writing rule is canonical in ABOUT_CARDS
 * (agent-guide/cards.ts); this section only covers searching, and each
 * searchable card type's generated doc still gets the short appendix.
 */

import { SECTION, xref } from "./sections.js";

export function searchSection(): string[] {
  return [
    "## Searching the Box",
    "",
    '`cb search "<query>"` is full-text search over the box\'s cards — prefer it',
    "over grep when looking for cards by content: it understands card structure,",
    "ranks results, and weights the `contains:` field heavily. Filters:",
    "`--kind <type>`, `--path <prefix>`, `--limit N`; `--json` for the structured",
    "envelope. Standalone `.md` files index too (kind `markdown`). Operational",
    "card types (jobs, runs) are not indexed — find those with `cb ls` under",
    "`box/jobs/`. Query style: lead with the distinctive words you remember",
    "(names, unusual terms, numbers); extra descriptive words help when they",
    "describe the specific target, but generic domain words dilute ranking.",
    "",
    `Search ranks the \`contains:\` field heavily; how to write a good one is in ${xref(SECTION.ABOUT_CARDS)}.`,
    "`cb contains list --missing` / `--stale` shows cards whose `contains:` needs writing or refreshing.",
    "",
  ];
}

/** Appended to every searchable card type's docs/generated/card-<type>.md. */
export const CONTAINS_DOC_APPENDIX = `## The \`contains:\` field

Set \`contains:\` to one sentence stating what can be found in this card —
the prime retrieval field for search and listings. When the information is
concise, the sentence carries the information itself ("Dentist moved to
June 17; confirmation in this email"), not a pointer at it ("contains
scheduling information"); when it isn't concise, the sentence says what's
learnable here. Never a list of parts. Keep it under 200 characters.`;
