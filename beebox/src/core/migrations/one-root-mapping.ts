/**
 * The v2 → v3 path-mapping table for the `one-root` migration
 * (`docs/plans/one-root-box-layout.md` Track E, step 2).
 *
 * A v2 box has TWO roots: the package root (`package.json`, `src/`,
 * `content/`) and the operational root `content/`. Every path this module
 * maps FROM is package-root-relative and starts with `content/` — the v2
 * `BOX_LAYOUT` (now retired; see the snapshot below) described paths
 * relative to `content/` itself, so `content/` is prepended here. Every path
 * this module maps TO is v3-root-relative (the one root).
 *
 * `V2_LAYOUT` below is a frozen snapshot of the pre-Track-A `BOX_LAYOUT`
 * (`git show d7d3a19d3~1:./src/lib/box-layout-spec.ts`) — NOT a re-export of
 * the live (now v3) spec. It exists only so this module's exhaustiveness
 * switch has something to be exhaustive OVER; it must never be "kept in
 * sync" with anything else again, because v2 is frozen history.
 *
 * One real-box finding (2026-09, `~/src/boxes/test1` inspection, read-only)
 * extends the table beyond the clean v2 spec:
 *  - `content/procedure/runs/` (procedure run cards, `docs/procedure-implementation.md`)
 *    was real and undocumented in `BOX_LAYOUT`. `core/procedure/engine.ts`,
 *    `engine-query.ts`, and `gc.ts` used to read `path.join(boxRoot,
 *    "procedure/runs")` literally, box-root-relative — a gap in the landed
 *    Tracks A–C (procedure runs wasn't in `BOX_ROOT_VOCABULARY` either). Both
 *    are now fixed: `BOX_LAYOUT` carries a `procedureRuns` entry
 *    (`_bookkeeping/procedure/runs`, `src/lib/box-layout-spec.ts`), and every
 *    v3 call site reads it via `BOX_DIRS.procedureRuns` /
 *    `getBoxDir(boxRoot, "procedureRuns")`. This mapper converts
 *    `content/procedure/**` → `_bookkeeping/procedure/**`, so a migrated
 *    box's runs land exactly where those call sites now look.
 *  - Real content roots also carry ad hoc top-level files/dirs with no home
 *    in `BOX_LAYOUT` at all (`docs/`, `tmp/`, `interview.md`,
 *    `CLAUDE_SCANS.md`, `.cb-maps-state.json` were observed). The plan's
 *    step 2 documents `content/docs → _content/docs` and `content/tmp →
 *    _tmp` explicitly, so both are real top-level cases here, not fallbacks.
 *    Anything else this table doesn't name is NOT silently mapped:
 *    {@link mapV2Path} returns `{ kind: "unmapped" }` and the migration
 *    script aborts rather than guessing (same "abort, don't delete" stance
 *    as the package-root preflight check) — except free-form
 *    `store/<anything>` (`mapStoreArea`'s default case), which defaults to
 *    `_content/<name>` since `store/` was always user content in v2.
 */

import { assertNever } from "../../lib/invariant.js";

/** Frozen snapshot of the pre-Track-A `BoxLayoutArea` union. Do not extend. */
type V2Area = "box" | "store" | "config" | "people-places" | "tricks" | "agent-config" | "legacy";

interface V2LayoutEntry {
  /** Path relative to the v2 operational root (`content/`). */
  path: string;
  area: V2Area;
}

/** Frozen snapshot of the pre-Track-A `BOX_LAYOUT` (paths only — the prose
 * columns aren't needed for mapping). See the module doc comment. */
