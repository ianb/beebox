/**
 * Map refresh precheck.
 *
 * Walks the box, identifies which MAP.md files need to be created or
 * updated, and produces a structured brief that the daily refresh-maps
 * procedure passes to its agent. No filesystem mutations and no LLM calls
 * — pure detection so the no-op path stays cheap.
 *
 * Trigger rule: a MAP.md needs regeneration only when its directory's
 * immediate-children set has changed (added/deleted/renamed). Plain edits
 * to existing files don't invalidate the index.
 *
 * The walking/listing helpers live in `precheck-listing.ts` and the
 * ignore-pattern matching in `precheck-ignore.ts`; this file owns the
 * public types and orchestrates the detection.
 */

import * as path from "node:path";
import { isRepo, getStatus, getHead, hasCommits, gitBoxPrefix } from "../../lib/git.js";
import { loadMapState } from "./state.js";
import {
  DEFAULT_IGNORE_PATTERNS,
  SKELETON_HIDDEN_PATHS,
  loadUserIgnorePatterns,
} from "./precheck-ignore.js";
import {
  listMappableDirs,
  listChildrenAtCommit,
  listChildrenOnDisk,
} from "./precheck-listing.js";
import { fileExists } from "../../lib/file-exists.js";
import { invariant } from "../../lib/invariant.js";

export interface MapTask {
  /** Path of the MAP.md to write, relative to box root. */
  map: string;
  /** Directory the map describes, relative to box root ("" for root). */
  dir: string;
  /** "create" if MAP.md is missing or has no recorded state; "update" otherwise. */
  action: "create" | "update";
  /** Commit hash the prior MAP.md was generated from (update only). */
  asOf?: string;
  /** Current HEAD commit hash. */
  head: string;
  /** Children added since asOf. Empty for "create". */
  added: string[];
  /** Children deleted since asOf. Empty for "create". */
  deleted: string[];
  /** Current immediate-children listing (always populated for the agent's use). */
  children: string[];
}

export type SkipReason = "uncommitted_work" | "not_a_repo" | "no_commits";

/**
 * A box-data problem found during detection. Not a failure — the precheck
 * works around each one and keeps going — but a symptom worth surfacing,
 * since it usually means the box's git state is inconsistent.
 */
export interface MapAnomaly {
  kind: "asof_unresolvable";
  /** Directory whose recorded state is affected, relative to box root. */
  dir: string;
  /** The commit hash that no longer resolves. */
  asOf: string;
}

export interface MapBrief {
  needsWork: boolean;
  skippedReason?: SkipReason;
  head?: string;
  tasks: MapTask[];
  /** Box-data problems found while detecting. Empty on a healthy box. */
  anomalies: MapAnomaly[];
}

export interface PrecheckOptions {
  boxRoot: string;
  /** Override ignore patterns. If unset, uses defaults plus .bbx-maps-ignore. */
  ignorePatterns?: readonly string[];
}

/**
 * Run the precheck and return a brief describing what (if anything) needs
 * to happen. Pure detection — no writes, no commits, no LLM.
 */
