/**
 * Briefing card schema — core situational context for a box.
 *
 * A briefing mixes **structured records in frontmatter** with a **prose
 * body**. The records — `key-people:`, `properties:` and `openers:` — are
 * lists of fielded entries or plain strings (a person, a property, or a
 * suggested chat opener is a record, not prose). The body holds the
 * genuinely free-text material: the `{% purpose %}` statement,
 * `{% correction %}` instructions, and plain prose / headings
 * for things like "Legal" and "Finances" that were always free-form.
 *
 * `compileBriefing` emits the frontmatter records plus the body's Markdoc
 * as markdown for inclusion in CLAUDE.md (via `@`-include). The body
 * emitter lives at `src/core/markdoc/emit.ts`. The frontend renders the
 * records from frontmatter (default card viewer's field table) and the
 * body's `{% purpose %}`/`{% correction %}` tags as styled blocks via
 * `src/frontend/src/components/BriefingTags.tsx`.
 *
 * Root briefing: `briefing.briefing.card` at box root.
 * Directory briefings: `briefing.briefing.card` in any subdirectory.
 */

import { z } from "zod";
import { body, cardSchema, type InferCardFields } from "../cards/index.js";
import { emitBodyAsMarkdown } from "../core/markdoc/emit.js";
import { displayFromRef } from "../core/markdoc/emit-tags.js";

const KeyPersonEntry = z.object({
  ref: z.string().optional(),
  called: z.string().optional(),
  role: z.string().optional(),
  notes: z.string().optional(),
});

/**
 * One opener: a single short line the person sees as a button and sends
 * verbatim. Validated rather than silently normalized — an opener is agent-
 * written text that compiles into CLAUDE.md and renders as a button, so a
 * paragraph or a blank entry is a card error the boxholder should see, not
 * something to quietly trim away.
 */
const OPENER_MAX_LENGTH = 120;
const OpenerEntry = z
  .string()
  .refine((s) => s.trim() !== "", "an opener must not be blank")
  .refine((s) => !s.includes("\n"), "an opener must be a single line")
  .refine(
    (s) => s.trim().length <= OPENER_MAX_LENGTH,
    `an opener must be at most ${OPENER_MAX_LENGTH} characters`,
  );

const PropertyEntry = z.object({
  name: z.string().optional(),
  address: z.string().optional(),
  "address-uncertain": z.boolean().optional(),
  notes: z.string().optional(),
});

export const BriefingSchema = cardSchema("briefing", {
  description: "Core situational context for the box or a directory — what every agent needs to know; one per directory",
  category: "authored",
  fields: {
    "key-people": z.array(KeyPersonEntry).optional(),
    properties: z.array(PropertyEntry).optional(),
    openers: z.array(OpenerEntry).optional(),
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
- \`openers:\` — a list of plain strings: the suggested opening
  questions shown on an empty chat for this directory. Each must be a
  single non-blank line of at most 120 characters — a longer or
  multi-line entry fails validation. See "Openers" below.

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
openers:
  - Let me tell you what this box is for.
  - What can you do?
\`\`\`

**Openers are yours to maintain.** Each string in \`openers:\` is a
suggestion the person sees on an empty chat bound to this directory —
clicking one sends it as their message. A new box ships with two stock
openers; they are a starting point, not a fixture.

- Rewrite them as the box's use becomes clear, toward things the
  person has **not** yet tried.
- Phrase them from the person's side, so you are never asked something
  you cannot answer yet.
- Keep them short — one line each, 120 characters at most.
- Remove them once the box is in regular use. **An empty set is the
  normal end state, not a regression** — an established box shows no
  openers at all.

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
 * `properties:`, `openers:`) as `**Label:** …` lines. Prepends a section header. The
 * `directoryLabel` parameter is used for directory briefings (e.g.,
 * `"_bookkeeping/archive/financial"`).
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
    // Openers ride the same `**Label:** …` shape: the agent owns them, so it
    // has to see its current suggestions on every turn to curate them.
    ...(fields.openers ?? []).filter((o) => o.trim() !== "").map(openerLine),
  ];
  if (records.length > 0) sections.push(records.join("\n\n"));

  if (sections.length === 0) return `${header}\n`;
  return `${header}\n\n${sections.join("\n\n")}\n`;
}

/**
 * Seed briefing template for a new box: the stub purpose plus the two stock
 * `openers:` a fresh box's empty chat offers. Both are phrased from the
 * person's side, so the agent is never asked something it cannot answer on
 * turn one. The agent rewrites and eventually removes
 * them as the box comes into regular use.
 *
 * Changing this constant requires `pnpm template-stock:update` — it is a
 * managed stock template (`MANAGED_STOCK_TEMPLATES`), so the superseded hash
 * must be recorded or boxes on the old seed silently park the update.
 */
export function createBriefingTemplate(): string {
  return `---
type: briefing
openers:
  - Let me tell you what this box is for.
  - What can you do?
---
{% purpose %}
What this box is for.
{% /purpose %}
`;
}
