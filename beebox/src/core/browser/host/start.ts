/**
 * Starting, finding and stopping the browser host for a box, from the engine
 * (docs/plans/shared-browser.md, Track B).
 *
 * The engine owns the host so that the agent never starts agent-browser
 * itself: whichever process runs agent-browser first starts its daemon and
 * Chrome, and on a unit host that must happen inside the box's private
 * network namespace (`namespace.ts`). There is at most one host per box per
 * engine process; it lives until the engine exits (`stopBrowserHosts`, called
 * from the engine's shutdown sequence). Chrome itself idles out through the
 * daemon's own timeout.
 *
 * The host runs in its own process group so one signal reaches all of it.
 * Its output goes to the box's `host.log`, truncated at each start, so a
 * failed start can show the person the lines that explain it.
 */

import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import * as fs from "node:fs";
import net from "node:net";
import * as path from "node:path";
import { PACKAGE_ROOT } from "../../../lib/package-root.js";
import { BBX_STATE_DIR } from "../../../lib/state-dir.js";
import { onUnitHost } from "../../../lib/unit-host.js";
import { errnoCode } from "../../../shared/error-guards.js";
import { resolveBrowserExecutable } from "../install.js";
import { spawnInNamespace } from "./namespace.js";
import { browserPaths, type BrowserPaths } from "../paths.js";

const READY_TIMEOUT_MS = 20_000;
const READY_POLL_MS = 100;
const STOP_GRACE_MS = 5000;
const LOG_TAIL_LINES = 40;

/** No browser to run: the reason says why, for the page and `bbx browser`. */
export class BrowserNotInstalledError extends Error {
  override name = "BrowserNotInstalledError";
  constructor(readonly reason: string) {
    super(`This box has no browser installed: ${reason}`);
  }
}

/** The host did not come up; `logTail` is the end of its log. */
export class BrowserHostFailedError extends Error {
  override name = "BrowserHostFailedError";
  constructor(readonly what: { readonly why: string; readonly logTail: string }) {
    super(`The box browser did not start (${what.why}). Last lines of its log:\n${what.logTail}`);
  }
}

export interface BrowserHostHandle {
  readonly paths: BrowserPaths;
  /** The host's pid, which is also its process group. */
  readonly pid: number;
}

export interface EnsureBrowserHostInput {
  readonly boxRoot: string;
  readonly slug: string;
  /** Defaults to `BBX_STATE_DIR`; a test passes a short temporary one. */
  readonly stateDir?: string;
}

interface RunningHost {
  readonly handle: BrowserHostHandle;
  readonly child: ChildProcess;
  readonly exited: Promise<void>;
}

/** Keyed by box root. A pending start is shared, so concurrent callers start one host. */
const hosts = new Map<string, Promise<RunningHost>>();

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

/** The last `LOG_TAIL_LINES` lines of the host log. */
export function logTail(logFile: string): string {
  try {
    return fs.readFileSync(logFile, "utf8").trimEnd().split("\n").slice(-LOG_TAIL_LINES).join("\n");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return "(no log written)";
    throw e;
  }
}

