/**
 * Map refresh finalize step.
 *
 * Mechanical post-agent work:
 *  1. Ensure each mapped directory has a CLAUDE.md that @-imports MAP.md
 *     (preserves any hand-edited content above/below), and an AGENTS.md
 *     symlink beside it so a Codex session sees the new MAP too.
 *  2. Stamp the state file with the current HEAD for every task whose MAP.md
 *     the agent rewrote, or that passes the coverage check in `verify.ts`.
 *  3. Prune state entries whose directories no longer exist.
 *
 * No git commit here — the procedure engine's "Complete step" commit
 * sweeps these changes into the same commit as the agent's MAP.md writes.
 */

import * as fs from "node:fs/promises";
import { fileExists } from "../../lib/file-exists.js";
import * as path from "node:path";
import { simpleGit } from "simple-git";
import { loadMapState, saveMapState, type MapState } from "./state.js";
import type { MapTask } from "./precheck.js";
import { CLAUDE_MD } from "../agent-instruction-files.js";
import { ensureAgentsMirror } from "../agent-context-mirrors.js";
import { verifyMapCoverage } from "./verify.js";

const INCLUDE_LINE = "@MAP.md";

async function readFileOrNull(absPath: string): Promise<string | null> {
  try {
    return await fs.readFile(absPath, "utf-8");
  } catch (_e) {
    // Read failure (typically ENOENT) means "no existing file" — the
    // caller treats null as absent and creates one. No actionable info.
    return null;
  }
}

async function dirExists(absPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(absPath);
    return stat.isDirectory();
  } catch (_e) {
    // stat failure (typically ENOENT) means the path is not a directory.
    return false;
  }
}

interface MapWasRewrittenOptions {
  boxRoot: string;
  task: MapTask;
}

/**
 * Did the agent actually rewrite this task's MAP.md during this run?
 *
 * The file merely existing is not evidence: an `update` task's MAP.md already
 * exists, untouched, so an existence check always passes and would stamp maps
 * the agent never reached — silently marking stale listings current, which is
 * exactly what this step's `whys` says the design must prevent.
 *
 * Evidence is instead "does the MAP.md differ from what it was at the brief's
 * HEAD (`task.head`)". Two probes, because neither covers the whole space:
 *
 * - `git diff <task.head> -- <map>` catches a rewrite whether the agent
 *   committed it or left it in the working tree, but is blind to a file git
 *   isn't tracking yet.
 * - `git status --porcelain -- <map>` catches exactly that case — a `create`
 *   task's brand-new, still-untracked MAP.md.
 *
 * Both compare against the working tree rather than HEAD, because the procedure
 * engine's `ensureGitClean` has not committed the agent's writes at the point
 * finalize runs (`engine-run-phase.ts` runs the run shells before it).
 *
 * The pathspec is box-relative with no `gitBoxPrefix`: `git diff` and
 * `git status` interpret pathspecs relative to the CWD, which is `boxRoot`
 * here — unlike `ls-tree --full-tree` in `precheck-listing.ts`, which forces
 * repo-root interpretation and therefore does need the prefix.
 */
async function mapWasRewritten(options: MapWasRewrittenOptions): Promise<boolean> {
  const { boxRoot, task } = options;
  const git = simpleGit(boxRoot);
  const [diffed, statused] = await Promise.all([
    git.diff(["--name-only", task.head, "--", task.map]),
    git.raw(["status", "--porcelain", "--", task.map]),
  ]);
  return diffed.trim() !== "" || statused.trim() !== "";
}


/**
 * Ensure `<dir>/CLAUDE.md` exists with an `@MAP.md` line. If the file
 * already exists, only insert the include line (preserving everything
 * else). If absent, create a minimal one-line file.
 */
