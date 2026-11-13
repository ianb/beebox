// Building a release from the stage; see cli.ts.
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { PREVIOUS, ReleaseRefusedError, pruneReleases, releasesInUse, type Layout } from "./layout.ts";

const HISTORY_LIMIT = 20;

class InstallFailedError extends Error {
  constructor(release: string, status: string) {
    super(`dependency install failed in ${release} (${status})`);
    this.name = "InstallFailedError";
  }
}

export interface InstallOptions {
  /** The command and its arguments, run in the new release. */
  command: [string, ...string[]];
  /** Waits before each retry of an install the kernel killed (exit 137 or SIGKILL). */
  retryDelaysMs: number[];
}

export const PNPM_INSTALL: InstallOptions = {
  command: ["pnpm", "install", "--frozen-lockfile"],
  // Box sessions compete for memory on a small host; an OOM kill is usually
  // transient (issues/closed/bugs/2026-07-11-deploy-pnpm-install-oom-killed.md).
  retryDelaysMs: [60_000, 180_000],
};

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function install(release: string, options: InstallOptions): void {
  const [command, ...args] = options.command;
  // HUSKY=0: no hooks to install. CI=true: pnpm aborts without a TTY when it
  // decides to recreate a modules dir. The update banner is noise in a log.
  const env = { ...process.env, HUSKY: "0", CI: "true", npm_config_update_notifier: "false" };
  for (let attempt = 0; ; attempt++) {
    const result = spawnSync(command, args, { cwd: release, env, stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status === 0) return;
    const killed = result.status === 137 || result.signal === "SIGKILL";
    const status = result.signal ?? `exit ${String(result.status)}`;
    const delay = options.retryDelaysMs[attempt];
    if (!killed || delay === undefined) throw new InstallFailedError(release, status);
    console.error(`  install killed (${status}, attempt ${String(attempt + 1)}); retrying in ${String(delay / 1000)}s...`);
    sleepSync(delay);
  }
}

export const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function carryHistory(layout: Layout, release: string): void {
  const infoPath = path.join(release, "beebox", "deploy-info.json");
  const info: unknown = fs.existsSync(infoPath) ? JSON.parse(fs.readFileSync(infoPath, "utf8")) : null;
  if (!isPlainObject(info)) throw new ReleaseRefusedError({ kind: "deploy-info", file: infoPath });
  const livePath = path.join(layout.installDir, "beebox", "deploy-history.json");
  let history: unknown[] = [];
  if (fs.existsSync(livePath)) {
    const parsed: unknown = JSON.parse(fs.readFileSync(livePath, "utf8"));
    if (Array.isArray(parsed)) history = parsed;
    else console.error(`  ${livePath} is not a list; starting a new history`);
  }
  fs.writeFileSync(path.join(release, "beebox", "deploy-history.json"), JSON.stringify([info, ...history].slice(0, HISTORY_LIMIT), null, 2));
}

export interface PrepareOptions {
  stage: string;
  name: string;
  /** Top-level entries of the stage that make up a release. */
  members: string[];
  install: InstallOptions;
}

/** Build a new release from the stage and install its dependencies. Returns its path. */
export function prepareRelease(layout: Layout, options: PrepareOptions): string {
  if (!/^[\dA-Za-z][\w.-]*$/.test(options.name) || options.name === PREVIOUS || options.name.startsWith("legacy-")) {
    throw new ReleaseRefusedError({ kind: "invalid-name", name: options.name });
  }
  if (options.members.length === 0) throw new ReleaseRefusedError({ kind: "usage", command: "prepare" });
  fs.mkdirSync(layout.releasesDir, { recursive: true, mode: 0o755 });
  for (const name of pruneReleases(layout, releasesInUse(layout))) console.log(`  pruned release ${name}`);
  const release = path.join(layout.releasesDir, options.name);
  if (fs.existsSync(release)) throw new ReleaseRefusedError({ kind: "release-exists", release });
  fs.mkdirSync(release, { mode: 0o755 });
  for (const member of options.members) {
    const source = path.join(options.stage, member);
    if (member.includes("/") || !fs.existsSync(source)) throw new ReleaseRefusedError({ kind: "missing-member", source });
    // node_modules never ships; a stage install from an older deploy left some.
    fs.cpSync(source, path.join(release, member), {
      recursive: true, verbatimSymlinks: true, preserveTimestamps: true,
      filter: (src) => path.basename(src) !== "node_modules",
    });
  }
  carryHistory(layout, release);
  install(release, options.install);
  return release;
}