const V2_LAYOUT: readonly V2LayoutEntry[] = [
  { path: "box/inbox", area: "box" },
  { path: "box/inbox/unhandled", area: "box" },
  { path: "box/inbox/intake", area: "box" },
  { path: "box/inbox/staged", area: "box" },
  { path: "box/inbox/triaged", area: "box" },
  { path: "box/inbox/triaged/_unsure", area: "box" },
  { path: "box/jobs", area: "box" },
  { path: "box/output", area: "box" },
  { path: "box/publish", area: "box" },
  { path: "box/questions", area: "box" },
  { path: "box/resources", area: "box" },
  { path: "box/commands", area: "legacy" },
  { path: "box/bookmarks", area: "legacy" },
  { path: "store/archive/done", area: "store" },
  { path: "store/archive/failed", area: "store" },
  { path: "store/archive/processed", area: "store" },
  { path: "store/trash", area: "store" },
  { path: "store/recipes", area: "store" },
  { path: "store/todos", area: "store" },
  { path: "store/drive", area: "store" },
  { path: "store/calendar", area: "store" },
  { path: "store/chat", area: "store" },
  { path: "store/usage", area: "store" },
  { path: "store/reviews/retro", area: "store" },
  { path: "people", area: "people-places" },
  { path: "places", area: "people-places" },
  { path: "config", area: "config" },
  { path: "config/connectors", area: "config" },
  { path: "config/schemas", area: "config" },
  { path: "config/procedures", area: "config" },
  { path: "config/schedules", area: "config" },
  { path: "tricks/scripts", area: "tricks" },
  { path: "tricks/lib", area: "tricks" },
  { path: ".claude", area: "agent-config" },
  { path: ".claude/rules", area: "agent-config" },
] as const;

// V2_LAYOUT exists for documentation/inventory parity with the historical
// spec; the actual mapping dispatch below is over a closed key set derived
// from it (`V2_TOP_LEVEL`), not a re-scan of this array. Referencing it here
// keeps `pnpm lint:knip` from flagging the constant as unused while still
// serving its documentation role.
export const V2_LAYOUT_SNAPSHOT: readonly V2LayoutEntry[] = V2_LAYOUT;

/**
 * The exhaustive set of v2 `content/`-relative top-level names this mapper
 * recognizes. Adding a new v2 top-level dir this migration must handle means
 * adding a case here AND to the `switch` in {@link v2AreaPrefixMapping} —
 * `assertNever` makes skipping the second one a compile error.
 */
type V2TopLevel =
  | "box"
  | "store"
  | "people"
  | "places"
  | "docs"
  | "tmp"
  | "config"
  | "tricks"
  | "claude"
  | "procedure"
  | "rootFile"
  | "rootFileAttach"
  | "claudeMdMerge";

/** One v2 root file's fixed v3 destination (everything except CLAUDE.md, which merges). */
const V2_ROOT_FILE_TARGETS: Readonly<Record<string, string>> = {
  "briefing.briefing.card": "_content/briefing.briefing.card",
  "briefing.md": "_content/briefing.md",
  "Box.landmark.card": "_content/Box.landmark.card",
  "MAP.md": "_content/MAP.md",
  // The maps-state cache (`MAP_STATE_FILE`, maps/state.ts) lives at the
  // operational root in both layouts — content root in v2, box root in v3.
  ".bbx-maps-state.json": ".bbx-maps-state.json",
};

/**
 * Finding 10 (Track E hardening review, round 3): a v2 root CARD may carry a
 * sibling `<Name>.attach/` scope (`Name.type.card` -> `Name.attach/`, per the
 * card-attachment convention) that `V2_ROOT_FILE_TARGETS` alone never routed
 * — `content/Box.attach/…` had no case in {@link classify} at all, so the
 * migration aborted preflight on it. Derived from `V2_ROOT_FILE_TARGETS`
 * itself (only `.card` entries have an attach scope) rather than a
 * hand-maintained second table, so the two can never drift apart: adding a
 * root card here automatically carries its attach directory along too.
 */
const V2_ROOT_ATTACH_TARGETS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(V2_ROOT_FILE_TARGETS)
    .filter(([key]) => key.endsWith(".card"))
    .map(([key, target]) => {
      const cardBaseName = key.slice(0, key.indexOf("."));
      const attachDirName = `${cardBaseName}.attach`;
      const targetDir = target.slice(0, target.lastIndexOf("/"));
      return [attachDirName, `${targetDir}/${attachDirName}`];
    }),
);

/** Connector state files split out of `_config/connectors/` into `_bookkeeping/connectors/`
 * (boxholder decision, plan "Open design questions"). Matched by filename suffix. */