async function ensureClaudeMdInDir(boxRoot: string, dirRel: string): Promise<void> {
  const claudePath = path.join(boxRoot, dirRel, CLAUDE_MD);
  const existing = await readFileOrNull(claudePath);

  if (existing === null) {
    await fs.writeFile(claudePath, INCLUDE_LINE + "\n");
    // Codex reads only AGENTS.md, so a CLAUDE.md with no mirror beside it
    // leaves the directory's new MAP invisible there until some later run of
    // `generate-docs` happens to plant one.
    await ensureAgentsMirror(claudePath);
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
}

/**
 * Record completed tasks as current at the brief's HEAD (`task.head`), then
 * prune entries whose directories no longer exist on disk.
 *
 * The brief's HEAD, not the HEAD at finalize time: the map was written and
 * verified against the brief's listing. A child committed by another writer
 * while the agent ran is in the later HEAD but not in that listing; stamping
 * the later HEAD would hide it from every future diff. MAP.md and the
 * instruction files the agent's own commit adds are meta files, invisible to
 * the listing, so stamping the earlier commit does not re-dirty the map.
 */
async function stampStateForTasks(options: StampStateOptions): Promise<void> {
  const { boxRoot, tasks } = options;
  const state: MapState = await loadMapState(boxRoot);
  const generatedAt = new Date().toISOString();

  for (const task of tasks) {
    state.maps[task.dir] = { asOf: task.head, generatedAt };
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

/** A task whose MAP.md failed the coverage check, and why. */
export interface CoverageFailure {
  dir: string;
  problems: string[];
}

export interface FinalizeResult {
  /** Tasks whose MAP.md was rewritten this run; stamped + CLAUDE.md ensured. */
  applied: string[];
  /**
   * Tasks whose MAP.md was not rewritten but passes the coverage check —
   * already correct, so stamped + CLAUDE.md ensured. Without this, a map
   * whose correct result is "no change" could never be stamped.
   */
  verified: string[];
  /**
   * Every task whose MAP.md failed the coverage check. A rewritten map is
   * still stamped (listed in `applied` too); an unchanged one is left for a
   * later run (listed in `skippedUnchanged` too).
   */
  coverageFailures: CoverageFailure[];
  /** Tasks whose dir was deleted between brief and finalize. */
  skippedMissingDir: string[];
  /** Tasks whose MAP.md is still missing — agent didn't write one. */
  skippedMissingMap: string[];
  /**
   * Tasks whose MAP.md exists, is unchanged since the brief, and fails the
   * coverage check — the agent never got to them (typically it ran out of
   * turns). Left unstamped so the next run picks them up.
   */
  skippedUnchanged: string[];
}

/**
 * Run the finalize step. Idempotent — safe to re-run if a previous
 * attempt was interrupted.
 *
 * A task is stamped when its MAP.md was rewritten this run (see
 * {@link mapWasRewritten}) or passes {@link verifyMapCoverage}; the rest are
 * left for a later run. That makes
 * partial progress bank correctly: an agent that gets through half its tasks
 * before running out of turns advances `asOf` for exactly that half, so the
 * next run starts from where it stopped instead of repeating the whole brief.
 */
export async function finalize(options: FinalizeOptions): Promise<FinalizeResult> {
  const { boxRoot, tasks } = options;
  const result: FinalizeResult = {
    applied: [],
    verified: [],
    coverageFailures: [],
    skippedMissingDir: [],
    skippedMissingMap: [],
    skippedUnchanged: [],
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
    const coverage = verifyMapCoverage({
      dir: task.dir,
      content: await fs.readFile(mapAbs, "utf-8"),
      children: task.children,
    });
    if (!coverage.ok) result.coverageFailures.push({ dir: task.dir, problems: coverage.problems });
    if (await mapWasRewritten({ boxRoot, task })) {
      result.applied.push(task.dir);
    } else if (coverage.ok) {
      result.verified.push(task.dir);
    } else {
      result.skippedUnchanged.push(task.dir);
      continue;
    }
    await ensureClaudeMdInDir(boxRoot, task.dir);
    appliedTasks.push(task);
  }

  await stampStateForTasks({ boxRoot, tasks: appliedTasks });

  return result;
}
