/**
 * Briefing card schema — core situational context for a box.
 *
 * A briefing mixes **structured records in frontmatter** with a **prose
 * body**. The records — `key-people:` and `properties:` — are lists of
 * fielded entries (a person or a property is a record, not prose). The
 * body holds the genuinely free-text material: the `{% purpose %}`
 * statement, `{% correction %}` instructions, and plain prose / headings
 * for things like "Legal" and "Finances" that were always free-form.
 *
 * `compileBriefing` emits the frontmatter records plus the body's Markdoc
 * as markdown for inclusion in CLAUDE.md (via `@`-include). The body
 * emitter lives at `src/core/markdoc-emit.ts`. The frontend renders the
 * records from frontmatter (default card viewer's field table) and the
 * body's `{% purpose %}`/`{% correction %}` tags as styled blocks via
 * `src/frontend/src/components/BriefingTags.tsx`.
 *
 * Root briefing: `briefing.briefing.card` at box root.
 * Directory briefings: `briefing.briefing.card` in any subdirectory.
 */

import { z } from "zod";
import { body, cardSchema, type CardSchema } from "../cards/index.js";
import { emitBodyAsMarkdown } from "../core/markdoc-emit.js";
import { displayFromRef } from "../core/markdoc-emit-tags.js";

const KeyPersonEntry = z.object({
  ref: z.string().optional(),
  called: z.string().optional(),
  role: z.string().optional(),
  notes: z.string().optional(),
});

const PropertyEntry = z.object({
  name: z.string().optional(),
  address: z.string().optional(),
  "address-uncertain": z.boolean().optional(),
  notes: z.string().optional(),
});

export const BriefingSchema: CardSchema = cardSchema("briefing", {
  description: "Core situational context for the box or a directory — what every agent needs to know; one per directory",
  category: "authored",
  fields: {
    "key-people": z.array(KeyPersonEntry).optional(),
    properties: z.array(PropertyEntry).optional(),
    body: body(z.string()),
  },
  instructions: `# Briefing Cards

A briefing card captures the core situational context for a box (or a
directory within a box). It's the primary place for information that
every agent needs to know.

One briefing per directory, at \`briefing.briefing.card\`. The root
briefing describes the whole box. Directory briefings explain what
that directory contains.

A briefing has two parts: **structured records in frontmatter** and a
**prose body**.

**Frontmatter records:**

- \`key-people:\` — a list of the people central to the box's purpose.
  Each entry is \`{ref?, called?, role?, notes?}\`. \`ref\` points at the
  person card (auto-tracked by \`cb validate\` and \`cb mv\`); \`called\`
  is the alias the boxholder uses; \`role\` describes the relationship;
  \`notes\` is a free-form description.
- \`properties:\` — a list of physical properties tied to the box
  (ledger, household, business). Each entry is
  \`{name?, address?, address-uncertain?, notes?}\`; set
  \`address-uncertain: true\` if the address isn't confirmed.

\`\`\`yaml
key-people:
  - ref: people/Dana_Lee
    called: Dad
    role: Ledger subject
    notes: Primary account holder; defer to the sibling group on decisions.
properties:
  - name: The lake house
    address: 12 Shore Rd
    notes: In probate; taxes paid through 2026.
\`\`\`

**Body tags** (free-text material; use as block tags):

- \`{% purpose %}\` — what this box (or directory) is for. Required at
  the box root; optional in directory briefings if the directory
  doesn't need its own purpose statement.
- \`{% correction %}\` — an instruction that overrides default agent
  behaviour, added in response to an observed mistake. Optional
  \`test\` attribute describing how to verify the correction is being
  followed.

For prose sections like "Legal" or "Finances" (which were always
free-form anyway), use plain markdown headings:

\`\`\`markdown
## Legal

The ledger is in probate. Settled creditors include...
\`\`\`

**When to edit a briefing:**

- You learn something that changes how any agent should understand
  this box.
- A new key person is identified: add a \`key-people:\` entry and create
  the person card (\`people/First_Last.person.card\`).
- An agent repeatedly makes a mistake that a correction would
  prevent.

**Do NOT put here:**

- Individual items (those are record/memo cards).
- Processing rules (those go in guide cards).
- Communication style preferences (those go in the personality card).`,
});

export interface KeyPersonRecord {
  ref?: string;
  called?: string;
  role?: string;
  notes?: string;
}

export interface PropertyRecord {
  name?: string;
  address?: string;
  "address-uncertain"?: boolean;
  notes?: string;
}

export interface BriefingFields {
  type: "briefing";
  "key-people"?: KeyPersonRecord[];
  properties?: PropertyRecord[];
  body: string;
}

/** Emit one `**Key Person:** …` line, mirroring the retired body-tag shape. */
function keyPersonLine(entry: KeyPersonRecord): string {
  const ref = entry.ref ?? "";
  const name = entry.called !== undefined && entry.called !== "" ? entry.called : displayFromRef(ref);
  const roleStr = entry.role !== undefined && entry.role !== "" ? ` — ${entry.role}` : "";
  const refStr = ref === "" ? "" : ` [→ ${ref}]`;
  const notes = (entry.notes ?? "").trim();
  const notesStr = notes === "" ? "" : ` — ${notes}`;
  return `**Key Person:** **${name}**${roleStr}${refStr}${notesStr}`;
}

/** Emit one `**Property:** …` line, mirroring the retired body-tag shape. */
function propertyLine(entry: PropertyRecord): string {
  const name = entry.name ?? "";
  const address = entry.address ?? "";
  const heading = name !== "" ? name : (address !== "" ? address : "(unnamed)");
  const uncertain = entry["address-uncertain"] === true;
  const addrStr = address !== "" && address !== name
    ? ` — ${address}${uncertain ? " (uncertain)" : ""}`
    : "";
  const notes = (entry.notes ?? "").trim();
  const notesStr = notes === "" ? "" : ` — ${notes}`;
  return `**Property:** **${heading}**${addrStr}${notesStr}`;
}

/**
 * Compile a briefing into the markdown form that gets `@`-included into
 * CLAUDE.md: the body's Markdoc (`{% purpose %}`, `{% correction %}`,
 * prose) followed by the frontmatter records (`key-people:`,
 * `properties:`) as `**Label:** …` lines. Prepends a section header. The
 * `directoryLabel` parameter is used for directory briefings (e.g.,
 * `"store/archive/financial"`).
 */
export function compileBriefing(fields: BriefingFields, directoryLabel?: string): string {
  const header = directoryLabel !== undefined && directoryLabel !== ""
    ? `## Briefing: ${directoryLabel}`
    : "## Box Briefing";

  const sections: string[] = [];
  const bodyMarkdown = emitBodyAsMarkdown(fields.body);
  if (bodyMarkdown !== "") sections.push(bodyMarkdown.trimEnd());

  const records = [
    ...(fields["key-people"] ?? []).map(keyPersonLine),
    ...(fields.properties ?? []).map(propertyLine),
  ];
  if (records.length > 0) sections.push(records.join("\n\n"));

  if (sections.length === 0) return `${header}\n`;
  return `${header}\n\n${sections.join("\n\n")}\n`;
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
