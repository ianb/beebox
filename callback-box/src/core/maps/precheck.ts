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
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Dirent } from "node:fs";
import { simpleGit } from "simple-git";
import { isRepo, getStatus, getHead, hasCommits } from "../../cli/lib/git.js";
import { loadMapState, MAP_STATE_FILE } from "./state.js";

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

export interface MapBrief {
  needsWork: boolean;
  skippedReason?: SkipReason;
  head?: string;
  tasks: MapTask[];
}

export interface PrecheckOptions {
  boxRoot: string;
  /** Directory names to skip when walking. Defaults if not provided. */
  excludeNames?: string[];
}

const DEFAULT_EXCLUDED_NAMES: readonly string[] = [
  ".git",
  ".callback-box",
  "node_modules",
  ".tap",
  "tmp",
];

/** Names that appear in directories but should never appear in the listing. */
const META_FILES: readonly string[] = ["MAP.md", "CLAUDE.md", MAP_STATE_FILE];

function shouldSkipName(name: string, exclude: ReadonlySet<string>): boolean {
  if (exclude.has(name)) return true;
  // Skip dotfiles in listings — infrastructure (.cb-box, .gitignore, etc.).
  if (name.startsWith(".")) return true;
  return false;
}

/**
 * Recursively list every directory in the box that should have a MAP.md.
 * Returns dir paths relative to boxRoot, with "" representing the root.
 */
async function listMappableDirs(
  boxRoot: string,
  exclude: ReadonlySet<string>,
): Promise<string[]> {
  const result: string[] = [""];

  async function walk(rel: string): Promise<void> {
    const abs = path.join(boxRoot, rel);
    let entries: Dirent[];
    try {
      entries = await fs.readdir(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (shouldSkipName(entry.name, exclude)) continue;
      const childRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
      result.push(childRel);
      await walk(childRel);
    }
  }

  await walk("");
  return result;
}

async function fileExists(absPath: string): Promise<boolean> {
  try {
    await fs.access(absPath);
    return true;
  } catch {
    return false;
  }
}

interface ListChildrenAtCommitOptions {
  boxRoot: string;
  dirRel: string;
  commit: string;
  exclude: ReadonlySet<string>;
}

/**
 * Get immediate children of dirRel at the given commit. Names ending in "/"
 * are subdirectories; everything else is a file. Returns sorted; meta files
 * (MAP.md, CLAUDE.md, the state file) and excluded names are filtered out.
 */
async function listChildrenAtCommit(opts: ListChildrenAtCommitOptions): Promise<string[]> {
  const { boxRoot, dirRel, commit, exclude } = opts;
  const ref = dirRel === "" ? commit : `${commit}:${dirRel}`;
  let raw: string;
  try {
    raw = await simpleGit(boxRoot).raw(["ls-tree", ref]);
  } catch {
    return [];
  }
  const items: string[] = [];
  for (const line of raw.split("\n")) {
    const tabIdx = line.indexOf("\t");
    if (tabIdx === -1) continue;
    const meta = line.slice(0, tabIdx).split(/\s+/);
    if (meta.length < 3) continue;
    const type = meta[1];
    const name = line.slice(tabIdx + 1);
    if (shouldSkipName(name, exclude)) continue;
    if (META_FILES.includes(name)) continue;
    items.push(type === "tree" ? `${name}/` : name);
  }
  return items.toSorted();
}

interface ListChildrenOnDiskOptions {
  boxRoot: string;
  dirRel: string;
  exclude: ReadonlySet<string>;
}

/**
 * Get immediate children of dirRel from the working tree (used when no
 * prior state exists, since there's nothing to diff against).
 */
async function listChildrenOnDisk(opts: ListChildrenOnDiskOptions): Promise<string[]> {
  const { boxRoot, dirRel, exclude } = opts;
  const abs = path.join(boxRoot, dirRel);
  let entries: Dirent[];
  try {
    entries = await fs.readdir(abs, { withFileTypes: true });
  } catch {
    return [];
  }
  const items: string[] = [];
  for (const entry of entries) {
    if (shouldSkipName(entry.name, exclude)) continue;
    if (META_FILES.includes(entry.name)) continue;
    items.push(entry.isDirectory() ? `${entry.name}/` : entry.name);
  }
  return items.toSorted();
}

/**
 * Run the precheck and return a brief describing what (if anything) needs
 * to happen. Pure detection — no writes, no commits, no LLM.
 */
export async function precheck(options: PrecheckOptions): Promise<MapBrief> {
  const { boxRoot } = options;
  const excludeList = options.excludeNames ?? DEFAULT_EXCLUDED_NAMES;
  const exclude = new Set(excludeList);

  if (!(await isRepo(boxRoot))) {
    return { needsWork: false, skippedReason: "not_a_repo", tasks: [] };
  }
  if (!(await hasCommits(boxRoot))) {
    return { needsWork: false, skippedReason: "no_commits", tasks: [] };
  }
  const status = await getStatus(boxRoot);
  if (!status.clean) {
    return { needsWork: false, skippedReason: "uncommitted_work", tasks: [] };
  }

  const head = await getHead(boxRoot);
  const state = await loadMapState(boxRoot);
  const dirs = await listMappableDirs(boxRoot, exclude);
  const tasks: MapTask[] = [];

  for (const dirRel of dirs) {
    const mapAbs = path.join(boxRoot, dirRel, "MAP.md");
    const mapRel = dirRel === "" ? "MAP.md" : `${dirRel}/MAP.md`;
    const mapExists = await fileExists(mapAbs);
    const stateEntry = state.maps[dirRel];

    if (!mapExists || !stateEntry) {
      const children = await listChildrenOnDisk({ boxRoot, dirRel, exclude });
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

    const prevChildren = await listChildrenAtCommit({
      boxRoot,
      dirRel,
      commit: stateEntry.asOf,
      exclude,
    });
    const currChildren = await listChildrenAtCommit({
      boxRoot,
      dirRel,
      commit: head,
      exclude,
    });
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
  };
}
