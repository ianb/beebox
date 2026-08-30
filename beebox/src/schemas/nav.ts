/**
 * Nav card schema — the box-editable top navigation.
 *
 * A positional card (`nav.card`) at the box root. Its `entries` list adds a
 * section to the app bar's switch menu (docs/plans/top-nav-ia.md Track C3);
 * when the card is absent or invalid, the menu simply shows its builtin rows
 * (and an invalid card is surfaced as a health warning — see
 * runHealthChecks). First slice of docs/plans/interface-as-cards.md; plan in
 * docs/implemented-plans/nav-card.md.
 *
 *   ---
 *   entries:
 *     - { href: /questions }
 *     - { href: /chat, label: Recent }
 *     - { ref: /store/projects/Big_Refactor.project.card, label: The Refactor }
 *   ---
 *
 * `href` entries point at builtin routes and are validated against the
 * route table (src/shared/nav-routes.ts). `ref` entries are card refs
 * written as box paths (leading `/`; a bare path is accepted and means the
 * same thing, since `nav.card` sits at the box root), tracked like any ref
 * by `bbx validate` / `bbx mv`.
 */

import { z } from "zod";
import { cardSchema, splitCardContent, type CardSchema } from "../cards/index.js";
import { parse as parseYaml } from "yaml";
import { NAV_ROUTES } from "../shared/nav-routes.js";
import { errorMessage } from "../lib/error-guards.js";

const validHrefs = new Set(NAV_ROUTES.map((r) => r.href));
const hrefList = NAV_ROUTES.map((r) => r.href).join(", ");

/** A builtin route path; unknown paths fail validation with the valid set enumerated. */
const NavHref = z.string().refine((h) => validHrefs.has(h), {
  message: `href must be one of: ${hrefList}`,
});

/**
 * One nav entry: either a builtin route (`href`) or a card ref (`ref`, a box
 * path with a leading `/`; bare is accepted for back-compat). `label`
 * overrides the default (the route's builtin label, or the target card's
 * title).
 */
const NavEntry = z.union([
  z.object({ href: NavHref, label: z.string().optional() }).strict(),
  z.object({ ref: z.string(), label: z.string().optional() }).strict(),
]);
export type NavEntryData = z.infer<typeof NavEntry>;

const navFields = {
  entries: z.array(NavEntry).min(1),
};

/**
 * Standalone object schema for lightweight readers (the nav resolver,
 * health check) that parse `nav.card` directly rather than through the
 * card loader. Unknown top-level keys (global card fields) are stripped.
 */
const NavObject = z.object(navFields);
export type NavFields = z.infer<typeof NavObject>;

export const NavSchema: CardSchema = cardSchema("nav", {
  fields: navFields,
  searchable: false,
  instructions: `# Nav Card

\`nav.card\` at the box root adds the box's own entries to the app bar's place menu (the one that opens from the box ▸ landmark pill). Editing it reshapes that section immediately — no deploy. When the card is absent or invalid, the menu shows only its builtin rows, and an invalid card also raises a health warning naming the problem. Deleting the card is always a safe way back to stock navigation.

Entries pointing at a destination the menu already reaches (\`/\`, \`/chat\`, \`/chats\`, \`/landmarks\`, \`/browse\`, \`/history\`, \`/dashboard\`) are skipped rather than shown twice — pin cards and the less-travelled routes.

\`\`\`yaml
entries:
  - { href: /questions }       # builtin routes, validated against the route set:
  - { href: /capture, label: Quick capture }   # ${hrefList}
  - { ref: /store/projects/Big_Refactor.project.card, label: The Refactor }
\`\`\`

- **\`href\`** — a builtin route. \`label\` defaults to the route's standard name.
- **\`ref\`** — any card, by box path (leading \`/\`, from the box root); it opens in Browse. \`label\` defaults to the target's title. Use this to pin a card (a project, a list, a note) into the menu.

Keep the list short — this is a menu section, not a directory. Order is display order.`,
});

/**
 * Parse a nav card's raw text into typed frontmatter. Unlike the landmark
 * reader this returns the validation error text on failure — an invalid
 * nav card is surfaced (health warning; the menu keeps its builtin rows),
 * not silently skipped.
 */
export function parseNavFields(
  content: string,
): { fields: NavFields; error: null } | { fields: null; error: string } {
  const split = splitCardContent(content);
  if (!split.hasFrontmatter) {
    return { fields: null, error: "nav.card has no frontmatter block" };
  }
  let fm: unknown;
  try {
    fm = parseYaml(split.frontmatterText);
  } catch (e) {
    return { fields: null, error: `invalid YAML frontmatter: ${errorMessage(e)}` };
  }
  const parsed = NavObject.safeParse(fm ?? {});
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => (i.path.length > 0 ? `${i.path.join(".")}: ${i.message}` : i.message))
      .join("; ");
    return { fields: null, error: detail };
  }
  return { fields: parsed.data, error: null };
}
