/** @jsxImportSource cardworks/jsx */
/**
 * Person card schema — key people referenced from briefings.
 *
 * Person cards live at `people/First_Last.person.card`.
 * They capture identity, contact info, and relationship context.
 * Referenced from briefing cards via the `ref` attribute on `<person>`.
 */

import { element, serialize } from "cardworks";
import { z } from "zod";

// ============================================
// Person elements
// ============================================

export const PersonName = element("name", {
  text: z.string(),
});

export const PersonCalled = element("called", {
  text: z.string(),
});

export const PersonRole = element("role", {
  text: z.string(),
});

export const PersonContact = element("contact", {
  text: z.string(),
});

export const PersonNotes = element("notes", {
  text: z.string().optional(),
});

// ============================================
// Person schema
// ============================================

export const PersonSchema = element("person", {
  attrs: {
    status: z.enum(["active", "inactive", "archived"]).default("active"),
  },
  children: z.array(
    z.union([
      PersonName,
      PersonCalled,
      PersonRole,
      PersonContact,
      PersonNotes,
    ])
  ),
  instructions: `# Person Cards

Person cards track key people referenced in briefings and throughout the box.

They live at \`people/First_Last.person.card\`. The filename uses the person's name with underscores.

**Structure:**
- \`<name>\` — Full name. Required.
- \`<called>\` — Alias or nickname. Multiple allowed. Include if the boxholder uses this name (e.g., "Dad", "Mom").
- \`<role>\` — Relationship or function (e.g., "Ledger subject — boxholder's father", "Financial advisor").
- \`<contact>\` — Freeform contact info (phone, email, address).
- \`<notes>\` — Freeform context.
- \`status\` attr — \`active\` (default), \`inactive\`, or \`archived\`.

**When to create a person card:**
- When adding someone to a briefing's \`<key-people>\` — always create the person card if it doesn't exist
- When a person keeps coming up and you need a place to consolidate info about them

**Filename convention:** \`people/First_Last.person.card\` — use the person's actual name, not a slug or alias.`,
});

export type Person = z.infer<typeof PersonSchema>;

// ============================================
// Person template
// ============================================

/**
 * Create a person card template.
 */
export function createPersonTemplate(options: {
  name: string;
  called?: string | undefined;
  role?: string | undefined;
}): string {
  const card = (
    <person status="active">
      <name>{options.name}</name>
      {options.called && <called>{options.called}</called>}
      {options.role && <role>{options.role}</role>}
      <notes />
    </person>
  );

  return serialize(card) + "\n";
}
