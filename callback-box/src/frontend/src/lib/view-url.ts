/**
 * Parsing and serialization for view URLs.
 *
 * View URLs are file-path-based:
 *   view:store/notes/foo.md?view=markdown&zoom
 *
 * The path is always a file path relative to the box root.
 */

// Relative (not the `@shared` alias) so this lib resolves under the doctest
// runner's Node resolution too — view-url is unit-doctested outside the bundler.
import { boxRelativePath } from "../../../shared/box-path.js";
import { resolveRefPath } from "../../../shared/ref-path.js";

export interface ViewTarget {
  /** File path relative to box root */
  path: string;
  /** Explicit ?view= override (viewer name) */
  viewer: string | null;
  /** Remaining query params (excluding the reserved `view` key) */
  params: Record<string, string>;
}

/**
 * Optional context a navigation source can pass alongside a ViewTarget. The
 * target itself is serializable (URL-bound); the hint carries out-of-band
 * context like a human-friendly label for the originating link text, which
 * consumers can use for tab titles, breadcrumbs, etc.
 */
export interface NavigateHint {
  /** Human-friendly label (e.g. the clicked link's text). */
  label?: string;
}

/**
 * Parse a view URL value (the part after "view:") into a structured ViewTarget.
 */
export function parseViewUrl(raw: string): ViewTarget {
  // Strip "view:" prefix if present
  const value = raw.startsWith("view:") ? raw.slice(5) : raw;

  const qIndex = value.indexOf("?");
  const rawPath = qIndex !== -1 ? value.slice(0, qIndex) : value;
  // ViewTarget.path is, by contract, the canonical box-root-relative form, and
  // consumers compare it for exact equality against `file-change` events. Card
  // refs are conventionally written with a leading slash (`view:/store/Foo.card`),
  // so normalize at this parse boundary. Without it a leading-slash path loads on
  // mount (card.get tolerates it) but never matches a `file-change` event, so the
  // companion pane silently stops live-updating. See src/shared/box-path.ts.
  const path = boxRelativePath(rawPath);
  const { viewer, params } = parseViewQuery(qIndex === -1 ? "" : value.slice(qIndex + 1));
  return { path, viewer, params };
}

/**
 * Parse the query-string portion of a content/view URL into the reserved `view`
 * key (the viewer override) and the remaining passthrough params. Shared by
 * `parseViewUrl` (box-root-normalized) and `resolveContentTarget`
 * (document-relative), which differ only in how they treat the path part.
 */
function parseViewQuery(query: string): { viewer: string | null; params: Record<string, string> } {
  const params: Record<string, string> = {};
  let viewer: string | null = null;
  if (query !== "") {
    const search = new URLSearchParams(query);
    for (const [key, val] of search.entries()) {
      if (key === "view") {
        viewer = val;
      } else {
        params[key] = val;
      }
    }
  }
  return { viewer, params };
}

/** True for an absolute URL (any scheme) or a protocol-relative `//host` URL. */
export function isExternalUrl(src: string): boolean {
  return /^[a-z][\w+.-]*:/i.test(src) || src.startsWith("//");
}

/**
 * Turn a markdown link/image href — a box path that may be leading-slash
 * absolute or document-relative, and may carry `?view=`/params — into a
 * ViewTarget, resolving the path part against `basePath`. The query is split off
 * BEFORE resolution so a leading slash stays meaningful (absolute vs relative);
 * routing the whole href through `parseViewUrl` would strip it (`boxRelativePath`)
 * and mis-resolve absolute paths as document-relative.
 *
 * `null` when the path escapes the box root — there is no target to navigate to
 * or embed; see `resolveRelativePath`.
 */
export function resolveContentTarget(basePath: string | undefined, href: string): ViewTarget | null {
  const qIndex = href.indexOf("?");
  const pathPart = qIndex === -1 ? href : href.slice(0, qIndex);
  const path = resolveRelativePath(basePath, pathPart);
  if (path === null) return null;
  const { viewer, params } = parseViewQuery(qIndex === -1 ? "" : href.slice(qIndex + 1));
  return { path, viewer, params };
}

