/**
 * GitAnnexService — the slice of the `git-annex` binary we actually drive.
 *
 * Wrapped as a service so `cb doctor annex` is testable without a real annex
 * repository on disk: the fake models the handful of states the doctor cares
 * about (not installed, uninitialized, thin, missing largefiles, dirty
 * journal) and records what was repaired.
 *
 * Everything here shells out to `git annex …`, which git dispatches to the
 * separate `git-annex` executable. That indirection is why {@link version}
 * returning null is a normal, expected result rather than an error: on a
 * machine without git-annex the command simply does not exist, and that is a
 * condition the doctor reports rather than throws on.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { errnoCode } from "../lib/error-guards.js";
import { isRecord } from "../lib/is-record.js";

const execFileAsync = promisify(execFile);

/** A config key/value pair — named params, since setters take two values. */
export interface ConfigEntry {
  key: string;
  value: string;
}

export interface GitAnnexService {
  /** Installed version string, or null when git-annex is not on PATH. */
  version(): Promise<string | null>;
  /** Has `git annex init` been run in this repository? */
  isInitialized(repoRoot: string): Promise<boolean>;
  /** Initialize, naming the repository (shows up in `whereis` output). */
  init(repoRoot: string, description: string): Promise<void>;
  /** Read a git-annex config value (the `git annex config` store, which propagates to clones). */
  getAnnexConfig(repoRoot: string, key: string): Promise<string | null>;
  /** Write a git-annex config value. */
  setAnnexConfig(repoRoot: string, entry: ConfigEntry): Promise<void>;
  /** Read a plain git config value (per-clone; this is where annex.thin lives). */
  getGitConfig(repoRoot: string, key: string): Promise<string | null>;
  /** Write a plain git config value. */
  setGitConfig(repoRoot: string, entry: ConfigEntry): Promise<void>;
  /**
   * Re-materialize working-tree files to match the current `annex.thin`.
   *
   * Required after flipping `annex.thin` to false: the config change alone
   * leaves existing files hardlinked to their annex objects, so an in-place
   * edit still silently corrupts the object and `fsck` will not notice. Only
   * this call breaks the hardlinks.
   */
  fix(repoRoot: string): Promise<void>;
  /** Flush the journal into the `git-annex` branch, so clones can see location info. */
  merge(repoRoot: string): Promise<void>;
  /** Is there unflushed journal state that a clone would not see? */
  hasUnflushedJournal(repoRoot: string): Promise<boolean>;
}

async function runAnnex(repoRoot: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["annex", ...args], {
    cwd: repoRoot,
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout.trim();
}

/**
 * `git config --get` exits 1 when the key is unset, which is not an error
 * condition for us. Any other failure propagates.
 */
async function readConfig(repoRoot: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd: repoRoot });
    const value = stdout.trim();
    return value === "" ? null : value;
  } catch (e) {
    if (isExitCode(e, 1)) return null;
    throw e;
  }
}

function isExitCode(e: unknown, code: number): boolean {
  return isRecord(e) && e["code"] === code;
}

