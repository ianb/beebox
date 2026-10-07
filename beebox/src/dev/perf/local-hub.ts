/**
 * The local production-shaped hub the page-load harness measures.
 *
 * Production serves the built bundles (`dist/cli.mjs`, `src/frontend/dist/`)
 * through a lazy `bbx engine hub` behind a compressing edge. The dev router
 * serves Vite instead, so its load timings say little about production. This
 * module runs the production shape locally: a detached daemon process
 * (`hub/cli.ts daemon`) owns a lazy hub on `hubPort` and the edge stand-in
 * (`hub/edge-proxy.ts`) on `edgePort`. Restarting the hub (`cold`) leaves the box
 * stopped, so the next page load pays the box's cold start.
 *
 * Isolation: the hub gets a fixed throwaway session secret, a nonexistent
 * auth file, and its own config/state directory, so it never reads or writes
 * the developer's real credentials. It binds 127.0.0.1 only.
 */
import * as crypto from "node:crypto";
import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { z } from "zod";
import { PACKAGE_ROOT } from "../../lib/package-root.js";

const PERF_SESSION_SECRET = "beebox-perf-local-session-secret";
const PERF_OWNER_EMAIL = "owner@example.com";
export const PERF_DIAG_KEY = "beebox-perf-local-diag-key";
export const DEFAULT_HUB_PORT = 3390;

/** The worktree's name: its checkout directory (`main` for the primary checkout's `beebox`). */
function worktreeName(): string {
  return path.basename(path.dirname(PACKAGE_ROOT));
}

export function perfStateDir(): string {
  return path.join(os.homedir(), ".cache", "beebox", "perf", worktreeName());
}

export function perfResultsDir(): string {
  return path.join(os.homedir(), ".cache", "beebox", "perf", "results");
}

/** The worktree's isolated test box clone, when it has one. */
export function defaultPerfBox(): string | undefined {
  const clone = path.join(os.homedir(), "src", "box-worktrees", worktreeName(), "test1");
  return existsSync(clone) ? clone : undefined;
}

export const perfHubConfigSchema = z.object({
  box: z.string(),
  slug: z.string(),
  hubPort: z.number().int(),
  edgePort: z.number().int(),
});
export type PerfHubConfig = z.infer<typeof perfHubConfigSchema>;

export const perfHubPaths = {
  config: (): string => path.join(perfStateDir(), "perf-hub.json"),
  hubJson: (): string => path.join(perfStateDir(), "hub.json"),
  pid: (): string => path.join(perfStateDir(), "daemon.pid"),
  generation: (): string => path.join(perfStateDir(), "generation"),
  daemonLog: (): string => path.join(perfStateDir(), "daemon.log"),
  hubLog: (): string => path.join(perfStateDir(), "hub.log"),
};

export async function readPerfHubConfig(): Promise<PerfHubConfig | undefined> {
  try {
    return perfHubConfigSchema.parse(JSON.parse(await fs.readFile(perfHubPaths.config(), "utf-8")));
  } catch (e) {
    if (e instanceof Error && "code" in e && e.code === "ENOENT") return undefined;
    throw e;
  }
}

export async function writePerfHubConfig(config: PerfHubConfig): Promise<void> {
  await fs.mkdir(perfStateDir(), { recursive: true });
  await fs.writeFile(perfHubPaths.config(), `${JSON.stringify(config, null, 2)}\n`);
  // The hub's own routing table (src/hub/config.ts). Lazy, like production.
  const hubJson = { port: config.hubPort, host: "127.0.0.1", lazy: true, boxes: { [config.slug]: { path: config.box } } };
  await fs.writeFile(perfHubPaths.hubJson(), `${JSON.stringify(hubJson, null, 2)}\n`);
}

/** The environment the perf hub runs with: throwaway secrets, no real auth store. */
export function perfHubEnv(): NodeJS.ProcessEnv {
  return {
    PATH: process.env["PATH"],
    HOME: process.env["HOME"],
    BBX_SESSION_SECRET: PERF_SESSION_SECRET,
    BBX_OWNER_EMAIL: PERF_OWNER_EMAIL,
    BBX_AUTH_FILE: path.join(perfStateDir(), "no-auth-file.json"),
    BBX_DIAG_API_KEY: PERF_DIAG_KEY,
    // Production runs the bundle without a staleness scan; `up` refreshes it first.
    BBX_CLI_PREBUILT: "1",
  };
}

/**
 * A session cookie value the perf hub accepts for its owner. Minted with the
 * same HMAC format as `src/webapp/auth.ts`'s `signSession` (and
 * `deploy/prod-browse`), but from the fixed perf secret only, so this can
 * never pick up the developer's real `~/.bbx-session-secret`. A format drift
 * shows up as a login redirect, which the harness reports.
 */
export function perfSessionCookie(): string {
  const payload = JSON.stringify({ email: PERF_OWNER_EMAIL, name: "Perf Owner", exp: Date.now() + 24 * 60 * 60 * 1000 });
  const sig = crypto.createHmac("sha256", PERF_SESSION_SECRET).update(payload).digest("hex");
  return `${Buffer.from(payload).toString("base64url")}.${sig}`;
}

export function bbxBin(): string {
  return path.join(PACKAGE_ROOT, "bin", "bbx");
}

export async function readDaemonPid(): Promise<number | undefined> {
  try {
    const pid = Number((await fs.readFile(perfHubPaths.pid(), "utf-8")).trim());
    process.kill(pid, 0);
    return pid;
  } catch (e) {
    if (e instanceof Error && "code" in e && (e.code === "ENOENT" || e.code === "ESRCH")) return undefined;
    throw e;
  }
}

export async function readGeneration(): Promise<number> {
  try {
    return Number((await fs.readFile(perfHubPaths.generation(), "utf-8")).trim());
  } catch (e) {
    if (e instanceof Error && "code" in e && e.code === "ENOENT") return 0;
    throw e;
  }
}

/** Polls `url` until it answers with any HTTP status, or throws after `timeoutMs`. */
export async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(url, { signal: AbortSignal.timeout(1000) });
      return;
    } catch (_e) {
      /* ignore: not listening yet; retry until the deadline */
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new PerfHubTimeoutError(url);
}

class PerfHubTimeoutError extends Error {
  constructor(url: string) {
    super(`perf hub: ${url} did not answer in time; see ${perfHubPaths.daemonLog()} and ${perfHubPaths.hubLog()}`);
    this.name = "PerfHubTimeoutError";
  }
}

class PerfHubNotRunningError extends Error {
  constructor() {
    super("perf hub is not running; run `pnpm perf:hub up`");
    this.name = "PerfHubNotRunningError";
  }
}

class PerfHubStartError extends Error {
  constructor() {
    super(`perf hub did not come up; see ${perfHubPaths.daemonLog()} and ${perfHubPaths.hubLog()}`);
    this.name = "PerfHubStartError";
  }
}

/** Waits until the daemon has brought the hub up `atLeast` times. */
export async function waitForGeneration(atLeast: number): Promise<void> {
  const deadline = Date.now() + 60_000;
  while ((await readGeneration()) < atLeast) {
    if (Date.now() > deadline) throw new PerfHubStartError();
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** Restarts the hub; the box is stopped until the next request cold-starts it. */
export async function makeBoxCold(): Promise<void> {
  const pid = await readDaemonPid();
  if (pid === undefined) throw new PerfHubNotRunningError();
  const before = await readGeneration();
  process.kill(pid, "SIGUSR2");
  await waitForGeneration(before + 1);
}