/**
 * Serialize a ViewTarget back into a view URL string (without the "view:" prefix).
 */
export function serializeViewUrl(target: ViewTarget): string {
  const parts: string[] = [];
  if (target.viewer) parts.push(`view=${encodeURIComponent(target.viewer)}`);
  for (const [k, v] of Object.entries(target.params)) {
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  }
  const qs = parts.join("&");
  return qs ? `${target.path}?${qs}` : target.path;
}

/**
 * Resolve a relative path against a base document's path (like a filesystem
 * would). `basePath` is the path of the containing document — the filename on
 * the end is stripped and `relative` is resolved against the remaining dir.
 * Empty/undefined `basePath` treats `relative` as already box-root-relative.
 *
 * Special case: if `relative` starts with `attach/`, the prefix is resolved
 * against the base card's attach scope (`<basename>.attach/`) instead of the
 * base's directory.
 *
 * Thin wrapper over the shared ref algebra (`src/shared/ref-path.ts`) — the one
 * home for these rules, backend and frontend alike. Returns `null` when the
 * path climbs out of the box root: fail-closed, never clamped to the root as
 * this function did until 2026-07-30 (clamping silently rendered a *different*
 * file than the ref named). Callers must degrade visibly — a link that doesn't
 * navigate, an image that shows broken — never substitute a guess.
 */
export function resolveRelativePath(basePath: string | undefined, relative: string): string | null {
  // `kind: "card"` unconditionally: this resolver serves card views and plain
  // `.md` documents alike, and the `attach/` prefix has always been honored for
  // both here (`cardBasename` leaves a non-`.card` filename intact, so
  // `notes.md` + `attach/x` → `notes.md.attach/x` exactly as before).
  return resolveRefPath({ fromPath: basePath, ref: relative, kind: "card" });
}

/**
 * Classify a markdown link href. A box file/card is referenced by a plain
 * relative or box-root-absolute path (`store/x.card`, `/store/x.card`); callers
 * `preventDefault` and hand a `relative` result to `onNavigate`. Anything with a
 * URL scheme, an anchor, or empty is `external` (a normal link).
 *
 * `legacy-view` is the retired `view:` scheme. It no longer routes anywhere; it
 * exists only so renderers can draw a visibly-broken "needs migration" marker
 * instead of a silently-inert `<a href="view:…">`. Removable once all controlled
 * boxes are migrated off `view:`.
 */
export function classifyMarkdownHref(
  href: string,
):
  | { kind: "legacy-view"; raw: string }
  | { kind: "relative"; path: string }
  | { kind: "external" } {
  if (href.startsWith("view:")) return { kind: "legacy-view", raw: href };
  // Protocol-relative (`//host/x`) and any URL scheme (http:, mailto:, tel:,
  // data:, …) are external, not in-box paths.
  if (href.startsWith("//")) return { kind: "external" };
  if (/^[a-z][\w+.-]*:/i.test(href)) return { kind: "external" };
  // Anchors and empty hrefs are not navigations.
  if (href.startsWith("#") || href === "") return { kind: "external" };
  return { kind: "relative", path: href };
}

/**
 * Rewrite a markdown image `src` into a stable URL that doesn't depend on the
 * page URL. Inputs we accept:
 *
 *  - `http(s)://...`, `data:`, protocol-relative `//...` — pass through
 *  - `api/files/<path>` or `/api/files/<path>` — back-compat form, treat the
 *    rest as box-root-relative
 *  - `/store/foo.png` — leading `/` means box-root-relative
 *  - `images/foo.png`, `../sibling/foo.png` — document-relative, resolved
 *    against `basePath`
 *
 * Output is always `<base>/<boxSlug>/api/image/<resolved>` for in-box paths,
 * where `<base>` is the Vite base URL (e.g. `/main` under the dev router, ``
 * in prod). This makes the rendered `<img>` work whether the markdown is
 * shown in chat, browse, or any deeper URL. The `/api/image/` route (not
 * `/api/files/`) is the canonical image URL: it serves a raw image file
 * directly AND dereferences an `.image.card` to its attached binary (via
 * `filename.ref`), so `![](…/foo.image.card)` renders instead of 404ing on the
 * card file (`/api/files/` refuses to serve `.card` files).
 */
