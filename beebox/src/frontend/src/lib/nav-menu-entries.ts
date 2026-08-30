/**
 * Which `nav.card` entries the switch menu renders (docs/plans/top-nav-ia.md
 * Track C3).
 *
 * The nav card used to drive a whole link row (`useNavLinks`, retired here).
 * With the link row gone, the card's entries land as a section inside the
 * `PlacePill`'s switch menu — but that menu already has builtin rows for most
 * of what a card usually names, so an entry that duplicates a builtin is
 * dropped rather than rendered twice.
 *
 * The policy is a pure function so it can be doctested without a router:
 *  - every `ref:` entry renders (a box card has no builtin home);
 *  - an `href:` entry renders unless its route is already a menu row —
 *    `/` and `/chat` are the pill's own landing, `/chats` and `/landmarks`
 *    are "All landmarks", and `/browse`/`/history`/`/dashboard` are the Box
 *    submenu. Everything else (`/settings`, `/admin`, `/questions`,
 *    `/capture`, and any route added later) still renders.
 */

import { navRouteFor } from "@shared/nav-routes";

/** A resolved nav entry, structurally what `trpc.nav.get` returns. */
export interface NavMenuInput {
  kind: "href" | "ref";
  /** href: the box-relative route path. ref: the box-relative card path. */
  target: string;
  label: string;
}

/** A menu row: where it goes and what it says. */
export interface NavMenuEntry {
  /** Box-slug-prefixed path, ready for a router `Link`. */
  to: string;
  label: string;
}

/**
 * Routes the switch menu already reaches by a builtin row. Card entries
 * naming one of these are dropped — the menu shows each destination once.
 */
const BUILTIN_HREFS: ReadonlySet<string> = new Set([
  "/",
  "/chat",
  "/chats",
  "/landmarks",
  "/browse",
  "/history",
  "/dashboard",
]);

/**
 * Project resolved nav entries onto the switch menu's custom section.
 * `base` is the box prefix (`/test1`). An empty result means no section (and
 * no divider) renders at all.
 */
export function navMenuEntries({
  entries,
  base,
}: {
  entries: readonly NavMenuInput[];
  base: string;
}): NavMenuEntry[] {
  const rows: NavMenuEntry[] = [];
  for (const entry of entries) {
    if (entry.kind === "ref") {
      rows.push({ to: `${base}/browse/${entry.target}`, label: labelFor(entry) });
      continue;
    }
    if (BUILTIN_HREFS.has(entry.target)) continue;
    rows.push({ to: `${base}${entry.target}`, label: labelFor(entry) });
  }
  return rows;
}

/**
 * The card's own label wins; an unlabelled builtin route falls back to the
 * route table's name, and anything else names itself.
 */
function labelFor(entry: NavMenuInput): string {
  if (entry.label !== "") return entry.label;
  if (entry.kind === "href") return navRouteFor(entry.target)?.label ?? entry.target;
  return entry.target;
}
