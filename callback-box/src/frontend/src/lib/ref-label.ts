/**
 * Shared helpers for turning a body-tag `ref`/`href` attribute into a short
 * display label and a navigable `ViewTarget`. Used by `{% source %}`
 * (`components/Source.tsx`) and `{% see-also %}` (`components/SeeAlso.tsx`)
 * — both carry the same ref-or-href-to-a-card shape and want the same
 * "basename, `_`/`-` → space, strip `.<type>.card`" label heuristic.
 */

import { resolveRelativePath, type ViewTarget } from "./view-url";

/**
 * Derive a short human label from a ref path:
 *   `/box/inbox/Voice_2026-03-15.memo.card`     → "Voice 2026-03-15"
 *   `box/people/dana.person.card`               → "dana"
 *   `box/chats/Mar15.chat-thread.card#m12`      → "Mar15"
 *
 * Strips leading `/`, drops directory prefix, drops the `.<type>.card`
 * suffix, strips a trailing `#fragment`, then replaces `_`/`-` with spaces.
 * If anything goes empty along the way, falls back to the original ref so
 * the chip is never blank.
 */
export function refLabel(ref: string): string {
  if (ref === "") return "(missing ref)";
  const noFrag = ref.split("#")[0] ?? ref;
  const noLead = noFrag.replace(/^\/+/, "");
  const basename = noLead.includes("/") ? noLead.slice(noLead.lastIndexOf("/") + 1) : noLead;
  const stripped = basename.replace(/\.[^.]+\.card$/, "");
  const humanised = stripped.replace(/[_-]+/g, " ").trim();
  return humanised === "" ? ref : humanised;
}

/** Short label from an external `href` — basename of the file:/URL path. */
export function externalLabel(href: string): string {
  const noFrag = href.split("#")[0] ?? href;
  const noQuery = noFrag.split("?")[0] ?? noFrag;
  const basename = noQuery.includes("/") ? noQuery.slice(noQuery.lastIndexOf("/") + 1) : noQuery;
  return basename === "" ? href : basename;
}

/**
 * Resolve a ref to a `ViewTarget` for navigation, against the host doc's
 * `basePath`. Uses the same rule as markdown links (`resolveRelativePath`):
 * leading `/` is box-root-absolute, `attach/` resolves into the host card's
 * attach scope, anything else is relative to the host doc's directory.
 * Fragments after `#` are dropped; the router doesn't take them today.
 *
 * `null` when the ref escapes the box root — the chip has nothing to open, and
 * callers render it as non-navigable rather than opening a clamped-to-root file.
 */
export function refToViewTarget(ref: string, basePath: string | undefined): ViewTarget | null {
  const noFrag = ref.split("#")[0] ?? ref;
  const path = resolveRelativePath(basePath, noFrag);
  return path === null ? null : { path, viewer: null, params: {} };
}
