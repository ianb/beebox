/**
 * NAMED_SECTIONS — stable, cross-referenceable names for prompt sections.
 *
 * A section's heading and every cross-reference to it derive from one constant
 * here, so a reference can never drift from the heading it points at. Values are
 * all-caps so a cross-reference lands unambiguously when the model scans the
 * prompt. Referenceable from any prompt (the agent guide, the chat/reactor
 * system prompts), not just the section that owns the heading.
 *
 * Grows as sections adopt the pattern: add an entry when a section gets a name
 * worth referring to from elsewhere, and render both its heading and every
 * pointer to it through this constant.
 */
export const SECTION = {
  LAWS: "THE LAWS",
  LAW_OF_QUOTING: "THE LAW OF QUOTING",
  LAW_OF_SAVING: "THE LAW OF SAVING",
  LAW_OF_CARDS: "THE LAW OF CARDS",
  ABOUT_CARDS: "ABOUT CARDS",
  DIRECT_QUOTES: "DIRECT QUOTES",
} as const;

export type SectionName = (typeof SECTION)[keyof typeof SECTION];

/**
 * Inline cross-reference to a named section — bold, and byte-for-byte the
 * section's heading text, so `see ${xref(SECTION.ABOUT_CARDS)}` always matches
 * the real heading.
 */
export function xref(name: SectionName): string {
  return `**${name}**`;
}
