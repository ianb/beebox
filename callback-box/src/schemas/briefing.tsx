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

export const BriefingSchema: CardSchema = cardSchema("briefing", {
  fields: {
    purpose: z.string().optional(),
    "key-people": z.array(PersonEntry).optional(),
    "project-phase": ProjectPhase.optional(),
    corrections: z.array(Correction).optional(),
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
