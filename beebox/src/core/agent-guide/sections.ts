/**
 * NAMED_SECTIONS — stable, cross-referenceable names for prompt sections.
 *
 * A section's heading and every cross-reference to it derive from one constant
 * here, so a reference can never drift from the heading it points at.
 *
 * Values are `UPPER_SNAKE_CASE`: all-caps so they stand out when the model
 * scans, and **underscored so a reference reads as one atomic token** — clearly
 * a pointer to a named section, not just an emphasized phrase. A heading renders
 * as `## ABOUT_CARDS`; an inline pointer renders as `xref(SECTION.ABOUT_CARDS)`
 * → `**ABOUT_CARDS**`; a bare in-prose mention is `${SECTION.ABOUT_CARDS}`.
 * Referenceable from any prompt (the agent guide, the chat/reactor system
 * prompts), not just the section that owns the heading.
 *
 * This is the layout. It grows as sections adopt the pattern: add an entry when
 * a section gets a name worth referring to from elsewhere, and render both its
 * heading and every pointer to it through this constant.
 */
export const SECTION = {
  // The Laws — inviolable, first in the guide.
  LAWS: "THE_LAWS",
  LAW_OF_QUOTING: "THE_LAW_OF_QUOTING",
  LAW_OF_SAVING: "THE_LAW_OF_SAVING",
  LAW_OF_CARDS: "THE_LAW_OF_CARDS",

  // Cards — the canonical concept surface, its catalogue, and asking the user.
  ABOUT_CARDS: "ABOUT_CARDS",
  CARD_TYPES: "CARD_TYPES",
  QUESTIONS: "QUESTIONS",
  TODOS: "TODOS",

  // Output vocabulary — verbatim quotes and provenance (the `ref`/`href` home).
  DIRECT_QUOTES: "DIRECT_QUOTES",
  PROVENANCE: "PROVENANCE",
} as const;

export type SectionName = (typeof SECTION)[keyof typeof SECTION];

/**
 * Inline cross-reference to a named section — bold, and byte-for-byte the
 * section's heading text, so `see ${xref(SECTION.ABOUT_CARDS)}` always matches
 * the real heading. Use for an explicit "go read that section" pointer; use a
 * bare `${SECTION.X}` when merely naming the section in prose.
 */
export function xref(name: SectionName): string {
  return `**${name}**`;
}
