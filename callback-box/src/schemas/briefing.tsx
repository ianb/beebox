/**
 * Briefing card schema — core situational context for a box.
 *
 * Frontmatter is identity-only (just `type: briefing`); all semantic
 * content lives in the body as Markdoc tags: `{% purpose %}`,
 * `{% key-person %}`, `{% correction %}`, `{% property %}`,
 * `{% project-phase %}`, plus plain prose / headings / lists for things
 * like "Legal" and "Finances" that were always free-form anyway.
 *
 * `compileBriefing` parses the body and emits markdown for inclusion in
 * CLAUDE.md (via `@`-include). The renderer for the body lives at
 * `src/core/markdoc-emit.ts`. The frontend renders the same tags as
 * styled blocks via `src/frontend/src/components/BriefingTags.tsx`.
 *
 * Root briefing: `briefing.briefing.card` at box root.
 * Directory briefings: `briefing.briefing.card` in any subdirectory.
 */

import { z } from "zod";
import { body, cardSchema, type CardSchema } from "../cards/index.js";
import { emitBodyAsMarkdown } from "../core/markdoc-emit.js";

export const BriefingSchema: CardSchema = cardSchema("briefing", {
  description: "Core situational context for the box or a directory — what every agent needs to know; one per directory",
  category: "authored",
  fields: {
    body: body(z.string()),
  },
  instructions: `# Briefing Cards

A briefing card captures the core situational context for a box (or a
directory within a box). It's the primary place for information that
every agent needs to know.

One briefing per directory, at \`briefing.briefing.card\`. The root
briefing describes the whole box. Directory briefings explain what
that directory contains.

**Frontmatter:** just \`type: briefing\`. All semantic content lives
in the body as Markdoc tags.

**Body tags** (use as block tags; one per concept):

- \`{% purpose %}\` — what this box (or directory) is for. Required at
  the box root; optional in directory briefings if the directory
  doesn't need its own purpose statement.
- \`{% key-person ref="people/dana" called="Dad" role="..." %}\` —
  someone central to the box's purpose. \`ref\` points at the person
  card (auto-tracked by \`cb validate\` and \`cb mv\`). \`called\` is
  the alias the boxholder uses; \`role\` describes the relationship.
  The body of the tag is a free-form description.
- \`{% correction %}\` — an instruction that overrides default agent
  behaviour, added in response to an observed mistake. Optional
  \`test\` attribute describing how to verify the correction is being
  followed.
- \`{% property name="..." address="..." %}\` — a physical property
  tied to the box (ledger, household, business). Optional
  \`address-uncertain\` boolean if the address isn't confirmed.
  Body is a free-form description.
- \`{% project-phase date="2026-05-01" %}\` — current phase / status.
  Body explains what the phase means.

For prose sections like "Legal" or "Finances" (which were always
free-form anyway), use plain markdown headings:

\`\`\`markdown
## Legal

The ledger is in probate. Settled creditors include...
\`\`\`

**When to edit a briefing:**

- You learn something that changes how any agent should understand
  this box.
- A new key person is identified (create a person card too:
  \`people/First_Last.person.card\`).
- The project enters a new phase.
- An agent repeatedly makes a mistake that a correction would
  prevent.

**Do NOT put here:**

- Individual items (those are record/memo cards).
- Processing rules (those go in guide cards).
- Communication style preferences (those go in the personality card).`,
});

export interface BriefingFields {
  type: "briefing";
  body: string;
}

/**
 * Compile a briefing into the markdown form that gets `@`-included
 * into CLAUDE.md. Walks the body's parsed Markdoc and emits markdown
 * via `emitBodyAsMarkdown`; prepends a section header. The
 * `directoryLabel` parameter is used for directory briefings (e.g.,
 * `"store/archive/financial"`).
 */
export function compileBriefing(fields: BriefingFields, directoryLabel?: string): string {
  const header = directoryLabel !== undefined && directoryLabel !== ""
    ? `## Briefing: ${directoryLabel}`
    : "## Box Briefing";
  const bodyMarkdown = emitBodyAsMarkdown(fields.body);
  if (bodyMarkdown === "") return `${header}\n`;
  return `${header}\n\n${bodyMarkdown}`;
}

/**
 * Seed briefing template for a new box. Empty body; the boxholder
 * fills in `{% purpose %}` and other tags as the box grows.
 */
export function createBriefingTemplate(): string {
  return `---
type: briefing
---
{% purpose %}
What this box is for.
{% /purpose %}
`;
}
