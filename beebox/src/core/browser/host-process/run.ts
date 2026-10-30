/**
 * The browser host process, `bbx engine browser-host` (docs/plans/shared-browser.md,
 * Track B): it runs the agent-browser dashboard for one box and the relay
 * socket in front of it, and stops both when told to.
 *
 * The engine starts one per box (`../host/start.ts`), on a unit host inside the box's
 * private network namespace. agent-browser starts its daemon on first use
 * from whichever process asks; running the dashboard here is what makes
 * every daemon and Chrome for this box start inside that namespace.
 *
 * `dashboard start` detaches, and so does the daemon it starts, so killing
 * this process's group does not reach them. A crashed host therefore leaves
 * them behind, and the next host clears them before it starts (`clearStale`).
 * Whether Chrome dies with a force-killed daemon is not established upstream,
 * so the clearing also kills any process whose command line names this box's
 * profile directory.
 */

import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import net from "node:net";
import * as path from "node:path";
import { promisify } from "node:util";
import { freePort } from "../../../lib/free-port.js";
import { onUnitHost } from "../../../lib/unit-host.js";
import { errnoCode, errorMessage } from "../../../shared/error-guards.js";
import { dashboardEnv, runAgentBrowser } from "./agent-browser.js";
import { resolveBrowserExecutable } from "../install.js";
import { BOX_BROWSER_SESSION, browserPaths, type BrowserBox, type BrowserPaths } from "../paths.js";
import { startRelay } from "./relay.js";

const execFileAsync = promisify(execFile);

/** The dashboard's port inside a private namespace, where nothing else listens. */
const NAMESPACE_DASHBOARD_PORT = 4848;
const DASHBOARD_READY_MS = 10_000;
const KILL_GRACE_MS = 2000;
const PARENT_POLL_MS = 2000;

export class BrowserHostStartError extends Error {
  override name = "BrowserHostStartError";
  constructor(readonly what: { readonly step: "not-installed" | "dashboard-start" | "dashboard-port"; readonly detail: string }) {
    super(`The box browser host could not start (${what.step}): ${what.detail}`);
  }
}

function log(line: string): void {
  process.stderr.write(`[browser-host ${new Date().toISOString()}] ${line}\n`);
}

async function prepareDirectories(paths: BrowserPaths, boxRoot: string): Promise<void> {
  for (const dir of [paths.root, paths.profile, paths.socketDir, paths.downloads]) {
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    await fs.chmod(dir, 0o700);
  }
  await fs.mkdir(path.join(boxRoot, "_tmp", "browser"), { recursive: true });
  await fs.writeFile(paths.config, "{}\n", { mode: 0o600 });
}

export async function processTable(): Promise<{ pid: number; command: string }[]> {
  const { stdout } = await execFileAsync("ps", ["-axww", "-o", "pid=,command="], { maxBuffer: 16 * 1024 * 1024 });
  return stdout.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line);
    return match?.[1] === undefined || match[2] === undefined ? [] : [{ pid: Number(match[1]), command: match[2] }];
  });
}

/** Pids whose command line names `dir` as a whole path (followed by `/`, a space, or the end). */
export function pidsNaming(rows: readonly { pid: number; command: string }[], dir: string): number[] {
  return rows.filter((row) => row.command.split(dir).slice(1).some((after) => after === "" || /^[\s/]/.test(after))).map((row) => row.pid);
}

function signalPids(pids: readonly number[], sig: NodeJS.Signals): void {
  for (const pid of pids) {
    try {
      process.kill(pid, sig);
    } catch (e) {
      // ESRCH: it exited between the process table and here, which is the goal.
      if (errnoCode(e) !== "ESRCH") throw e;
    }
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return false;
    throw e;
  }
}

/**
 * Clear what a crashed host left: the detached dashboard, the session daemon,
 * and any Chrome still holding the profile. The stop commands run only when
 * their pid file exists, because `close` with no daemon starts one.
 */