function isConnectorStateFile(basename: string): boolean {
  return basename.endsWith(".state.json") || basename === "google-calendar-state.json";
}

export type MapV2PathResult =
  | { kind: "move"; newPath: string }
  /** `content/CLAUDE.md` — merges into the root `CLAUDE.md`, not a plain move. */
  | { kind: "merge-claude-md" }
  /** `content/.gitignore` / `content/.gitattributes` — superseded by the
   * regenerated v3 root versions (Track E step 4); dropped, not moved. */
  | { kind: "discard" }
  /** No recognized mapping — the migration must abort rather than guess. */
  | { kind: "unmapped" };

/** v2's own package-root-adjacent ignore/annex files, superseded wholesale by
 * the regenerated v3 root `.gitignore`/`.gitattributes` (`initBox`). */
const V2_DISCARDED_ROOT_FILES = new Set([".gitignore", ".gitattributes"]);

function topLevelOf(contentRelPath: string): { top: string; rest: string } {
  const slash = contentRelPath.indexOf("/");
  if (slash === -1) return { top: contentRelPath, rest: "" };
  return { top: contentRelPath.slice(0, slash), rest: contentRelPath.slice(slash + 1) };
}

function classify(top: string, contentRelPath: string): V2TopLevel | "discard" | null {
  if (contentRelPath in V2_ROOT_FILE_TARGETS) return "rootFile";
  if (top in V2_ROOT_ATTACH_TARGETS) return "rootFileAttach";
  if (contentRelPath === "CLAUDE.md") return "claudeMdMerge";
  if (V2_DISCARDED_ROOT_FILES.has(contentRelPath)) return "discard";
  switch (top) {
    case "box":
      return "box";
    case "store":
      return "store";
    case "people":
      return "people";
    case "places":
      return "places";
    case "docs":
      return "docs";
    case "tmp":
      return "tmp";
    case "config":
      return "config";
    case "tricks":
      return "tricks";
    case ".claude":
      return "claude";
    case "procedure":
      return "procedure";
    default:
      return null;
  }
}

/**
 * Map one v2 `content/`-relative path to its v3 destination. `contentRelPath`
 * is relative to the v2 operational root (`content/`), forward-slashed, no
 * leading slash — e.g. `"box/inbox/Foo.memo.card"`.
 */
export function mapV2Path(contentRelPath: string): MapV2PathResult {
  const normalized = contentRelPath.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
  if (normalized === "") return { kind: "unmapped" };
  const { top, rest } = topLevelOf(normalized);
  const category = classify(top, normalized);
  if (category === null) {
    // An unknown top-level entry under content/ that isn't a dotfile and
    // isn't v2 machinery is the user's own ad hoc content — v2 allowed such
    // dirs loosely, and v3's `_content/` is open vocabulary by design
    // ("content = things that come from the user", the plan's criterion 2).
    // Real boxes carry these (one fleet box held a whole `images/` tree), so
    // defaulting them into `_content/` is the correct general rule; only
    // dotfiles (unknown runtime state) stay unmapped for a human.
    if (!top.startsWith(".")) return { kind: "move", newPath: "_content/" + normalized };
    return { kind: "unmapped" };
  }

  switch (category) {
    case "rootFile": {
      const target = V2_ROOT_FILE_TARGETS[normalized];
      return target === undefined ? { kind: "unmapped" } : { kind: "move", newPath: target };
    }
    case "rootFileAttach": {
      const target = V2_ROOT_ATTACH_TARGETS[top];
      return target === undefined ? { kind: "unmapped" } : { kind: "move", newPath: joinRel(target, rest) };
    }
    case "claudeMdMerge":
      return { kind: "merge-claude-md" };
    case "discard":
      return { kind: "discard" };
    case "box":
      return mapBoxArea(rest);
    case "store":
      return mapStoreArea(rest);
    case "people":
      return { kind: "move", newPath: joinRel("_content/people", rest) };
    case "places":
      return { kind: "move", newPath: joinRel("_content/places", rest) };
    case "docs":
      return { kind: "move", newPath: joinRel("_content/docs", rest) };
    case "tmp":
      return { kind: "move", newPath: joinRel("_tmp", rest) };
    case "config":
      return mapConfigArea(rest);
    case "tricks":
      return { kind: "move", newPath: joinRel("src/tricks", rest) };
    case "claude":
      return { kind: "move", newPath: joinRel(".claude", rest) };
    case "procedure":
      // Was undocumented in BOX_LAYOUT (real-box finding, see module doc
      // comment) — now has a `procedureRuns` spec entry
      // (`_bookkeeping/procedure/runs`) that every v3 call site reads via
      // `BOX_DIRS.procedureRuns`, so mapping runs into `_bookkeeping/procedure`
      // lands them exactly where those call sites look.
      return { kind: "move", newPath: joinRel("_bookkeeping/procedure", rest) };
    default:
      return assertNever(category);
  }
}

