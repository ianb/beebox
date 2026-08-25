/**
 * Person card schema — key people referenced from briefings.
 *
 * Person cards live at `people/First_Last.person.card`. Identity, contact
 * info, and aliases live in the frontmatter; the markdown body is freeform
 * "notes" context.
 *
 * Referenced from briefing cards via the `key-people[].ref` field.
 */

import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import { body, cardSchema, type InferCardFields } from "../cards/index.js";
import { namedEntityFields } from "./named-entity-fields.js";

const PersonStatus = z.enum(["active", "inactive", "archived"]);
export type PersonStatusType = z.infer<typeof PersonStatus>;

export const PersonSchema = cardSchema("person", {
  description: "A key person — identity, aliases, role, contact info, and freeform notes; referenced from briefings' key-people",
  category: "authored",
  fields: {
    status: PersonStatus.default("active"),
    ...namedEntityFields,
    role: z.string().optional(),
    boxholder: z.boolean().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
    address: z.string().optional(),
    body: body(z.string()),
  },
  instructions: `# Person Cards

Person cards track key people referenced in briefings and throughout
the box.

They live at \`people/First_Last.person.card\` — the person's actual
name in the \`First_Last\` form ABOUT_CARDS describes, not a slug or alias.

**Frontmatter:**
- \`name:\` — Full name. Required.
- \`aliases:\` — Array of aliases / nicknames. Include if the boxholder
  uses these names (e.g., ["Dad", "Papa"]).
- \`role:\` — Relationship or function (e.g., "Ledger subject —
  boxholder's father", "Financial advisor").
- \`boxholder:\` — set \`true\` when this person is a boxholder: one of the
  principals the box serves and acts on behalf of. A box can have several
  (a family, an ledger run by siblings); omit the field for everyone else
  (people merely referenced, connector correspondents).
- \`email:\`, \`phone:\`, \`address:\` — contact details, each optional.
  One value apiece; put a second email, a fax, or any other channel in
  the body notes.
- \`status:\` — \`active\` (default), \`inactive\`, or \`archived\`.

**Body (markdown):** freeform notes / context about the person — and the
home for contact details that don't fit the three fields above.

**When to create a person card:**
- When adding someone to a briefing's \`key-people:\` — always create
  the person card if it doesn't exist.
- When a person keeps coming up and you need a place to consolidate
  info about them.`,
});

export type PersonFields = InferCardFields<typeof PersonSchema>;

export function createPersonTemplate(options: {
  name: string;
  aliases?: string;
  role?: string;
}): string {
  const fields: Record<string, unknown> = {
    status: "active",
    name: options.name,
  };
  if (options.aliases !== undefined && options.aliases !== "") {
    fields["aliases"] = [options.aliases];
  }
  if (options.role !== undefined && options.role !== "") {
    fields["role"] = options.role;
  }
  return `---\n${stringifyYaml(fields)}---\n`;
}
