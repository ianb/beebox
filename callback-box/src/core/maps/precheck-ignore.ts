/**
 * Ignore-pattern matching for the map refresh precheck.
 *
 * Decides which directory entries are excluded from walking and listing.
 * Self-contained leaf module: the built-in pattern sets, the user-extensible
 * `.cb-maps-ignore` loader, the gitignore-subset matcher, and the top-level
 * `isIgnored` predicate. Used by the walker/listers in `precheck-listing.ts`
 * and seeded by `precheck.ts`.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { MAP_STATE_FILE } from "./state.js";
import { AGENT_INSTRUCTION_FILES } from "../agent-instruction-files.js";

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
export const DEFAULT_IGNORE_PATTERNS: readonly string[] = [
  ".git",
  ".callback-box",
  "node_modules",
  ".tap",
  "tmp",
  // Card attach scopes are an implementation detail of the card layout —
  // skip them when generating maps; the card itself stands for its scope.
  "**/*.attach",
];

/**
 * Standard cb-init skeleton paths whose contents are pure scaffolding —
 * either high-churn machinery (inbox stages, procedure runs), mirrors of
 * external state (drive sync, calendar sync), or structural config that
 * varies little across boxes and is already documented globally
 * (`config/connectors/`, `config/schemas/`). Per-box MAPs add nothing
 * here, so we hide the whole subtree: the dir itself is excluded from its
 * parent's listing AND no MAP is generated inside it.
 *
 * Listed separately from DEFAULT_IGNORE_PATTERNS to make intent visible:
 * these are part of the box's structural contract, not generic ignore
 * rules. Functionally they extend the ignore set the same way.
 */
export const SKELETON_HIDDEN_PATHS: readonly string[] = [
  "box/inbox/**",
  "box/jobs/**",
  "box/output/**",
  "box/questions/**",
  "box/resources/**",
  "box/commands/**",
  "box/briefs/**",
  "procedure/**",
  "store/archive/**",
  "store/trash/**",
  "store/calendar/**",
  "store/drive/**",
  "store/chat/**",
  "config/_template-updates/**",
  "config/connectors/**",
  "config/schemas/**",
  // Machine-owned box config: the admin UI and the invite-accept path rewrite
  // it behind the agent's back, and its fields are documented in
  // docs/box-layout.md. A per-box MAP bullet would only go stale.
  "config/box.json",
  "config/procedures/**",
  "config/schedules/**",
  "docs/generated/**",
  "tricks/lib/**",
  "tricks/scripts/**",
];

const IGNORE_FILE = ".cb-maps-ignore";

/**
 * Names that appear in directories but should never appear in the listing.
 *
 * Both instruction filenames, not just `CLAUDE.md`: every box gets an
 * `AGENTS.md` symlink beside each `CLAUDE.md`. Listing only one of them left
 * the precheck demanding that each MAP describe a symlink to the file excluded
 * beside it — an item no agent could satisfy, so refresh-maps failed on every
 * run and blocked the real map work in the same run behind it.
 */
const META_FILES: readonly string[] = ["MAP.md", ...AGENT_INSTRUCTION_FILES, MAP_STATE_FILE];

export async function loadUserIgnorePatterns(boxRoot: string): Promise<string[]> {
  try {
    const raw = await fs.readFile(path.join(boxRoot, IGNORE_FILE), "utf-8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));
  } catch (e) {
    if (e instanceof Error && "code" in e && e.code === "ENOENT") {
      // No .cb-maps-ignore file is the normal case; fall back to defaults.
      return [];
    }
    console.warn(`Failed to read ${IGNORE_FILE}, using default ignore patterns:`, e);
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
  // eslint-disable-next-line security/detect-non-literal-regexp -- regex is built from pattern with every metacharacter escaped above (only `*` -> `[^/]*`), so it is injection- and ReDoS-safe.
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
 * and meta files (the MAP.md, either instruction filename, and the state file
 * we generate ourselves).
 * Then any matching ignore pattern.
 */
export function isIgnored(options: IsIgnoredOptions): boolean {
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

/** Join a child name onto a box-relative parent dir path. */
export function joinChildPath(parentRel: string, name: string): string {
  return parentRel === "" ? name : `${parentRel}/${name}`;
}
