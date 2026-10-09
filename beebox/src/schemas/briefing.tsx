/**
 * Briefing card schema — core situational context for a box.
 *
 * A briefing mixes **structured records in frontmatter** with a **prose
 * body**. The records — `key-people:` and `properties:` — are lists of
 * fielded entries (a person or a property is a record, not prose). Chat
 * openers live on the place's landmark (`navigation.openers`), not here. The body holds the
 * genuinely free-text material: the `{% purpose %}` statement,
 * `{% correction %}` instructions, and plain prose / headings
 * for things like "Legal" and "Finances" that were always free-form.
 *
 * `compileBriefing` emits the frontmatter records, the root place's openers,
 * and the body's Markdoc as markdown for inclusion in CLAUDE.md (via `@`-include). The body
 * emitter lives at `src/core/markdoc/emit/core.ts`. The frontend renders the
 * records from frontmatter (default card viewer's field table) and the
 * body's `{% purpose %}`/`{% correction %}` tags as styled blocks via
 * `src/frontend/src/components/BriefingTags.tsx`.
 *
 * Root briefing: `briefing.briefing.card` at box root.
 * Directory briefings: `briefing.briefing.card` in any subdirectory.
 */

import { z } from "zod";
import { body, cardSchema, type InferCardFields } from "../exports/cards.js";
import { emitBodyAsMarkdown } from "../core/markdoc/emit/core.js";
import { displayFromRef } from "../core/markdoc/emit-tags.js";

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

export const BriefingSchema = cardSchema("briefing", {
  brief: "Situational context for a directory",
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
  person card (auto-tracked by \`bbx validate\` and \`bbx mv\`); \`called\`
  is the alias the boxholder uses; \`role\` describes the relationship;
  \`notes\` is a free-form description.
- \`properties:\` — a list of physical properties tied to the box
  (ledger, household, business). Each entry is
  \`{name?, address?, address-uncertain?, notes?}\`; set
  \`address-uncertain: true\` if the address isn't confirmed.

Chat openers live on the place's landmark (\`navigation.openers\`), not on
the briefing.

\`\`\`yaml
key-people:
  - ref: /people/Dana_Lee.person.card
    called: Dad
    role: Ledger subject
    notes: Primary account holder; defer to the sibling group on decisions.
properties:
  - name: The lake house
    address: 12 Shore Rd
    notes: In probate; taxes paid through 2026.
\`\`\`

When the purpose is still the stock stub (\`What this box is for.\`)
and the person opens with "let me tell you what this box is for", ask
them, then write their answer into \`{% purpose %}\`.

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

export type KeyPersonRecord = NonNullable<BriefingFields["key-people"]>[number];
export type PropertyRecord = NonNullable<BriefingFields["properties"]>[number];

export type BriefingFields = InferCardFields<typeof BriefingSchema>;

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

/** Emit one `**Opener:** …` line, so the agent sees what it is suggesting. */
function openerLine(opener: string): string {
  return `**Opener:** ${opener.trim()}`;
}

/**
 * Compile a briefing into the markdown form that gets `@`-included into
 * CLAUDE.md: the body's Markdoc (`{% purpose %}`, `{% correction %}`,
 * prose) followed by the frontmatter records (`key-people:`,
 * `properties:`) and the place's `openers` as `**Label:** …` lines. Prepends
 * a section header. `directoryLabel` is used for directory briefings (e.g.,
 * `"_bookkeeping/archive/financial"`); `openers` are the place's
 * `navigation.openers`, read from its landmark by the caller.
 */
export function compileBriefing(fields: BriefingFields, options?: { directoryLabel?: string; openers?: string[] }): string {
  const directoryLabel = options?.directoryLabel;
  const header = directoryLabel !== undefined && directoryLabel !== ""
    ? `## Briefing: ${directoryLabel}`
    : "## Box Briefing";

  const sections: string[] = [];
  const bodyMarkdown = emitBodyAsMarkdown(fields.body);
  if (bodyMarkdown !== "") sections.push(bodyMarkdown.trimEnd());

  const records = [
    ...(fields["key-people"] ?? []).map(keyPersonLine),
    ...(fields.properties ?? []).map(propertyLine),
    // Openers ride the same `**Label:** …` shape: the agent owns them, so it
    // has to see its current suggestions on every turn to curate them.
    ...(options?.openers ?? []).filter((o) => o.trim() !== "").map(openerLine),
  ];
  if (records.length > 0) sections.push(records.join("\n\n"));

  if (sections.length === 0) return `${header}\n`;
  return `${header}\n\n${sections.join("\n\n")}\n`;
}

/**
 * The default "Reaching me" section: the boxholder's policy for when and how
 * loudly an agent notifies them, in their voice. New boxes get it in the
 * briefing template; the agent guide carries the same text for boxes whose
 * briefing predates it. See docs/notifications.md.
 */
export const REACHING_ME_HEADING = "## Reaching me";
export const REACHING_ME_DEFAULT = `${REACHING_ME_HEADING}

Tell me, quietly, when something failed or you could not understand what I
gave you. Do not tell me that routine work succeeded. A question for me is a
dot unless it blocks something with a date. Things I asked to be told about
are loud. Health problems stay on the dashboard unless they stop something I
asked for. When I ask for a reminder, make a schedule card with \`notify:\`.
When I ask to be told when something happens, make a schedule card that runs
\`bbx changes\` and \`bbx judge\` before any agent.`;

/**
 * Seed briefing template for a new box: the stub purpose and the default
 * "Reaching me" section. The stock openers a fresh box's empty chat offers
 * are on the root landmark (`STOCK_ROOT_OPENERS` in `landmark.ts`).
 *
 * Changing this constant requires `pnpm template-stock:update` — it is a
 * managed stock template (`MANAGED_STOCK_TEMPLATES`), so the superseded hash
 * must be recorded or boxes on the old seed silently park the update.
 */
export function createBriefingTemplate(): string {
  return `---
type: briefing
---
{% purpose %}
What this box is for.
{% /purpose %}

${REACHING_ME_DEFAULT}
`;
}
