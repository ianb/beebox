/**
 * Stamping a box's identity into the served `index.html`.
 *
 * The SPA can title its own tab and set its own icon, but only once React has
 * booted and the box list has come back — until then every tab of every box
 * shows the built document's generic `Callback Box` and the shared app icon.
 * That window is exactly when a person is scanning a tab strip for the box
 * they just opened, and on a slow load it is the whole experience.
 *
 * So the document says it first. The box server already reads `index.html`
 * per request (`server-root.ts`'s SPA fallback), so this is a string rewrite
 * on a read it was doing anyway, not a build step or a per-box artifact.
 *
 * **Text symbols only.** An emoji becomes a self-contained `data:` URI with no
 * URL to get wrong. An image symbol (`symbol: { src }`) is a box-relative path
 * that would have to be turned into an absolute URL here — but the built SPA
 * deliberately references its assets at the root (`/assets/`, `/icons/`) and
 * derives the box slug at runtime from the URL, so this file is the one place
 * with no reliable way to spell a box-scoped path. The client swaps in an
 * image symbol after boot, where the box base is known.
 */

import type { BoxIdentity } from "../core/landmark/box-identity.js";
import { emojiFaviconUri } from "../shared/favicon.js";

/** Escape text for an HTML text node or a double-quoted attribute value. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The box a document request is for: the URL's first path segment.
 *
 * Every layout that serves the SPA carries the slug there — a standalone
 * `cb serve` mounts each box at `/<slug>`, and a hub child sees the same
 * `/<slug>/...` the hub proxied to it (the hub strips no prefix; the dev
 * router strips only its own worktree segment, ahead of the box's). Returns
 * null for a URL that names no box, which is the root listing and `/auth/*`.
 */
export function documentBoxSlug(url: string): string | null {
  const pathOnly = url.split("?")[0] ?? "";
  const first = pathOnly.split("/").find((segment) => segment !== "");
  if (first === undefined || first === "auth" || first.startsWith("@")) return null;
  return first;
}

/**
 * Rewrite the document's `<title>` and icon link to name `identity`'s box.
 *
 * The title is the box name alone: the document is served before the router
 * has resolved a route, so the page half genuinely isn't known yet — which is
 * the same "no page, just the box" case the client composer already handles
 * (`frontend/src/lib/document-title.ts`). The client refines it to
 * `<page> — <box>` on boot.
 *
 * Returns the html unchanged when there is nothing to say (no name and no text
 * symbol), and leaves the built icon link in place for an image symbol.
 */
export function stampBoxIdentity(html: string, identity: BoxIdentity): string {
  let out = html.replace(
    /<title>[^<]*<\/title>/,
    `<title>${escapeHtml(identity.name)}</title>`,
  );

  if (identity.symbol !== "") {
    out = out.replace(
      /<link rel="icon"[^>]*>/,
      `<link rel="icon" href="${emojiFaviconUri(identity.symbol)}" />`,
    );
  }

  return out;
}