export async function precheck(options: PrecheckOptions): Promise<MapBrief> {
  const { boxRoot } = options;
  let patterns: readonly string[];
  if (options.ignorePatterns) {
    patterns = options.ignorePatterns;
  } else {
    const userPatterns = await loadUserIgnorePatterns(boxRoot);
    patterns = [...DEFAULT_IGNORE_PATTERNS, ...SKELETON_HIDDEN_PATHS, ...userPatterns];
  }

  if (!(await isRepo(boxRoot))) {
    return { needsWork: false, skippedReason: "not_a_repo", tasks: [], anomalies: [] };
  }
  if (!(await hasCommits(boxRoot))) {
    return { needsWork: false, skippedReason: "no_commits", tasks: [], anomalies: [] };
  }
  const status = await getStatus(boxRoot);
  // getStatus paths are repo-root-relative; on a v2 box the repo root is the
  // package root, so they carry a `content/` prefix. Strip it back to
  // box-relative before the `procedure/runs/` filter below — otherwise the
  // filter never matches and refresh-maps bails as `uncommitted_work` inside
  // its own procedure step (the exact case the filter exists to allow).
  const prefix = await gitBoxPrefix(boxRoot);
  const strip = (p: string): string => (prefix !== "" && p.startsWith(prefix) ? p.slice(prefix.length) : p);
  // Filter out paths inside procedure/runs — the procedure engine
  // intentionally writes uncommitted state there as a "step is running"
  // signal, so blanket-bailing on uncommitted work would prevent
  // refresh-maps from running inside its own procedure step.
  const dirtyPaths = [...status.staged, ...status.modified, ...status.untracked]
    .map(strip)
    .filter((p) => !p.startsWith("procedure/runs/"));
  if (dirtyPaths.length > 0) {
    return { needsWork: false, skippedReason: "uncommitted_work", tasks: [], anomalies: [] };
  }

  const head = await getHead(boxRoot);
  const state = await loadMapState(boxRoot);
  const dirs = await listMappableDirs(boxRoot, patterns);
  const tasks: MapTask[] = [];
  const anomalies: MapAnomaly[] = [];

  for (const dirRel of dirs) {
    const mapAbs = path.join(boxRoot, dirRel, "MAP.md");
    const mapRel = dirRel === "" ? "MAP.md" : `${dirRel}/MAP.md`;
    const mapExists = await fileExists(mapAbs);
    const stateEntry = state.maps[dirRel];

    if (!mapExists || !stateEntry) {
      const children = await listChildrenOnDisk({ boxRoot, dirRel, patterns });
      tasks.push({
        map: mapRel,
        dir: dirRel,
        action: "create",
        head,
        added: [],
        deleted: [],
        children,
      });
      continue;
    }

    if (stateEntry.asOf === head) continue;

    const prev = await listChildrenAtCommit({
      boxRoot,
      dirRel,
      commit: stateEntry.asOf,
      patterns,
    });
    const curr = await listChildrenAtCommit({
      boxRoot,
      dirRel,
      commit: head,
      patterns,
    });
    // HEAD must resolve — we just read it from this repo. If it doesn't, the
    // repo is broken in a way no local workaround should paper over.
    invariant(curr.ok, `HEAD (${head}) did not resolve while listing ${dirRel}`);
    const currChildren = curr.value;

    if (!prev.ok) {
      // The recorded asOf is gone (history rewritten, GC'd, shallow clone).
      // There's no trustworthy prior listing to diff against, so a diff would
      // be fiction — every current child would read as "added". Regenerate the
      // whole MAP.md from the current listing instead, and record the anomaly.
      console.warn(
        `refresh-maps: recorded asOf ${prev.error.commit} for "${dirRel || "<root>"}" ` +
          "does not resolve — regenerating its MAP.md from the current listing. " +
          "This usually means the box's git history was rewritten.",
      );
      anomalies.push({ kind: "asof_unresolvable", dir: dirRel, asOf: prev.error.commit });
      tasks.push({
        map: mapRel,
        dir: dirRel,
        action: "create",
        head,
        added: [],
        deleted: [],
        children: currChildren,
      });
      continue;
    }

    const prevChildren = prev.value;
    const prevSet = new Set(prevChildren);
    const currSet = new Set(currChildren);
    const added = currChildren.filter((c) => !prevSet.has(c));
    const deleted = prevChildren.filter((c) => !currSet.has(c));

    if (added.length === 0 && deleted.length === 0) continue;

    tasks.push({
      map: mapRel,
      dir: dirRel,
      action: "update",
      asOf: stateEntry.asOf,
      head,
      added,
      deleted,
      children: currChildren,
    });
  }

  return {
    needsWork: tasks.length > 0,
    head,
    tasks,
    anomalies,
  };
}