export function createGitAnnexService(): GitAnnexService {
  return {
    async version(): Promise<string | null> {
      try {
        const { stdout } = await execFileAsync("git", ["annex", "version"]);
        const first = stdout.split("\n", 1)[0] ?? "";
        return first.replace(/^git-annex version:\s*/, "").trim() || null;
      } catch (e) {
        // ENOENT: no git-annex binary. Any exit status: git couldn't dispatch
        // to it. Both mean "not installed" as far as callers are concerned.
        if (errnoCode(e) === "ENOENT" || isExitCode(e, 1)) return null;
        return null;
      }
    },

    async isInitialized(repoRoot: string): Promise<boolean> {
      try {
        await runAnnex(repoRoot, ["info", "--fast"]);
        return true;
      } catch (_e) {
        /* ignore: a non-annexed repo exits non-zero, which is the answer */
        return false;
      }
    },

    async init(repoRoot: string, description: string): Promise<void> {
      await runAnnex(repoRoot, ["init", description]);
    },

    async getAnnexConfig(repoRoot: string, key: string): Promise<string | null> {
      try {
        const value = await runAnnex(repoRoot, ["config", "--get", key]);
        return value === "" ? null : value;
      } catch (_e) {
        /* ignore: unset key exits non-zero */
        return null;
      }
    },

    async setAnnexConfig(repoRoot: string, { key, value }: ConfigEntry): Promise<void> {
      await runAnnex(repoRoot, ["config", "--set", key, value]);
    },

    async getGitConfig(repoRoot: string, key: string): Promise<string | null> {
      return readConfig(repoRoot, ["config", "--get", key]);
    },

    async setGitConfig(repoRoot: string, { key, value }: ConfigEntry): Promise<void> {
      await execFileAsync("git", ["config", key, value], { cwd: repoRoot });
    },

    async fix(repoRoot: string): Promise<void> {
      await runAnnex(repoRoot, ["fix"]);
    },

    async merge(repoRoot: string): Promise<void> {
      await runAnnex(repoRoot, ["merge"]);
    },

    async hasUnflushedJournal(repoRoot: string): Promise<boolean> {
      // git-annex buffers location-log writes in .git/annex/journal/ until a
      // merge/commit folds them into the git-annex branch. A clone fetching
      // before that flush sees "0 copies" and refuses to `get` — see the
      // worktree-clone track.
      const journalDir = path.join(repoRoot, ".git", "annex", "journal");
      try {
        const entries = await fs.readdir(journalDir);
        return entries.length > 0;
      } catch (e) {
        if (errnoCode(e) === "ENOENT") return false;
        throw e;
      }
    },
  };
}

/** Observable in-memory state for tests. */
export interface FakeGitAnnexOptions {
  version?: string | null;
  initialized?: boolean;
  annexConfig?: Record<string, string>;
  gitConfig?: Record<string, string>;
  unflushedJournal?: boolean;
}

export interface FakeGitAnnexService extends GitAnnexService {
  /** Every mutating call, in order — `init`, `set:<key>=<value>`, `fix`, `merge`. */
  calls: string[];
  describe(): string;
}

export function createFakeGitAnnex(options?: FakeGitAnnexOptions): FakeGitAnnexService {
  const version = options?.version === undefined ? "10.20260717" : options.version;
  let initialized = options?.initialized ?? true;
  const annexConfig: Record<string, string> = { ...options?.annexConfig };
  const gitConfig: Record<string, string> = { ...options?.gitConfig };
  let unflushedJournal = options?.unflushedJournal ?? false;
  const calls: string[] = [];

  return {
    calls,
    async version() {
      return version;
    },
    async isInitialized() {
      return initialized;
    },
    async init(_repoRoot: string, description: string) {
      calls.push(`init:${description}`);
      initialized = true;
    },
    async getAnnexConfig(_repoRoot: string, key: string) {
      return annexConfig[key] ?? null;
    },
    async setAnnexConfig(_repoRoot: string, { key, value }: ConfigEntry) {
      calls.push(`setAnnexConfig:${key}`);
      annexConfig[key] = value;
    },
    async getGitConfig(_repoRoot: string, key: string) {
      return gitConfig[key] ?? null;
    },
    async setGitConfig(_repoRoot: string, { key, value }: ConfigEntry) {
      calls.push(`setGitConfig:${key}=${value}`);
      gitConfig[key] = value;
    },
    async fix() {
      calls.push("fix");
    },
    async merge() {
      calls.push("merge");
      unflushedJournal = false;
    },
    async hasUnflushedJournal() {
      return unflushedJournal;
    },
    describe(): string {
      return [
        `version: ${version ?? "(not installed)"}`,
        `initialized: ${initialized}`,
        `annex.thin: ${gitConfig["annex.thin"] ?? "(unset)"}`,
        `annex.largefiles: ${annexConfig["annex.largefiles"] ?? "(unset)"}`,
        `unflushedJournal: ${unflushedJournal}`,
        `calls: ${calls.join(", ") || "(none)"}`,
      ].join("\n");
    },
  };
}
