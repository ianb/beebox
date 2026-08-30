/**
 * Route → place mapping for the app bar's `PlacePill`.
 *
 * The pill names the current *place* (box ▸ landmark). On a chat page the
 * chat itself publishes its session's context dir (Track C2 of
 * docs/plans/top-nav-ia.md); until then — and on every non-chat page, which
 * never publishes — the bar derives the place from the route alone. That
 * fallback is this module: a pure pathname → `{ label, dir }` map, so it can
 * be doctested without a router.
 *
 * `dir` is the box-relative directory the place sits in (`""` = box root,
 * `null` = the route has no directory at all). It's what the pill hands to
 * `landmarks.forDir`: a landmark there upgrades the face to the landmark's
 * symbol + label and enables the "here" half.
 */

/** A place the bar can name: a display label plus the dir it lives in. */
export interface Place {
  /** Face text for the pill's left half when no landmark resolves. */
  label: string;
  /** Box-relative dir (`""` = box root); null when the route has none. */
  dir: string | null;
}

/**
 * Routes whose label is fixed and which carry no directory. `/chat` is here
 * with `dir: null` in C1 — the session's real context dir arrives with the
 * chrome context in C2.
 */
const STATIC_LABELS: Record<string, string> = {
  chat: "Chat",
  landmarks: "All landmarks",
  dashboard: "Dashboard",
  history: "History",
  questions: "Questions",
  settings: "Settings",
  admin: "Admin",
};

/** The landing place — also the fallback for any route not mapped below. */
const CHAT_PLACE: Place = { label: "Chat", dir: null };

/**
 * The directory a box path sits in. A trailing segment containing a `.` is
 * treated as a file (its dirname is the dir); anything else is itself a
 * directory. The heuristic can't be exact from a path alone — `/browse/`
 * serves both files and dirs — and it fails safe: a wrong guess resolves no
 * landmark, so the pill simply shows no "here" half.
 */
function dirOfPath(path: string): string {
  if (path === "") return "";
  const segments = path.split("/");
  const last = segments[segments.length - 1];
  if (last !== undefined && last.includes(".")) return segments.slice(0, -1).join("/");
  return path;
}

/**
 * Map a router pathname (box-slug-prefixed, Vite base already stripped by the
 * router) to the place the bar should name.
 */
export function placeLabel({ pathname, boxSlug }: { pathname: string; boxSlug: string }): Place {
  const prefix = `/${boxSlug}`;
  const withoutBox = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : pathname;
  const rest = withoutBox.endsWith("/") ? withoutBox.slice(0, -1) : withoutBox;
  if (rest === "") return CHAT_PLACE;

  const segments = rest.split("/").filter((s) => s !== "");
  const head = segments[0];
  if (head === undefined) return CHAT_PLACE;
  const tail = segments.slice(1).join("/");

  const staticLabel = STATIC_LABELS[head];
  if (staticLabel !== undefined) return { label: staticLabel, dir: null };

  if (head === "browse") {
    return {
      label: tail === "" ? "Browse" : `Browse: ${tail}`,
      dir: dirOfPath(tail),
    };
  }

  // Both card routes render one card; the pill names the kind, not the file
  // (the file's own title is the page heading). The dir still resolves so the
  // "here" half can offer the enclosing landmark's bookmarks.
  if (head === "card" || head === "views") {
    return { label: "Card", dir: dirOfPath(tail) };
  }

  return CHAT_PLACE;
}
