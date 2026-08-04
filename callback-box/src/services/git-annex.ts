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
  /**
   * Every annexed path in the working tree, repo-relative.
   *
   * Includes paths whose content is absent — `--anything` rather than the
   * default "content present here" matcher. A file the box cannot currently
   * fetch is still a file that needs a smudge filter, so leaving it out would
   * make the attributes coverage check pass on exactly the repositories where
   * being wrong is least recoverable.
   */
  listAnnexedFiles(repoRoot: string): Promise<string[]>;
  /** Is there unflushed journal state that a clone would not see? */
  hasUnflushedJournal(repoRoot: string): Promise<boolean>;
  /**
   * Verify annexed content against its keys, paced incrementally.
   *
   * Read-only, which is the property that makes it safe to schedule
   * independently of wakeup: a file added mid-run is simply fscked next cycle.
   * A lock would have been the wrong tool — it would serialize a multi-GB pass
   * against the box's main work loop to prevent a race that cannot corrupt
   * anything.
   */
  fsck(repoRoot: string, opts: { incrementalScheduleDays: number }): Promise<AnnexFsckReport>;
}

/** Outcome of an incremental fsck pass. */
export interface AnnexFsckReport {
  /** True when git-annex reported no bad content. */
  clean: boolean;
  /** Paths git-annex quarantined to .git/annex/bad/, if any. */
  badPaths: string[];
  /** Raw output, for the operator when something went wrong. */
  output: string;
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

    async listAnnexedFiles(repoRoot: string): Promise<string[]> {
      const out = await runAnnex(repoRoot, ["find", "--anything"]);
      return out === "" ? [] : out.split("\n");
    },

    async fsck(repoRoot: string, opts: { incrementalScheduleDays: number }): Promise<AnnexFsckReport> {
      // Exit code is the authority here, NOT message parsing.
      //
      // Verified against a repo with a deliberately corrupted object: the
      // failure detail goes to *stderr*, not stdout, and the wording changes
      // once the object is quarantined ("Bad file content" on the pass that
      // finds it, "No known copies exist" afterwards). A first implementation
      // grepped stdout for "Bad file content" and reported clean while
      // git-annex was actively quarantining corruption — a scheduled integrity
      // check that always passes is worse than none, because it manufactures
      // confidence.
      //
      // So: non-zero exit means something is wrong, full stop. The message
      // parsing below is best-effort enrichment for the operator, and its
      // failure can only cost detail, never the verdict.
      const args = ["fsck", `--incremental-schedule=${String(opts.incrementalScheduleDays)}d`];
      let output: string;
      let clean: boolean;
      try {
        const { stdout, stderr } = await execFileAsync("git", ["annex", ...args], {
          cwd: repoRoot,
          maxBuffer: 16 * 1024 * 1024,
        });
        output = `${stdout}${stderr}`;
        clean = true;
      } catch (e) {
        const stdout = isRecord(e) && typeof e["stdout"] === "string" ? e["stdout"] : "";
        const stderr = isRecord(e) && typeof e["stderr"] === "string" ? e["stderr"] : "";
        output = `${stdout}${stderr}` || String(e);
        clean = false;
      }
      const badPaths = output
        .split("\n")
        .filter((l) => l.includes("Bad file content") || l.includes("No known copies exist"))
        .map((l) => l.trim());
      return { clean, badPaths, output };
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
  /** Paths a scheduled fsck should report as corrupt. */
  fsckBadPaths?: string[];
  /** Paths `listAnnexedFiles` should report as annexed. */
  annexedFiles?: string[];
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
  const fsckBadPaths = options?.fsckBadPaths ?? [];
  const annexedFiles = options?.annexedFiles ?? [];
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
    async listAnnexedFiles() {
      return annexedFiles;
    },
    async hasUnflushedJournal() {
      return unflushedJournal;
    },
    async fsck(_repoRoot: string, opts: { incrementalScheduleDays: number }) {
      calls.push(`fsck:${String(opts.incrementalScheduleDays)}d`);
      return { clean: fsckBadPaths.length === 0, badPaths: fsckBadPaths, output: "" };
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
