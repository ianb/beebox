/**
 * Person card schema — key people referenced from briefings.
 *
 * Person cards live at `people/First_Last.person.card`. Identity, contact
 * info, and aliases live in the frontmatter; the markdown body is freeform
 * "notes" context.
 *
 * Referenced from briefing cards via the `key-people[].ref` field.
 */

import { body, cardSchema, type CardSchema } from "cardworks";
import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";

export const PersonStatus = z.enum(["active", "inactive", "archived"]);
export type PersonStatusType = z.infer<typeof PersonStatus>;

export const PersonSchema: CardSchema = cardSchema("person", {
  fields: {
    status: PersonStatus.default("active"),
    name: z.string(),
    called: z.array(z.string()).optional(),
    role: z.string().optional(),
    contact: z.string().optional(),
    body: body(z.string()),
  },
  instructions: `# Person Cards

Person cards track key people referenced in briefings and throughout
the box.

They live at \`people/First_Last.person.card\`. The filename uses the
person's name with underscores.

**Frontmatter:**
- \`name:\` — Full name. Required.
- \`called:\` — Array of aliases / nicknames. Include if the boxholder
  uses these names (e.g., ["Dad", "Papa"]).
- \`role:\` — Relationship or function (e.g., "Ledger subject —
  boxholder's father", "Financial advisor").
- \`contact:\` — Freeform contact info (phone, email, address).
- \`status:\` — \`active\` (default), \`inactive\`, or \`archived\`.

**Body (markdown):** freeform notes / context about the person.

**When to create a person card:**
- When adding someone to a briefing's \`key-people:\` — always create
  the person card if it doesn't exist.
- When a person keeps coming up and you need a place to consolidate
  info about them.

**Filename convention:** \`people/First_Last.person.card\` — use the
person's actual name, not a slug or alias.`,
});

export interface PersonFields {
  type: "person";
  status: PersonStatusType;
  name: string;
  called?: string[];
  role?: string;
  contact?: string;
  body: string;
}

export function createPersonTemplate(options: {
  name: string;
  called?: string;
  role?: string;
}): string {
  const fields: Record<string, unknown> = {
    status: "active",
    name: options.name,
  };
  if (options.called !== undefined && options.called !== "") {
    fields["called"] = [options.called];
  }
  if (options.role !== undefined && options.role !== "") {
    fields["role"] = options.role;
  }
  return `---\n${stringifyYaml(fields)}---\n`;
}