async function clearStale(paths: BrowserPaths, env: Record<string, string>): Promise<void> {
  const steps: [string, string[]][] = [
    ["dashboard.pid", ["dashboard", "stop"]],
    [`${BOX_BROWSER_SESSION}.pid`, ["--session", BOX_BROWSER_SESSION, "close"]],
  ];
  for (const [pidFile, args] of steps) {
    if (!(await exists(path.join(paths.socketDir, pidFile)))) continue;
    const result = await runAgentBrowser(args, { env, cwd: paths.root });
    log(`stale cleanup: agent-browser ${args.join(" ")} -> ${String(result.code)} ${result.output}`);
  }
  const holders = pidsNaming(await processTable(), paths.profile);
  if (holders.length === 0) return;
  log(`stale cleanup: killing ${String(holders.length)} processes using ${paths.profile}`);
  signalPids(holders, "SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, KILL_GRACE_MS));
  signalPids(pidsNaming(await processTable(), paths.profile), "SIGKILL");
}

async function waitForPort(port: number): Promise<boolean> {
  const deadline = Date.now() + DASHBOARD_READY_MS;
  while (Date.now() < deadline) {
    const open = await new Promise<boolean>((resolve) => {
      const socket = net.connect({ host: "127.0.0.1", port });
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => resolve(false));
    });
    if (open) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

/** Stop the session and the dashboard; each step is logged and never throws. */
async function stopBrowser(paths: BrowserPaths, env: Record<string, string>): Promise<void> {
  for (const args of [["--session", BOX_BROWSER_SESSION, "close"], ["dashboard", "stop"]]) {
    const result = await runAgentBrowser(args, { env, cwd: paths.root });
    log(`stop: agent-browser ${args.join(" ")} -> ${String(result.code)} ${result.output}`);
  }
}

/** Resolves with the reason once SIGTERM or SIGINT arrives or the engine is gone. */
function untilStopped(): Promise<string> {
  const parent = process.ppid;
  return new Promise((resolve) => {
    const done = (why: string): void => {
      clearInterval(watch);
      resolve(why);
    };
    process.once("SIGTERM", () => done("SIGTERM"));
    process.once("SIGINT", () => done("SIGINT"));
    // A SIGKILLed engine sends nothing; the host notices it was reparented.
    const watch = setInterval(() => {
      if (process.ppid !== parent) done("the engine exited");
    }, PARENT_POLL_MS);
  });
}

/** Run the host until SIGTERM, SIGINT, or the engine that started it goes away. */
export async function runBrowserHost(box: BrowserBox): Promise<void> {
  const paths = browserPaths(box);
  const executable = resolveBrowserExecutable();
  if (!executable.ok) throw new BrowserHostStartError({ step: "not-installed", detail: executable.reason });
  await prepareDirectories(paths, box.boxRoot);
  const env = dashboardEnv({
    paths, boxRoot: box.boxRoot, executablePath: executable.executablePath,
    home: process.env.HOME ?? "", pathVar: process.env.PATH ?? "",
  });
  await clearStale(paths, env);

  const port = onUnitHost() ? NAMESPACE_DASHBOARD_PORT : await freePort();
  const started = await runAgentBrowser(["dashboard", "start", "--port", String(port)], { env, cwd: paths.root });
  log(`agent-browser dashboard start --port ${String(port)} -> ${String(started.code)} ${started.output}`);
  if (started.code !== 0) throw new BrowserHostStartError({ step: "dashboard-start", detail: started.output });
  if (!(await waitForPort(port))) {
    await stopBrowser(paths, env);
    throw new BrowserHostStartError({ step: "dashboard-port", detail: `nothing listens on 127.0.0.1:${String(port)}` });
  }
  const relay = await startRelay({ socketPath: paths.relaySocket, port });
  log(`relay ${paths.relaySocket} -> 127.0.0.1:${String(port)}`);

  log(`stopping: ${await untilStopped()}`);
  try {
    await stopBrowser(paths, env);
  } catch (e) {
    log(`stop failed: ${errorMessage(e)}`);
  }
  await relay.close();
}
