/**
 * Parsing and serialization for view URLs.
 *
 * View URLs are file-path-based:
 *   view:store/notes/foo.md?view=markdown&zoom
 *
 * The path is always a file path relative to the box root.
 */

export interface ViewTarget {
  /** File path relative to box root */
  path: string;
  /** Explicit ?view= override (viewer name) */
  viewer: string | null;
  /** Remaining query params (excluding view and zoom) */
  params: Record<string, string>;
  zoom: boolean;
}

/**
 * Parse a view URL value (the part after "view:") into a structured ViewTarget.
 */
export function parseViewUrl(raw: string): ViewTarget {
  // Strip "view:" prefix if present
  const value = raw.startsWith("view:") ? raw.slice(5) : raw;

  const qIndex = value.indexOf("?");
  const path = qIndex !== -1 ? value.slice(0, qIndex) : value;

  const params: Record<string, string> = {};
  let viewer: string | null = null;
  let zoom = false;

  if (qIndex !== -1) {
    const search = new URLSearchParams(value.slice(qIndex + 1));
    for (const [key, val] of search.entries()) {
      if (key === "view") {
        viewer = val;
      } else if (key === "zoom") {
        zoom = true;
      } else {
        params[key] = val;
      }
    }
  }

  return { path, viewer, params, zoom };
}

/**
 * Serialize a ViewTarget back into a view URL string (without the "view:" prefix).
 */
export function serializeViewUrl(target: ViewTarget): string {
  const parts: string[] = [];
  if (target.viewer) parts.push(`view=${encodeURIComponent(target.viewer)}`);
  if (target.zoom) parts.push("zoom");
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
 */
export function resolveRelativePath(basePath: string | undefined, relative: string): string {
  if (relative.startsWith("/")) return relative.replace(/^\/+/, "");
  const baseDir =
    basePath && basePath.includes("/") ? basePath.slice(0, basePath.lastIndexOf("/")) : "";
  const parts = [...baseDir.split("/"), ...relative.split("/")];
  const out: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join("/");
}

/**
 * Classify an href as one of: a view: link, a relative path that can be
 * resolved against a document, or an external/non-navigable link (http,
 * mailto, anchor, etc.). For `view:` and `relative`, callers should
 * `preventDefault` and hand the result to an onNavigate handler.
 */
export function classifyMarkdownHref(
  href: string,
): { kind: "view"; raw: string } | { kind: "relative"; path: string } | { kind: "external" } {
  if (href.startsWith("view:")) return { kind: "view", raw: href };
  // Anything with a URL scheme (http:, mailto:, tel:, data:, etc.) is external.
  if (/^[a-z][\w+.-]*:/i.test(href)) return { kind: "external" };
  // Anchors and empty hrefs are not navigations.
  if (href.startsWith("#") || href === "") return { kind: "external" };
  return { kind: "relative", path: href };
}