export function resolveImageSrc(
  src: string,
  { boxSlug, basePath }: { boxSlug: string | undefined; basePath: string | undefined },
): string {
  if (src === "") return src;
  if (/^[a-z][\w+.-]*:/i.test(src)) return src;
  if (src.startsWith("//")) return src;

  // Accept the legacy `/api/files/<path>` and `/api/image/<path>` forms as a
  // hint that the rest is already box-root-relative; both re-emit through the
  // canonical image route.
  const apiPrefix = ["/api/files/", "api/files/", "/api/image/", "api/image/"].find((p) =>
    src.startsWith(p),
  );
  const path = apiPrefix
    ? boxRelativePath(src.slice(apiPrefix.length))
    : resolveRelativePath(basePath, src);
  // Fail-closed (see `resolveRelativePath`): a src that climbs out of the box
  // names no servable file. An empty src renders as the browser's broken-image
  // affordance plus the alt text — visibly wrong, which is the point; the old
  // clamp-to-root quietly displayed some other image instead.
  if (path === null) return "";
  return apiImageUrl(boxSlug ?? "", path);
}

/**
 * If `src` is an external image URL (http(s) or protocol-relative), return the
 * box's `/api/proxy-image` URL that re-fetches it server-side; otherwise
 * undefined. Used as an on-error fallback for markdown images: the browser
 * hot-links the origin first, and only routes through the proxy (which sends a
 * matching Referer and no box cookie, defeating naive hot-link blockers) if the
 * direct load fails. Mirrors the frozen-page fallback in `proxy-image.ts`.
 *
 * Box-relative paths return undefined — they're served directly and the proxy
 * (which requires an absolute http(s) target) would only reject them.
 */
export function externalImageProxyUrl(src: string, boxSlug: string | undefined): string | undefined {
  // Protocol-relative `//host/x.png` resolves against the page protocol in the
  // browser; the proxy needs an absolute scheme, so assume https.
  const absolute = src.startsWith("//") ? `https:${src}` : src;
  if (!/^https?:\/\//i.test(absolute)) return undefined;
  const base = viteBase().replace(/\/$/, "");
  return `${base}/${boxSlug ?? ""}/api/proxy-image?url=${encodeURIComponent(absolute)}`;
}

/**
 * Build a URL for an in-box file served by the backend's `/api/files/<path>`
 * route, prefixed with Vite's BASE_URL so it works under the dev router's
 * `/<worktree>/` path prefix and in prod (where BASE_URL is `/`).
 *
 * Use this any time you have a box-relative file path (e.g. a landmark
 * symbol, an attached image) and need to render it as an `<img src>` or hand
 * it to the browser as a fetchable URL. Building the path by hand (e.g.
 * `/${boxSlug}/api/files/${path}`) skips the base prefix and 404s the router.
 */
export function apiFileUrl(boxSlug: string, path: string): string {
  const base = viteBase().replace(/\/$/, "");
  return `${base}/${boxSlug}/api/files/${path}`;
}

/**
 * Build a URL for an in-box image served by the backend's `/api/image/<path>`
 * route — the canonical image URL. Unlike `apiFileUrl`, this route resolves an
 * `.image.card` to its attached binary (and serves a raw image file directly),
 * so it works whether the image is stored raw or wrapped in a card. Prefer this
 * for anything rendered as an `<img src>`; use `apiFileUrl` for non-image files.
 */
export function apiImageUrl(boxSlug: string, path: string): string {
  const base = viteBase().replace(/\/$/, "");
  return `${base}/${boxSlug}/api/image/${path}`;
}

// Read Vite's base URL. Wrapped so the bare `import.meta.env` access doesn't
// crash in plain-Node test runners where `import.meta.env` is undefined.
function viteBase(): string {
  try {
    // import.meta.env is Vite-typed (vite/client); the try/catch guards the
    // plain-Node case where the whole `env` object is undefined at runtime.
    return import.meta.env.BASE_URL;
  } catch (_e) {
    // import.meta.env is undefined in plain-Node test runners (see above).
    return "/";
  }
}
