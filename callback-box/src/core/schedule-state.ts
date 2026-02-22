/**
 * Schedule state tracking for scheduled scripts.
 *
 * State is machine-local (gitignored) — last-run timestamps
 * aren't meaningful across machines.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface ScriptState {
  lastRun: string | null;
  lastResult: "success" | "failure" | null;
  lastError: string | null;
  runCount: number;
}

const EMPTY_STATE: ScriptState = {
  lastRun: null,
  lastResult: null,
  lastError: null,
  runCount: 0,
};

function stateDir(boxRoot: string): string {
  return path.join(boxRoot, "config/schedules/.state");
}

function stateFile(boxRoot: string, scriptName: string): string {
  return path.join(stateDir(boxRoot), `${scriptName}.json`);
}

/**
 * Load the run state for a script, or return empty state if none exists.
 */
export async function loadScriptState(boxRoot: string, scriptName: string): Promise<ScriptState> {
  try {
    const content = await fs.readFile(stateFile(boxRoot, scriptName), "utf-8");
    return JSON.parse(content) as ScriptState;
  } catch {
    return { ...EMPTY_STATE };
  }
}

export interface SaveStateOptions {
  boxRoot: string;
  scriptName: string;
  state: ScriptState;
}

/**
 * Save the run state for a script.
 */
export async function saveScriptState(opts: SaveStateOptions): Promise<void> {
  const dir = stateDir(opts.boxRoot);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    stateFile(opts.boxRoot, opts.scriptName),
    JSON.stringify(opts.state, null, 2) + "\n"
  );
}