function joinRel(prefix: string, rest: string): string {
  return rest === "" ? prefix : `${prefix}/${rest}`;
}

function mapBoxArea(rest: string): MapV2PathResult {
  const { top, rest: sub } = topLevelOf(rest);
  switch (top) {
    case "inbox":
      return { kind: "move", newPath: joinRel("_content/inbox", sub) };
    case "jobs":
      return { kind: "move", newPath: joinRel("_bookkeeping/jobs", sub) };
    case "output":
      return { kind: "move", newPath: joinRel("_bookkeeping/output", sub) };
    case "questions":
      return { kind: "move", newPath: joinRel("_bookkeeping/questions", sub) };
    case "resources":
      return { kind: "move", newPath: joinRel("_bookkeeping/resources", sub) };
    case "publish":
      return { kind: "move", newPath: joinRel("_publish", sub) };
    default:
      // box/commands, box/bookmarks (legacy/ad hoc, never wired into BOX_DIRS)
      // and anything else unrecognized under box/ — abort rather than guess.
      return { kind: "unmapped" };
  }
}

function mapStoreArea(rest: string): MapV2PathResult {
  const { top, rest: sub } = topLevelOf(rest);
  switch (top) {
    case "archive":
      return { kind: "move", newPath: joinRel("_bookkeeping/archive", sub) };
    case "trash":
      return { kind: "move", newPath: joinRel("_bookkeeping/trash", sub) };
    case "usage":
      return { kind: "move", newPath: joinRel("_bookkeeping/usage", sub) };
    case "recipes":
      return { kind: "move", newPath: joinRel("_content/recipes", sub) };
    case "todos":
      return { kind: "move", newPath: joinRel("_content/todos", sub) };
    case "drive":
      return { kind: "move", newPath: joinRel("_content/drive", sub) };
    case "calendar":
      return { kind: "move", newPath: joinRel("_content/calendar", sub) };
    case "chat":
      return { kind: "move", newPath: joinRel("_content/chat", sub) };
    case "reviews":
      // store/reviews/retro -> _content/reviews/retro. The plan's Track E
      // step-2 prose lists store/reviews under _bookkeeping, but the
      // "Open design questions" section (boxholder-resolved) and the
      // already-landed v3 BOX_LAYOUT both place retro reports at
      // _content/reviews/retro — followed here as ground truth over the
      // stale prose (see this module's doc comment / migration report).
      return { kind: "move", newPath: joinRel("_content/reviews", sub) };
    default:
      // Free-form `store/<anything>` this table doesn't name explicitly
      // (e.g. `store/notes/`) was always user content in v2 — default it to
      // `_content/<top>` rather than aborting the whole migration over an
      // ad hoc bucket. `box/<unknown>` (machinery, not content) keeps the
      // abort-and-reconcile stance below.
      return { kind: "move", newPath: joinRel(`_content/${top}`, sub) };
  }
}

function mapConfigArea(rest: string): MapV2PathResult {
  if (rest === "") return { kind: "move", newPath: "_config" };
  const { top, rest: sub } = topLevelOf(rest);
  if (top === "connectors" && sub !== "" && !sub.includes("/")) {
    if (isConnectorStateFile(sub)) {
      return { kind: "move", newPath: `_bookkeeping/connectors/${sub}` };
    }
  }
  return { kind: "move", newPath: joinRel("_config", rest) };
}
