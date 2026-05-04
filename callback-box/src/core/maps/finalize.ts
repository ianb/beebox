/**
 * Map refresh finalize step.
 *
 * Mechanical post-agent work:
 *  1. Ensure each mapped directory has a CLAUDE.md that @-imports MAP.md
 *     (preserves any hand-edited content above/below).
 *  2. Stamp the state file with the current HEAD for every dir the agent
 *     was asked to update.
 *  3. Prune state entries whose directories no longer exist.
 *
 * No git commit here — the procedure engine's "Complete step" commit
 * sweeps these changes into the same commit as the agent's MAP.md writes.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getHead } from "../../cli/lib/git.js";
import { loadMapState, saveMapState, type MapState } from "./state.js";
import type { MapTask } from "./precheck.js";

const INCLUDE_LINE = "@MAP.md";

async function readFileOrNull(absPath: string): Promise<string | null> {
  try {
    return await fs.readFile(absPath, "utf-8");
  } catch {
    return null;
  }
}

async function dirExists(absPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(absPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function fileExists(absPath: string): Promise<boolean> {
  try {
    await fs.access(absPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure `<dir>/CLAUDE.md` exists with an `@MAP.md` line. If the file
 * already exists, only insert the include line (preserving everything
 * else). If absent, create a minimal one-line file.
 */
async function ensureClaudeMdInDir(boxRoot: string, dirRel: string): Promise<void> {
  const claudePath = path.join(boxRoot, dirRel, "CLAUDE.md");
  const existing = await readFileOrNull(claudePath);

  if (existing === null) {
    await fs.writeFile(claudePath, INCLUDE_LINE + "\n");
    return;
  }
  if (existing.includes(INCLUDE_LINE)) return;

  const lines = existing.split("\n");
  let insertAt = 0;
  for (const [idx, line] of lines.entries()) {
    if (line.startsWith("@")) {
      insertAt = idx + 1;
    } else if (line.trim() !== "") {
      break;
    }
  }
  lines.splice(insertAt, 0, INCLUDE_LINE);
  await fs.writeFile(claudePath, lines.join("\n"));
}

interface StampStateOptions {
  boxRoot: string;
  tasks: MapTask[];
  head: string;
}

/**
 * Update state.maps for completed tasks at the current HEAD, then
 * prune entries whose directories no longer exist on disk.
 */
async function stampStateForTasks(options: StampStateOptions): Promise<void> {
  const { boxRoot, tasks, head } = options;
  const state: MapState = await loadMapState(boxRoot);
  const generatedAt = new Date().toISOString();

  for (const task of tasks) {
    state.maps[task.dir] = { asOf: head, generatedAt };
  }

  for (const key of Object.keys(state.maps)) {
    const abs = key === "" ? boxRoot : path.join(boxRoot, key);
    const exists = await dirExists(abs);
    if (!exists) delete state.maps[key];
  }

  await saveMapState({ boxRoot, state });
}

export interface FinalizeOptions {
  boxRoot: string;
  /** The brief produced by precheck and acted on by the agent. */
  tasks: MapTask[];
}

export interface FinalizeResult {
  /** Tasks whose MAP.md was found and got stamped + CLAUDE.md ensured. */
  applied: string[];
  /** Tasks whose dir was deleted between brief and finalize. */
  skippedMissingDir: string[];
  /** Tasks whose MAP.md is still missing — agent didn't write one. */
  skippedMissingMap: string[];
}

/**
 * Run the finalize step. Idempotent — safe to re-run if a previous
 * attempt was interrupted.
 *
 * Tasks whose MAP.md is still missing are *not* stamped, so a re-run
 * of the procedure will pick them up. This guards against agents
 * that exit without writing every promised MAP.md.
 */
export async function finalize(options: FinalizeOptions): Promise<FinalizeResult> {
  const { boxRoot, tasks } = options;
  const result: FinalizeResult = {
    applied: [],
    skippedMissingDir: [],
    skippedMissingMap: [],
  };
  if (tasks.length === 0) return result;

  const appliedTasks: MapTask[] = [];

  for (const task of tasks) {
    const dirAbs = task.dir === "" ? boxRoot : path.join(boxRoot, task.dir);
    if (!(await dirExists(dirAbs))) {
      result.skippedMissingDir.push(task.dir);
      continue;
    }
    const mapAbs = path.join(boxRoot, task.map);
    if (!(await fileExists(mapAbs))) {
      result.skippedMissingMap.push(task.dir);
      continue;
    }
    await ensureClaudeMdInDir(boxRoot, task.dir);
    appliedTasks.push(task);
    result.applied.push(task.dir);
  }

  const head = await getHead(boxRoot);
  await stampStateForTasks({ boxRoot, tasks: appliedTasks, head });

  return result;
}
