/**
 * Nav card schema — the box-editable top navigation.
 *
 * A positional card (`nav.card`) at the box root. Its `entries` list drives
 * AppNav; when the card is absent or invalid, the shell falls back to the
 * builtin nav (and an invalid card is surfaced as a health warning — see
 * runHealthChecks). First slice of docs/plans/interface-as-cards.md; plan in
 * docs/plans/nav-card.md.
 *
 *   ---
 *   entries:
 *     - { href: /questions }
 *     - { href: /chat, label: Recent }
 *     - { ref: store/projects/Big_Refactor.project.card, label: The Refactor }
 *   ---
 *
 * `href` entries point at builtin routes and are validated against the
 * route table (src/shared/nav-routes.ts). `ref` entries are card refs
 * (box-root-relative), tracked like any ref by `cb validate` / `cb mv`.
 */

import { z } from "zod";
import { cardSchema, splitCardContent, type CardSchema } from "../cards/index.js";
import { parse as parseYaml } from "yaml";
import { NAV_ROUTES } from "../shared/nav-routes.js";

const validHrefs = new Set(NAV_ROUTES.map((r) => r.href));
const hrefList = NAV_ROUTES.map((r) => r.href).join(", ");

/** A builtin route path; unknown paths fail validation with the valid set enumerated. */
export const NavHref = z.string().refine((h) => validHrefs.has(h), {
  message: `href must be one of: ${hrefList}`,
});

/**
 * One nav entry: either a builtin route (`href`) or a card ref (`ref`,
 * box-root-relative). `label` overrides the default (the route's builtin
 * label, or the target card's title).
 */
export const NavEntry = z.union([
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

\`nav.card\` at the box root defines the top navigation bar. Editing it reshapes the nav immediately — no deploy. When the card is absent, the builtin nav is shown; when it is invalid, the builtin nav is shown and a health warning names the problem. Deleting the card is always a safe way back to stock navigation.

\`\`\`yaml
entries:
  - { href: / }                # builtin routes, validated against the route set:
  - { href: /chat, label: Recent }   # ${hrefList}
  - { href: /questions }
  - { ref: store/projects/Big_Refactor.project.card, label: The Refactor }
\`\`\`

- **\`href\`** — a builtin route. \`label\` defaults to the route's standard name.
- **\`ref\`** — any card, by box-root-relative path; it opens in Browse. \`label\` defaults to the target's title. Use this to pin a card (a project, a list, a note) into the nav.

Keep the list short — this is a navigation bar, not a directory. Order is display order.`,
});

/**
 * Parse a nav card's raw text into typed frontmatter. Unlike the landmark
 * reader this returns the validation error text on failure — an invalid
 * nav card is surfaced (health warning, builtin fallback), not silently
 * skipped.
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
    return { fields: null, error: `invalid YAML frontmatter: ${(e as Error).message}` };
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