function connects(socketPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(socketPath);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

function killGroup(pid: number, sig: NodeJS.Signals): void {
  try {
    process.kill(-pid, sig);
  } catch (e) {
    // ESRCH: the whole group has already exited.
    if (errnoCode(e) !== "ESRCH") throw e;
  }
}

async function spawnHost(paths: BrowserPaths, input: Required<EnsureBrowserHostInput>): Promise<ChildProcess> {
  await fs.promises.mkdir(paths.root, { recursive: true, mode: 0o700 });
  // A host left by a previous engine (a restart, a reload) may still be
  // listening on these paths until it notices and exits. Unlinked, its
  // sockets are unreachable, so the readiness check below can only connect
  // to the new host (seen in the dev smoke run, 2026-10-30: the first
  // request after an engine reload reached the old host as it exited).
  await fs.promises.rm(paths.relaySocket, { force: true });
  await fs.promises.rm(paths.cliSocket, { force: true });
  const logFd = fs.openSync(paths.log, "w", 0o600);
  try {
    const command = [
      path.join(PACKAGE_ROOT, "bin", "bbx"),
      "engine", "browser-host", "--box", input.boxRoot, "--slug", input.slug, "--state-dir", input.stateDir,
    ];
    const options: SpawnOptions = { cwd: input.boxRoot, env: process.env, detached: true, stdio: ["ignore", logFd, logFd] };
    if (onUnitHost()) return await spawnInNamespace(command, options);
    return spawn(command[0] ?? "bbx", command.slice(1), options);
  } finally {
    fs.closeSync(logFd);
  }
}

async function startHost(input: Required<EnsureBrowserHostInput>): Promise<RunningHost> {
  const paths = browserPaths(input);
  const child = await spawnHost(paths, input);
  const pid = child.pid;
  const exited = new Promise<void>((resolve) => {
    if (hasExited(child)) resolve();
    child.once("exit", () => resolve());
  });
  // A failed spawn (ENOENT on bbx) arrives as an event; the exit check below reports it.
  child.once("error", (e) => console.error(`Box browser host for ${input.boxRoot} failed to spawn:`, e));
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (pid !== undefined && !hasExited(child) && Date.now() < deadline) {
    if (await connects(paths.relaySocket)) return { handle: { paths, pid }, child, exited };
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
  }
  const why = pid === undefined || hasExited(child) ? `the host exited (${String(child.exitCode ?? child.signalCode)})` : `no relay after ${String(READY_TIMEOUT_MS / 1000)} s`;
  if (pid !== undefined && !hasExited(child)) await stopHost({ handle: { paths, pid }, child, exited });
  throw new BrowserHostFailedError({ why, logTail: logTail(paths.log) });
}

/**
 * The running browser host for a box, started if there is none. Throws
 * `BrowserNotInstalledError` when no browser resolves and
 * `BrowserHostFailedError` when the host does not come up within 20 s.
 */
export async function ensureBrowserHost(input: EnsureBrowserHostInput): Promise<BrowserHostHandle> {
  const executable = resolveBrowserExecutable();
  if (!executable.ok) throw new BrowserNotInstalledError(executable.reason);
  const key = path.resolve(input.boxRoot);
  const existing = hosts.get(key);
  if (existing !== undefined) {
    let running: RunningHost | null = null;
    try {
      running = await existing;
    } catch (_e) {
      // That start's error went to the caller that began it; this call starts again.
    }
    if (running !== null && !hasExited(running.child)) return running.handle;
    // The previous start failed or the host died: forget it and start again.
    if (hosts.get(key) === existing) hosts.delete(key);
    return ensureBrowserHost(input);
  }
  const starting = startHost({ boxRoot: key, slug: input.slug, stateDir: input.stateDir ?? BBX_STATE_DIR });
  hosts.set(key, starting);
  try {
    return (await starting).handle;
  } catch (e) {
    if (hosts.get(key) === starting) hosts.delete(key);
    throw e;
  }
}

/** SIGTERM the host's group, then SIGKILL it if it has not exited after 5 s. */
async function stopHost(host: RunningHost): Promise<void> {
  if (hasExited(host.child)) return;
  killGroup(host.handle.pid, "SIGTERM");
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(true), STOP_GRACE_MS);
  });
  const late = await Promise.race([host.exited.then(() => false), timedOut]);
  clearTimeout(timer);
  if (late) {
    console.warn(`Box browser host ${String(host.handle.pid)} did not stop within ${String(STOP_GRACE_MS)} ms; killing it.`);
    killGroup(host.handle.pid, "SIGKILL");
    await host.exited;
  }
}

/** Stop every browser host this engine started. Called from the engine's shutdown. */
export async function stopBrowserHosts(): Promise<void> {
  const pending = [...hosts.values()];
  hosts.clear();
  const results = await Promise.allSettled(pending.map(async (starting) => stopHost(await starting)));
  for (const result of results) {
    // A start that failed has nothing to stop; its error was already thrown to its caller.
    if (result.status === "rejected" && !(result.reason instanceof BrowserHostFailedError)) {
      console.error("Stopping a box browser host failed:", result.reason);
    }
  }
}
