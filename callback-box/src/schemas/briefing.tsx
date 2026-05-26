/**
 * Briefing card schema — core situational context for a box.
 *
 * The structured fields (purpose, key-people, project-phase, corrections)
 * live in the YAML frontmatter. The body of the card is the freeform
 * "agent needs to know" section, which gets included verbatim in the
 * compiled markdown alongside the structured pieces.
 *
 * Root briefing: `briefing.briefing.card` at box root.
 * Directory briefings: `briefing.briefing.card` in any subdirectory.
 */

import { body, cardSchema, type CardSchema } from "cardworks";
import { z } from "zod";

const PersonEntry = z.object({
  name: z.string(),
  called: z.string().optional(),
  role: z.string().optional(),
  ref: z.string().optional(),
  description: z.string().optional(),
});

const ProjectPhase = z.object({
  date: z.string(),
  text: z.string(),
});

const Correction = z.object({
  instruction: z.string(),
  test: z.string().optional(),
});

const PropertyEntry = z.object({
  name: z.string().optional(),
  address: z.string().optional(),
  "address-uncertain": z.boolean().optional(),
  description: z.string().optional(),
});

export const BriefingSchema: CardSchema = cardSchema("briefing", {
  fields: {
    purpose: z.string().optional(),
    "key-people": z.array(PersonEntry).optional(),
    "project-phase": ProjectPhase.optional(),
    corrections: z.array(Correction).optional(),
    legal: z.string().optional(),
    properties: z.array(PropertyEntry).optional(),
    finances: z.string().optional(),
    body: body(z.string()),
  },
  instructions: `# Briefing Cards

A briefing card captures the core situational context for a box (or a
directory within a box). It's the primary place for information that
every agent needs to know.

There is one briefing per directory, at \`briefing.briefing.card\`. The
root briefing describes the whole box. Directory briefings explain
what that directory contains.

**Structure:**

Frontmatter:
- \`purpose:\` — What this box (or directory) is for. Required.
- \`key-people:\` — Array of people central to the box's purpose, with
  aliases so agents can map names. Each entry: \`name\` (required),
  optional \`called\` (alias), optional \`role\`, optional \`ref:\` (object
  pointing to person card), optional \`description\` (brief description).
- \`project-phase:\` — Optional \`{date, text}\` object. Leave out if
  there's no clear phase.
- \`corrections:\` — Array of \`{instruction, test?}\` entries. Only add
  in response to observed agent behavior that needs correcting.
- \`legal:\` — Optional prose about the box's legal context (ledger
  planning, contracts, IP). Include when legal facts shape decisions.
- \`properties:\` — Optional array of \`{name?, address?, address-uncertain?, description?}\`
  for physical properties tied to the box (ledger, household, business).
- \`finances:\` — Optional prose about the box's financial context
  (accounts, distribution plans, obligations).

Body (markdown): freeform catch-all for facts every agent must have
that don't fit the structured fields. This is the "agent needs to
know" section.

**When to edit a briefing:**
- You learn something that changes how any agent should understand
  this box
- A new key person is identified (create a person card too:
  \`people/First_Last.person.card\`)
- The project enters a new phase
- An agent repeatedly makes a mistake that a correction would prevent

**Do NOT put here:**
- Individual items (those are record/memo cards)
- Processing rules (those go in guide cards)
- Communication style preferences (those go in the personality card)`,
});

export interface BriefingFields {
  type: "briefing";
  purpose?: string;
  "key-people"?: Array<{
    name: string;
    called?: string;
    role?: string;
    ref?: string;
    description?: string;
  }>;
  "project-phase"?: { date: string; text: string };
  corrections?: Array<{ instruction: string; test?: string }>;
  legal?: string;
  properties?: Array<{
    name?: string;
    address?: string;
    "address-uncertain"?: boolean;
    description?: string;
  }>;
  finances?: string;
  body: string;
}

/**
 * Compile a briefing fields object into markdown.
 *
 * Skips empty sections. The body field (the freeform "agent needs to
 * know" section) is included verbatim. The `directoryLabel` parameter
 * is used for directory briefings (e.g., "store/archive/financial").
 */
export function compileBriefing(fields: BriefingFields, directoryLabel?: string): string {
  const lines: string[] = [];

  if (directoryLabel !== undefined && directoryLabel !== "") {
    lines.push(`## Briefing: ${directoryLabel}`);
  } else {
    lines.push("## Box Briefing");
  }
  lines.push("");

  if (fields.purpose !== undefined && fields.purpose !== "") {
    lines.push(`**Purpose:** ${fields.purpose}`);
    lines.push("");
  }

  const keyPeople = fields["key-people"] ?? [];
  if (keyPeople.length > 0) {
    lines.push("**Key People:**");
    for (const person of keyPeople) {
      const alias = person.called !== undefined ? ` ("${person.called}")` : "";
      const desc = person.description !== undefined ? ` — ${person.description}` : "";
      const ref = person.ref !== undefined ? ` [→ ${person.ref}]` : "";
      lines.push(`- **${person.name}**${alias}${desc}${ref}`);
    }
    lines.push("");
  }

  const body = fields.body.trim();
  if (body !== "") {
    lines.push("**Need to Know:**");
    lines.push(body);
    lines.push("");
  }

  const phase = fields["project-phase"];
  if (phase !== undefined) {
    lines.push(`**Current Phase** (${phase.date}):`);
    lines.push(phase.text.trim());
    lines.push("");
  }

  const corrections = fields.corrections ?? [];
  if (corrections.length > 0) {
    lines.push("**Corrections:**");
    for (const correction of corrections) {
      lines.push(`- ${correction.instruction.trim()}`);
    }
    lines.push("");
  }

  if (fields.legal !== undefined && fields.legal !== "") {
    lines.push("**Legal:**");
    lines.push(fields.legal.trim());
    lines.push("");
  }

  const properties = fields.properties ?? [];
  if (properties.length > 0) {
    lines.push("**Properties:**");
    for (const p of properties) {
      const heading = p.name ?? p.address ?? "(unnamed)";
      const addr = p.address !== undefined && p.address !== p.name
        ? ` — ${p.address}${p["address-uncertain"] ? " (uncertain)" : ""}`
        : "";
      lines.push(`- **${heading}**${addr}`);
      if (p.description !== undefined && p.description !== "") {
        lines.push(`  ${p.description.trim()}`);
      }
    }
    lines.push("");
  }

  if (fields.finances !== undefined && fields.finances !== "") {
    lines.push("**Finances:**");
    lines.push(fields.finances.trim());
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Seed briefing template for a new box.
 */
export function createBriefingTemplate(): string {
  return `---
type: briefing
purpose: ""
key-people: []
---
`;
}
