/**
 * The builtin route table for nav purposes — the single source for
 * `nav.card` href validation (schema), href label defaults (nav resolver),
 * and the builtin fallback nav (AppNav). Shared by backend and frontend.
 *
 * As interface surfaces convert to cards (docs/plans/interface-as-cards.md),
 * nav entries migrate from `href:` to `ref:`; this table only ever names
 * routes the shell itself owns.
 */
export interface NavRoute {
  /** Box-relative route path, e.g. "/questions". */
  href: string;
  /** Default label when a nav entry doesn't override it. */
  label: string;
}

export const NAV_ROUTES: readonly NavRoute[] = [
  // "/" redirects to /chat (the box lands on the conversation); the entry
  // stays because nav.card href validation derives from this table —
  // removing it would invalidate existing cards.
  { href: "/", label: "Chat" },
  { href: "/chat", label: "Chat" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/chats", label: "Chats" },
  { href: "/questions", label: "Questions" },
  { href: "/browse", label: "Browse" },
  { href: "/landmarks", label: "Landmarks" },
  { href: "/history", label: "History" },
  { href: "/capture", label: "Capture" },
  { href: "/settings", label: "Settings" },
  { href: "/admin", label: "Admin" },
];

/**
 * The builtin fallback nav — what AppNav shows when there is no (or an
 * invalid) `nav.card`. Mirrors the pre-nav-card hardcoded nav; deliberately
 * omits Settings/Admin, which are reachable but not front-line.
 */
export const DEFAULT_NAV_HREFS: readonly string[] = [
  "/",
  "/chat",
  "/chats",
  "/questions",
  "/browse",
  "/landmarks",
  "/history",
  "/capture",
];

const byHref = new Map(NAV_ROUTES.map((r) => [r.href, r]));

/** Look up a builtin route by href, or undefined for unknown paths. */
export function navRouteFor(href: string): NavRoute | undefined {
  return byHref.get(href);
}
