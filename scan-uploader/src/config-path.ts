/**
 * Resolves the DEFAULT config path — used identically by the bare run,
 * `configure`'s `--config` default, and `schedule install`'s `--config`
 * default (one resolver, one way to do it — CLAUDE.md #8). An explicitly
 * given `--config <path>` (or positional config-path argument on the bare
 * run) never goes through this module at all; it's used as given.
 *
 * Resolution order:
 *   1. `./scan-uploader.json` (relative to the caller's cwd), if it exists
 *      — keeps hand-maintained repo-local configs, and the existing
 *      doctests that `cd`-equivalent into a tmp dir, working unchanged.
 *   2. Otherwise `~/.config/scan-uploader.json` — plain `~/.config`,
 *      deliberately no XDG env var lookup.
 *
 * The same order serves both reads and writes: for a read (the bare run,
 * `schedule install`'s config-must-already-exist check), the returned path
 * may not exist at all — that's the "no config found" case, reported by
 * the caller. For a write (`configure` with no `--config`), an existing
 * file at either location is updated in place; if neither exists, the
 * caller's writer (which already tolerates ENOENT and creates parent
 * directories — see `config-writer.ts`/`atomic-write.ts`) creates a fresh
 * one at the `~/.config` candidate, never silently in the cwd.
 */

import { stat } from "node:fs/promises";
import { join } from "node:path";

import { isErrnoException } from "./error-guards.js";

const CONFIG_FILE_NAME = "scan-uploader.json";

export function cwdConfigPath(cwd: string): string {
  return join(cwd, CONFIG_FILE_NAME);
}

export function homeConfigPath(homeDir: string): string {
  return join(homeDir, ".config", CONFIG_FILE_NAME);
}

export interface ResolveConfigPathParams {
  readonly cwd: string;
  readonly homeDir: string;
}

export async function resolveConfigPath(params: ResolveConfigPathParams): Promise<string> {
  const cwdPath = cwdConfigPath(params.cwd);
  if (await pathExists(cwdPath)) return cwdPath;
  return homeConfigPath(params.homeDir);
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (e) {
    if (isErrnoException(e) && e.code === "ENOENT") return false;
    throw e;
  }
}

/** What the bare run prints (and exits non-zero on) when neither resolution
 * candidate exists — colocated with the resolution logic it describes so
 * the wording can't drift from the actual order. Only the does-not-exist
 * case gets this guidance; a config that exists but fails to parse or
 * validate keeps its existing, unrelated `ConfigError` message. */
export const MISSING_CONFIG_MESSAGE: readonly string[] = [
  "No config found (looked for ./scan-uploader.json and ~/.config/scan-uploader.json).",
  "Set up a target with: scan-uploader configure <server-url-with-box> --folder <path>",
  "(mint a token first in the box's Settings -> Scan uploaders)",
];
