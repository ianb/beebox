/**
 * Box search — how to *find* cards. Making a card findable (the `contains:`
 * writing rule + worklist commands) is canonical in ABOUT_CARDS
 * (agent-guide/cards.ts); each searchable card type's generated doc still gets
 * the short appendix below.
 */

import { SECTION, xref } from "./sections.js";

export function searchSection(): string {
  return `## Searching the Box

\`bbx search "<query>"\` is full-text search over the box's cards — prefer it over
\`grep\` for finding cards by content: it understands card structure, ranks by
relevance, and weights the \`contains:\` field heavily. Standalone \`.md\` files
index too (as kind \`markdown\`); operational card types (jobs, runs) aren't
indexed — find those with \`bbx ls\`.

**Query style:** when the box has an embeddings key configured, search ranks by
*meaning* as well as words (each card's \`contains:\` sentence is matched
semantically, fused with keyword ranking). So for vague recall, describe the
card in one sentence — shaped like the \`contains:\` line you hope exists — and
include any exact tokens you remember (names, numbers, IDs): the sentence
carries the semantic match, the rare tokens nail the keyword match. Both in one
query is the optimum, not a compromise. For an exact-identifier hunt the bare
token alone works. Without an embeddings key, ranking is keyword-only: lead
with distinctive words. Either way it's relevance-ranked — quoting a phrase
does not do exact-match.

Examples:

- \`bbx search "the letter about the pension from the insurance company"\` — vague
  recall: describe it; meaning-ranked even though no word may match exactly
- \`bbx search "dentist appointment moved to a new date" --kind email-message\` —
  a summary-shaped sentence, emails only
- \`bbx search "Maria phone" --path people\` — exact tokens + a path filter
- \`bbx search "10494" --mode text\` — an exact identifier; \`--mode text\` forces
  keyword-only ranking (offline, deterministic)

**Filters:** \`--kind <type>\` (repeatable), \`--path <prefix>\`, \`--limit N\`
(default 10); \`--mode <text|hybrid>\` (omitted = automatic: semantic+keyword
when available); \`--json\` for the structured envelope.

**A result** shows the card's path (with a \`#fragment\` locator when the match is
inside the card) and title, then the card's \`contains:\` sentence and a matched
excerpt — so you see both *which* card and *where* in it. A truncated run reports
"N of total."

To make a card findable in the first place, write it a good \`contains:\` — the
rule and the \`bbx contains\` worklist commands are in ${xref(SECTION.ABOUT_CARDS)}.
`;
}

/** Appended to every searchable card type's docs/generated/card-<type>.md. */
export const CONTAINS_DOC_APPENDIX = `## The \`contains:\` field

Give this card a one-sentence \`contains:\` — the prime retrieval field for
\`bbx search\` and listings. How to write a good one (carry the information when
it's concise, never a list of parts, under 200 characters) is in the agent
guide's ABOUT_CARDS section.`;
