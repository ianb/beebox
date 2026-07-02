/**
 * Briefing vocabulary: the five body tags a briefing card is written in.
 * Reference for agents editing briefings.
 */

export function briefingTagsSection(): string[] {
  return [
    "## Briefing Tags",
    "",
    "Briefing cards (`*.briefing.card`) carry their semantic content in",
    "the body as Markdoc tags (the frontmatter carries nothing beyond the",
    "shared envelope). Five tags cover the briefing vocabulary:",
    "",
    "- `{% purpose %}what this box is for{% /purpose %}` — block. One",
    "  per briefing; required at the box root.",
    "- `{% key-person ref=\"/box/people/dana.person.card\" called=\"Dad\"" +
      " role=\"...\" %}description{% /key-person %}` — block. One tag per",
    "  person. `ref` points at the person card; `called` is the alias",
    "  the boxholder uses; `role` describes the relationship.",
    "- `{% correction test=\"how to verify\" %}don't archive items before" +
      " reading them through{% /correction %}` — block. Add one in",
    "  response to an observed agent mistake; the `test` attribute",
    "  describes how to verify the correction is being followed.",
    "- `{% property name=\"...\" address=\"...\" %}description{% /property %}`",
    "  — block. A physical property tied to the box. Optional",
    "  `address-uncertain=true` if the address isn't confirmed.",
    "- `{% project-phase date=\"2026-05-01\" %}what this phase means{%" +
      " /project-phase %}` — block. Use when the box's current phase",
    "  matters (probate, active development, etc.).",
    "",
    "For prose sections that don't map to a structured tag — \"Legal,\"",
    "\"Finances,\" general notes — use plain markdown headings and",
    "paragraphs. Don't invent a tag for everything.",
    "",
    "The briefing card is the source of truth; `cb init` compiles it",
    "into the `@`-included CLAUDE.md. Edit the card, not the compiled",
    "output.",
    "",
  ];
}
