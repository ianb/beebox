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
  /** Override ignore patterns. If unset, uses defaults plus .cb-maps-ignore. */
  ignorePatterns?: readonly string[];
}

/**
 * Built-in ignore patterns for directory walking and listing.
 *
 * Pattern syntax (subset of gitignore):
 *   - "name"           basename match (any depth). E.g. "node_modules"
 *   - "path/to/dir"    exact relative-path match
 *   - "path/STAR"      direct-child match (any single segment under path).
 *                      STAR is one asterisk. E.g. "store/catalogs/STAR".
 *   - "path/STARSTAR"  any descendant of path (path itself stays mappable).
 *                      STARSTAR is two asterisks.
 *   - "STARSTAR/X"     basename match where X may contain "STAR" wildcards.
 *
 * Users extend via a `.cb-maps-ignore` file at the box root, one pattern
 * per line, "#" for comments. Negation (gitignore "!") is not supported.
 */
const DEFAULT_IGNORE_PATTERNS: readonly string[] = [
  ".git",
  ".callback-box",
  "node_modules",
  ".tap",
  "tmp",
  "procedure/runs",
  "**/thread-*",
  "**/capture-*",
  "**/scan-*",
];

const IGNORE_FILE = ".cb-maps-ignore";

/** Names that appear in directories but should never appear in the listing. */
const META_FILES: readonly string[] = ["MAP.md", "CLAUDE.md", MAP_STATE_FILE];

async function loadUserIgnorePatterns(boxRoot: string): Promise<string[]> {
  try {
    const raw = await fs.readFile(path.join(boxRoot, IGNORE_FILE), "utf-8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));
  } catch {
    return [];
  }
}

/** Match a name against a pattern containing only `*` wildcards. */
function basenameGlobMatch(pattern: string, name: string): boolean {
  if (!pattern.includes("*")) return pattern === name;
  let regex = "";
  for (const ch of pattern) {
    if (ch === "*") {
      regex += "[^/]*";
    } else if ("$()+.[\\]^{|}?".includes(ch)) {
      regex += "\\" + ch;
    } else {
      regex += ch;
    }
  }
  return new RegExp("^" + regex + "$").test(name);
}

interface MatchIgnoreOptions {
  pattern: string;
  relPath: string;
  basename: string;
}

function matchIgnorePattern(options: MatchIgnoreOptions): boolean {
  const { pattern, relPath, basename } = options;
  if (pattern.startsWith("**/")) {
    return basenameGlobMatch(pattern.slice(3), basename);
  }
  if (pattern.endsWith("/**")) {
    const prefix = pattern.slice(0, -3);
    return relPath === prefix || relPath.startsWith(prefix + "/");
  }
  if (pattern.endsWith("/*")) {
    const prefix = pattern.slice(0, -2);
    if (!relPath.startsWith(prefix + "/")) return false;
    return !relPath.slice(prefix.length + 1).includes("/");
  }
  if (pattern.includes("/")) {
    return pattern === relPath;
  }
  return basenameGlobMatch(pattern, basename);
}

interface IsIgnoredOptions {
  patterns: readonly string[];
  relPath: string;
  isFile: boolean;
}

/**
 * Should this entry be excluded from walking and listing?
 *
 * Always-true cases: dotfiles (we never index `.gitignore`, `.cb-box`, etc.)
 * and meta files (the MAP.md / CLAUDE.md / state file we generate ourselves).
 * Then any matching ignore pattern.
 */
function isIgnored(options: IsIgnoredOptions): boolean {
  const { patterns, relPath, isFile } = options;
  if (relPath === "") return false;
  const basename = path.basename(relPath);
  if (basename.startsWith(".")) return true;
  if (isFile && META_FILES.includes(basename)) return true;
  for (const pattern of patterns) {
    if (matchIgnorePattern({ pattern, relPath, basename })) return true;
  }
  return false;
}

/**
 * Recursively list every directory in the box that should have a MAP.md.
 * Returns dir paths relative to boxRoot, with "" representing the root.
 *
 * Container rule: a dir is mappable only when it has at least one visible
 * subdirectory. File-only ("leaf") dirs are skipped — the parent's MAP.md
 * already lists them, and an `ls` shows their contents directly. Shell
 * dirs (subdirs hidden by ignore patterns leave the parent looking empty)
 * are skipped at the dir-itself level but still appear in their parent's
 * listing — that's where their description belongs.
 */
async function listMappableDirs(
  boxRoot: string,
  patterns: readonly string[],
): Promise<string[]> {
  const result: string[] = [];

  /** Returns the count of visible immediate subdirs in `rel`. */
  async function walk(rel: string): Promise<number> {
    const abs = path.join(boxRoot, rel);
    let entries: Dirent[];
    try {
      entries = await fs.readdir(abs, { withFileTypes: true });
    } catch {
      return 0;
    }
    let visibleSubdirs = 0;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const childRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (isIgnored({ patterns, relPath: childRel, isFile: false })) continue;
      visibleSubdirs += 1;
      await walk(childRel);
    }
    if (visibleSubdirs > 0) {
      result.push(rel);
    }
    return visibleSubdirs;
  }

  await walk("");
  return result.toSorted();
}

async function fileExists(absPath: string): Promise<boolean> {
  try {
    await fs.access(absPath);
    return true;
  } catch {
    return false;
  }
}

function joinChildPath(parentRel: string, name: string): string {
  return parentRel === "" ? name : `${parentRel}/${name}`;
}

interface ListChildrenAtCommitOptions {
  boxRoot: string;
  dirRel: string;
  commit: string;
  patterns: readonly string[];
}

/**
 * Get immediate children of dirRel at the given commit. Names ending in "/"
 * are subdirectories; everything else is a file. Returns sorted; meta files
 * and ignored names are filtered out.
 */
async function listChildrenAtCommit(opts: ListChildrenAtCommitOptions): Promise<string[]> {
  const { boxRoot, dirRel, commit, patterns } = opts;
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
    const isFile = type !== "tree";
    if (isIgnored({ patterns, relPath: joinChildPath(dirRel, name), isFile })) continue;
    items.push(isFile ? name : `${name}/`);
  }
  return items.toSorted();
}

interface ListChildrenOnDiskOptions {
  boxRoot: string;
  dirRel: string;
  patterns: readonly string[];
}

/**
 * Get immediate children of dirRel from the working tree (used when no
 * prior state exists, since there's nothing to diff against).
 */
async function listChildrenOnDisk(opts: ListChildrenOnDiskOptions): Promise<string[]> {
  const { boxRoot, dirRel, patterns } = opts;
  const abs = path.join(boxRoot, dirRel);
  let entries: Dirent[];
  try {
    entries = await fs.readdir(abs, { withFileTypes: true });
  } catch {
    return [];
  }
  const items: string[] = [];
  for (const entry of entries) {
    const isFile = !entry.isDirectory();
    if (isIgnored({ patterns, relPath: joinChildPath(dirRel, entry.name), isFile })) continue;
    items.push(isFile ? entry.name : `${entry.name}/`);
  }
  return items.toSorted();
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
    patterns = [...DEFAULT_IGNORE_PATTERNS, ...userPatterns];
  }

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
  const dirs = await listMappableDirs(boxRoot, patterns);
  const tasks: MapTask[] = [];

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

    const prevChildren = await listChildrenAtCommit({
      boxRoot,
      dirRel,
      commit: stateEntry.asOf,
      patterns,
    });
    const currChildren = await listChildrenAtCommit({
      boxRoot,
      dirRel,
      commit: head,
      patterns,
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
