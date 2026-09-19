/**
 * Orphan MAP.md files: maps in a directory that no longer gets one.
 *
 * A directory stops qualifying when an ignore pattern hides it
 * (`SKELETON_HIDDEN_PATHS`, `.bbx-maps-ignore`) or when it no longer meets
 * the container and useful-content rules in `listMappableDirs`. The precheck
 * never produces a task for such a directory, so its MAP.md is never
 * refreshed — yet the directory's CLAUDE.md keeps importing it into agent
 * context. Pruning deletes the map and the import. Git history keeps the
 * content.
 *
 * Runs as its own shell-only procedure step, before the agent step, so a box
 * with only orphans never starts an agent.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getHead } from "../../lib/git.js";
import { invariant } from "../../lib/invariant.js";
import { errnoCode } from "../../lib/error-guards.js";
import { CLAUDE_MD, AGENTS_MD } from "../agent-instruction-files.js";
import { listMappableDirs, readBoxTree } from "./precheck-listing.js";
import { loadMapIgnorePatterns, unworkableReason, type SkipReason } from "./gate.js";
import { loadMapState, saveMapState } from "./state.js";

const INCLUDE_LINE = "@MAP.md";

export type OrphanScan = { ok: true; dirs: string[] } | { ok: false; skippedReason: SkipReason };

/**
 * Directories (box-relative) whose committed MAP.md is an orphan. The box
 * root is excluded: its CLAUDE.md is a managed template, and the root never
 * qualifies for a map by rule.
 */
export async function findOrphanMaps(boxRoot: string): Promise<OrphanScan> {
  const skippedReason = await unworkableReason(boxRoot);
  if (skippedReason !== null) return { ok: false, skippedReason };
  const head = await getHead(boxRoot);
  const tree = await readBoxTree(boxRoot, head);
  invariant(tree.ok, `HEAD (${head}) did not resolve while reading the box tree`);
  const mappable = new Set(listMappableDirs(tree.value, await loadMapIgnorePatterns(boxRoot)));
  const dirs: string[] = [];
  for (const [dir, entries] of tree.value) {
    if (dir === "" || mappable.has(dir)) continue;
    if (entries.some((e) => !e.isDir && e.name === "MAP.md")) dirs.push(dir);
  }
  return { ok: true, dirs: dirs.toSorted() };
}

/**
 * Remove `dir`'s MAP.md import from its CLAUDE.md. A CLAUDE.md left empty is
 * deleted with its AGENTS.md mirror symlink; one with other content keeps it.
 */
async function removeInclude(boxRoot: string, dir: string): Promise<void> {
  const claudePath = path.join(boxRoot, dir, CLAUDE_MD);
  let content: string;
  try {
    content = await fs.readFile(claudePath, "utf-8");
  } catch (e) {
    // No CLAUDE.md means no import to remove.
    if (errnoCode(e) === "ENOENT") return;
    throw e;
  }
  const kept = content.split("\n").filter((line) => line.trim() !== INCLUDE_LINE);
  if (kept.join("\n").trim() !== "") {
    await fs.writeFile(claudePath, kept.join("\n"));
    return;
  }
  await fs.rm(claudePath);
  const agentsPath = path.join(boxRoot, dir, AGENTS_MD);
  let agents;
  try {
    agents = await fs.lstat(agentsPath);
  } catch (e) {
    // No AGENTS.md beside it: nothing to clean up.
    if (errnoCode(e) === "ENOENT") return;
    throw e;
  }
  // Only the mirror symlink `ensureAgentsMirror` plants; a real AGENTS.md, or
  // a symlink to anything else, is someone's file.
  if (agents.isSymbolicLink() && (await fs.readlink(agentsPath)) === CLAUDE_MD) await fs.rm(agentsPath);
}

/**
 * Delete each directory's MAP.md, its CLAUDE.md import, and its state entry.
 * Leaves the changes uncommitted; the procedure engine commits the step.
 */
export async function pruneOrphanMaps(boxRoot: string, dirs: readonly string[]): Promise<void> {
  for (const dir of dirs) {
    await fs.rm(path.join(boxRoot, dir, "MAP.md"), { force: true });
    await removeInclude(boxRoot, dir);
  }
  const state = await loadMapState(boxRoot);
  const before = Object.keys(state.maps).length;
  for (const dir of dirs) delete state.maps[dir];
  if (Object.keys(state.maps).length !== before) await saveMapState({ boxRoot, state });
}
