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
 * The box a document request is for: the URL's first path segment, matched
 * against the boxes this server actually serves.
 *
 * Every layout that serves the SPA carries the slug there — a standalone
 * `cb serve` mounts each box at `/<slug>`, and a hub child sees the same
 * `/<slug>/...` the hub proxied to it (the hub strips no prefix; the dev
 * router strips only its own worktree segment, ahead of the box's).
 *
 * Matching against the served boxes rather than excluding known non-box
 * segments (`/auth/…`, Vite's `/@…`) keeps routing policy in one place: a
 * segment is a box exactly when a box answers to it. A box whose slug
 * collides with a reserved path is a routing bug to fix where slugs are
 * validated, not a case for this function to encode a second opinion about.
 */
export function documentBoxSlug(url: string, knownSlugs: readonly string[]): string | null {
  const pathOnly = url.split("?")[0] ?? "";
  const first = pathOnly.split("/").find((segment) => segment !== "");
  if (first === undefined) return null;
  return knownSlugs.includes(first) ? first : null;
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
 * The three icon-bearing tags are pointed at the box's own, box-scoped routes
 * (`routes/box-identity-assets.ts`), which render its mark on demand: the tab
 * icon, the Apple touch icon an installed app draws, and the manifest that
 * names the installed app. The manifest link gains
 * `crossorigin="use-credentials"`, because a manifest is otherwise fetched
 * with no cookies and every route under `/<slug>` is behind the box's auth
 * wall.
 */
export function stampBoxIdentity(html: string, identity: BoxIdentity): string {
  const titleRe = /<title>[^<]*<\/title>/;
  const iconRe = /<link rel="icon"[^>]*>/;

  // A rewrite that stops matching -- an attribute reordered, the tag
  // reformatted -- would silently go back to serving every box the same
  // document, which looks exactly like the bug this exists to fix. Say so
  // once rather than never.
  if (!titleRe.test(html)) warnOnce("title", "no <title> tag matched");
  if (!iconRe.test(html)) warnOnce("icon", "no <link rel=\"icon\"> matched");

  let out = html.replace(titleRe, `<title>${escapeHtml(identity.name)}</title>`);

  const base = `/${encodeURIComponent(identity.slug)}`;
  out = out.replace(iconRe, (link) => {
    // The built href is kept in `data-cb-default-icon`. Without it the client
    // has no way to tell the app's own icon from the mark of whichever box
    // happened to serve the document, and "this box has no mark" would show
    // the previous box's (`frontend/src/components/DocumentIcon.tsx`).
    const built = /href="([^"]*)"/.exec(link)?.[1] ?? "";
    const png =
      `<link rel="icon" type="image/png" href="${base}/icon-192.png"` +
      ` data-cb-default-icon="${escapeHtml(built)}" />`;
    if (identity.symbol === "") return png;
    // SVG first: a browser that understands it picks it and never fetches the
    // PNG; one that does not ignores the type it cannot render and takes the
    // PNG. Safari gained SVG-favicon support only in 26, so this is live.
    return `<link rel="icon" type="image/svg+xml" href="${emojiFaviconUri(identity.symbol)}" />` + png;
  });

  out = out.replace(
    /<link rel="apple-touch-icon"[^>]*>/,
    `<link rel="apple-touch-icon" href="${base}/icon-180.png" />`,
  );
  out = out.replace(
    /<link rel="manifest"[^>]*>/,
    `<link rel="manifest" href="${base}/manifest.webmanifest" crossorigin="use-credentials" />`,
  );

  return out;
}

/** Complained-about stamp targets, so a per-request failure logs once. */
const warned = new Set<string>();

function warnOnce(what: string, detail: string): void {
  if (warned.has(what)) return;
  warned.add(what);
  console.warn(`index.html: cannot stamp the box ${what} -- ${detail}. The document's markup changed; see webapp/index-html.ts.`);
}
