/**
 * `pnpm perf:hub <up|down|status|cold>` — runs the local production-shaped hub
 * that `pnpm perf:load` measures. See `local-hub.ts` for what it isolates and
 * `docs/development/performance.md` for the workflow.
 */
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { existsSync, openSync, statSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { PACKAGE_ROOT } from "../../../lib/package-root.js";
import { startEdgeProxy } from "./edge-proxy.js";
import { seedChat } from "./seed-chat.js";
import {
  DEFAULT_HUB_PORT, PERF_DIAG_KEY, bbxBin, defaultPerfBox, perfHubEnv, perfHubPaths, readDaemonPid,
  makeBoxCold, readPerfHubConfig, waitForGeneration, waitForHttp, writePerfHubConfig, type PerfHubConfig,
} from "../local-hub.js";

/** Reports a usage or setup problem the developer must act on, and exits. */
function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

// --- daemon (internal): owns the hub child and the edge proxy ---

function startHubChild(): ChildProcess {
  const log = openSync(perfHubPaths.hubLog(), "a");
  return spawn(bbxBin(), ["engine", "hub", "--config", perfHubPaths.hubJson()], { env: perfHubEnv(), stdio: ["ignore", log, log] });
}

async function stopHubChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 15_000);
  await exited;
  clearTimeout(timer);
}

async function runDaemon(): Promise<void> {
  const config = await readPerfHubConfig();
  if (!config) return fail("perf hub daemon: no perf-hub.json; start it with `pnpm perf:hub up`");
  await fs.writeFile(perfHubPaths.pid(), String(process.pid));
  const proxy = await startEdgeProxy({ listenPort: config.edgePort, targetPort: config.hubPort });
  let hub = startHubChild();
  let generation = 0;
  const hubUp = async (): Promise<void> => {
    await waitForHttp(`http://127.0.0.1:${config.hubPort}/healthz`, 60_000);
    generation += 1;
    await fs.writeFile(perfHubPaths.generation(), String(generation));
  };
  await hubUp();
  let busy = Promise.resolve();
  // SIGUSR2 = `cold`: restart the hub so the (lazy) box is stopped again.
  process.on("SIGUSR2", () => {
    busy = busy.then(async () => {
      await stopHubChild(hub);
      hub = startHubChild();
      await hubUp();
    }).catch((e: unknown) => console.error("perf hub: restart failed", e));
  });
  process.on("SIGTERM", () => {
    void busy.then(async () => {
      await stopHubChild(hub);
      proxy.close();
      await fs.rm(perfHubPaths.pid(), { force: true });
      process.exit(0);
    });
  });
}

// --- user commands ---

function refreshCliBundle(): void {
  // Without BBX_CLI_PREBUILT, bin/bbx rebuilds dist/cli.mjs when any backend source is newer.
  const env = { ...process.env };
  delete env["BBX_CLI_PREBUILT"];
  execFileSync(bbxBin(), ["--version"], { env, stdio: "ignore" });
}

function describeBuilds(): string {
  const index = path.join(PACKAGE_ROOT, "src", "frontend", "dist", "index.html");
  if (!existsSync(index)) {
    fail("perf hub: no built frontend (src/frontend/dist/index.html). Run `pnpm build:frontend`, or `cd src/frontend && npx vite build` to skip its typecheck.");
  }
  const cli = path.join(PACKAGE_ROOT, "dist", "cli.mjs");
  return `frontend dist built ${statSync(index).mtime.toISOString()}, cli bundle built ${statSync(cli).mtime.toISOString()}`;
}

async function up(values: { box?: string; port?: string }): Promise<void> {
  const box = values.box ?? defaultPerfBox();
  if (box === undefined) fail("perf hub: no worktree test box clone found; pass --box <path> (a box the dev router is not serving: see the docs)");
  const hubPort = values.port === undefined ? DEFAULT_HUB_PORT : Number(values.port);
  const config: PerfHubConfig = { box: path.resolve(box), slug: path.basename(box), hubPort, edgePort: hubPort + 1 };
  const running = await readDaemonPid();
  const current = await readPerfHubConfig();
  if (running !== undefined) {
    if (JSON.stringify(current) === JSON.stringify(config)) {
      console.log("perf hub already running");
      return status();
    }
    fail("perf hub is running with a different config; run `pnpm perf:hub down` first");
  }
  refreshCliBundle();
  console.log(describeBuilds());
  await writePerfHubConfig(config);
  await fs.rm(perfHubPaths.generation(), { force: true });
  const log = openSync(perfHubPaths.daemonLog(), "a");
  const daemon = spawn(process.execPath, ["--import", "tsx", import.meta.filename, "daemon"], { cwd: PACKAGE_ROOT, detached: true, stdio: ["ignore", log, log] });
  daemon.unref();
  await waitForGeneration(1);
  await waitForHttp(`http://127.0.0.1:${config.edgePort}/healthz`, 10_000);
  await status();
}

async function down(): Promise<void> {
  const pid = await readDaemonPid();
  if (pid === undefined) return console.log("perf hub is not running");
  process.kill(pid, "SIGTERM");
  while ((await readDaemonPid()) !== undefined) await new Promise((r) => setTimeout(r, 100));
  console.log("perf hub stopped");
}

const healthSchema = z.object({ boxes: z.array(z.object({ slug: z.string(), status: z.string(), lastStart: z.unknown().optional() }).passthrough()) }).passthrough();

async function status(): Promise<void> {
  const config = await readPerfHubConfig();
  const pid = await readDaemonPid();
  if (!config || pid === undefined) return console.log("perf hub is not running");
  const res = await fetch(`http://127.0.0.1:${config.hubPort}/healthz`, { headers: { authorization: `Bearer ${PERF_DIAG_KEY}` } });
  const health = healthSchema.parse(await res.json());
  console.log(`perf hub (pid ${pid}) box ${config.box}`);
  console.log(`  measure:  http://127.0.0.1:${config.edgePort}/${config.slug}/   (edge stand-in, compressed)`);
  console.log(`  raw hub:  http://127.0.0.1:${config.hubPort}/${config.slug}/`);
  for (const box of health.boxes) console.log(`  box ${box.slug}: ${box.status}${box.lastStart === undefined ? "" : ` lastStart=${JSON.stringify(box.lastStart)}`}`);
  console.log(`  logs: ${perfHubPaths.daemonLog()} ${perfHubPaths.hubLog()}`);
}

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: { box: { type: "string" }, port: { type: "string" }, turns: { type: "string", default: "40" } } });
  const command = positionals[0];
  if (command === "daemon") return runDaemon();
  if (command === "up") return up(values);
  if (command === "down") return down();
  if (command === "status") return status();
  if (command === "seed-chat") {
    const config = await readPerfHubConfig();
    const box = values.box ?? config?.box ?? defaultPerfBox() ?? fail("no box: pass --box <path>");
    const id = await seedChat(path.resolve(box), Number(values.turns));
    // A running box keeps its session list in memory; restart it to pick up the new conversation.
    if ((await readDaemonPid()) !== undefined) await makeBoxCold();
    return console.log(`seeded conversation ${id} (${values.turns} turns) in ${box}; it is now the box's latest conversation`);
  }
  if (command === "cold") {
    await makeBoxCold();
    return console.log("perf hub restarted; the box is stopped");
  }
  fail("usage: pnpm perf:hub <up [--box <path>] [--port <n>] | down | status | cold | seed-chat [--turns <n>]>");
}

if (process.argv[1] === import.meta.filename) {
  main().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
