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
