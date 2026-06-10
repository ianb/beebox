/**
 * Box search and the `contains:` field — the canonical statement of the
 * writing rule. The agent guide carries the full section; each searchable
 * card type's generated doc gets the short appendix.
 */

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
    "## The `contains:` Field",
    "",
    "Every frontmatter card accepts an optional `contains:` — one sentence",
    "stating what can be found inside the card. It is the prime retrieval field",
    "for search and listings. The writing rule:",
    "",
    "- When the information is concise, the sentence carries the information",
    '  itself ("Dentist moved to June 17; confirmation in this email"), not a',
    '  pointer at it ("contains scheduling information").',
    "- When it isn't concise, the sentence says what's learnable here.",
    "- Never a list of parts. Keep it under 200 characters (validation warns).",
    "",
    "Write `contains:` when creating or substantially editing a searchable",
    "card. If you edit a card's content and its `contains:` still holds,",
    'confirm it with `cb contains update <card> --text "...same text..."` —',
    "that clears the staleness flag. `cb contains list --missing` /",
    "`--stale` shows the worklist.",
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
