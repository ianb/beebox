/**
 * Box search — how to *find* cards. Making a card findable (the `contains:`
 * writing rule + worklist commands) is canonical in ABOUT_CARDS
 * (agent-guide/cards.ts); each searchable card type's generated doc still gets
 * the short appendix below.
 */

import { SECTION, xref } from "./sections.js";

export function searchSection(): string {
  return `## Searching the Box

\`cb search "<query>"\` is full-text search over the box's cards — prefer it over
\`grep\` for finding cards by content: it understands card structure, ranks by
relevance, and weights the \`contains:\` field heavily. Standalone \`.md\` files
index too (as kind \`markdown\`); operational card types (jobs, runs) aren't
indexed — find those with \`cb ls\`.

**Query style:** lead with the distinctive words you remember — names, unusual
terms, numbers. Extra words help only when they describe the specific target;
generic domain words dilute the ranking. It's relevance-ranked, not exact-match
— there is no keyword or quoted-phrase mode.

Examples:

- \`cb search "carbonara"\` — find the pasta recipe
- \`cb search "dentist reschedule" --kind email-message\` — the email about it, emails only
- \`cb search "Maria phone" --path people\` — her number, under \`people/\`

**Filters:** \`--kind <type>\` (repeatable), \`--path <prefix>\`, \`--limit N\`
(default 10); \`--json\` for the structured envelope.

**A result** shows the card's path (with a \`#fragment\` locator when the match is
inside the card) and title, then the card's \`contains:\` sentence and a matched
excerpt — so you see both *which* card and *where* in it. A truncated run reports
"N of total."

To make a card findable in the first place, write it a good \`contains:\` — the
rule and the \`cb contains\` worklist commands are in ${xref(SECTION.ABOUT_CARDS)}.
`;
}

/** Appended to every searchable card type's docs/generated/card-<type>.md. */
export const CONTAINS_DOC_APPENDIX = `## The \`contains:\` field

Set \`contains:\` to one sentence stating what can be found in this card —
the prime retrieval field for search and listings. When the information is
concise, the sentence carries the information itself ("Dentist moved to
June 17; confirmation in this email"), not a pointer at it ("contains
scheduling information"); when it isn't concise, the sentence says what's
learnable here. Never a list of parts. Keep it under 200 characters.`;
