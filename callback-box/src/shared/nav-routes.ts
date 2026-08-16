/**
 * The builtin route table for nav purposes — the single source for
 * `nav.card` href validation (schema) and href label defaults (nav
 * resolver). Shared by backend and frontend. There is no builtin fallback
 * nav any more: the app bar's switch menu carries these destinations itself
 * (docs/plans/top-nav-ia.md Track C3), so a box without a `nav.card` needs
 * no substitute list.
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

const byHref = new Map(NAV_ROUTES.map((r) => [r.href, r]));

/** Look up a builtin route by href, or undefined for unknown paths. */
export function navRouteFor(href: string): NavRoute | undefined {
  return byHref.get(href);
}
