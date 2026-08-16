// Resident workstreams-app lifecycle owned by the dependency-light dev router.
//
// This is deliberately separate from the lazy per-worktree lifecycle in
// router-core.ts. The workstreams app is one always-on main-checkout service,
// has its own capability boundary, and restarts only when its own backend
// sources change. It must not inherit the per-worktree idle protocol or mutate
// the agent-facing bin/workstreams command.

import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import { watch as watchFs, type FSWatcher } from "node:fs";
import http from "node:http";
import path from "node:path";
import { execa } from "execa";
import getPort from "get-port";
import { createPidStore, type PidStore } from "./router-pidfile.js";

export const WORKSTREAMS_APP_CAPABILITY_HEADER = "x-cb-workstreams-capability";
export const WORKSTREAMS_APP_BASE_PATH = "/workstreams";

// The exhibits surface is a SECOND listener in the same supervised process
// group, on its own origin (docs/plans/workstream-exhibits.md, Track B). The
// router never proxies it: exhibit URLs are direct, which is exactly why the
// supervisor holds the port itself while the child is down — the router's
// /workstreams/* fallback cannot help a direct-origin URL.
export const EXHIBITS_DEFAULT_PORT = 3230;

export type WorkstreamsAppPhase = "starting" | "ready" | "restarting" | "failed" | "stopped";

export type WorkstreamsAppState =
  | { phase: "starting"; changedAt: number }
  | {
      phase: "ready";
      changedAt: number;
      backendPort: number;
      frontendPort: number;
      buildId: string;
      activeJobs: number;
      restartPending: boolean;
    }
  | { phase: "restarting"; changedAt: number; reason: string }
  | { phase: "failed"; changedAt: number; message: string }
  | { phase: "stopped"; changedAt: number };

export interface WorkstreamsAppHealth {
  status: "ready";
  activeJobs: number;
  buildId: string;
}

export interface WorkstreamsAppTarget {
  port: number;
  capability: string;
  kind: "backend" | "frontend";
}

export interface WorkstreamsAppChild {
  pid: number | undefined;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  onExit(listener: (exit: { code: number | null; signal: NodeJS.Signals | null }) => void): void;
}

export interface WorkstreamsAppWatch {
  close(): void;
}

export interface WorkstreamsAppTimer {
  cancel(): void;
}

export interface WorkstreamsAppSpawnOptions {
  appRoot: string;
  backendPort: number;
  frontendPort: number;
  exhibitsPort: number;
  exhibitsToken: string;
  capability: string;
  buildId: string;
  logPath: string;
}

/** The supervisor's claim on the exhibits port while no child owns it. */
export interface ExhibitsPortHold {
  release(): Promise<void>;
}

export interface WorkstreamsAppGenerationRecord {
  backendPid: number | undefined;
  frontendPid: number | undefined;
  backendPort: number;
  frontendPort: number;
  startedAt: number;
}

export interface WorkstreamsAppEffects {
  now(): number;
  prepare(logPath: string): Promise<void>;
  getPort(): Promise<number>;
  randomCapability(): string;
  randomBuildId(): string;
  spawnBackend(options: WorkstreamsAppSpawnOptions): WorkstreamsAppChild;
  spawnFrontend(options: WorkstreamsAppSpawnOptions): WorkstreamsAppChild;
  stopChildren(children: WorkstreamsAppChild[], graceMs: number): Promise<void>;
  waitUntilReady(options: {
    backendPort: number;
    frontendPort: number;
    capability: string;
    timeoutMs: number;
  }): Promise<WorkstreamsAppHealth>;
  readHealth(backendPort: number, capability: string): Promise<WorkstreamsAppHealth>;
  fingerprint(appRoot: string): Promise<string>;
  watch(appRoot: string, onChange: (relativePath: string | null) => void, onError: (error: Error) => void): WorkstreamsAppWatch;
  setTimer(ms: number, callback: () => void): WorkstreamsAppTimer;
  setInterval(ms: number, callback: () => void): WorkstreamsAppTimer;
  /** Mint-once, persist: the exhibits token survives app restarts. */
  exhibitsToken(): Promise<string>;
  holdExhibitsPort(options: { port: number; render: () => string }): Promise<ExhibitsPortHold>;
  recordGeneration(record: WorkstreamsAppGenerationRecord): Promise<void>;
  removeGeneration(record?: WorkstreamsAppGenerationRecord): Promise<void>;
}

export interface WorkstreamsAppSupervisorConfig {
  appRoot: string;
  logPath: string;
  log: (message: string) => void;
  exhibitsPort?: number;
  startupTimeoutMs?: number;
  quietMs?: number;
  reconcileMs?: number;
  activeJobPollMs?: number;
  killGraceMs?: number;
}

interface Generation extends WorkstreamsAppGenerationRecord {
  id: number;
  capability: string;
  backend: WorkstreamsAppChild;
  frontend: WorkstreamsAppChild;
  intentionalStop: boolean;
}

export interface WorkstreamsAppSupervisor {
  start(): Promise<void>;
  retry(): Promise<void>;
  requestRestart(reason: string): void;
  state(): WorkstreamsAppState;
  targetFor(url: string): WorkstreamsAppTarget | null;
  shutdown(): Promise<void>;
}

const DEFAULT_STARTUP_TIMEOUT_MS = 30_000;
const DEFAULT_QUIET_MS = 1_000;
const DEFAULT_RECONCILE_MS = 30_000;
const DEFAULT_ACTIVE_JOB_POLL_MS = 1_000;
const DEFAULT_KILL_GRACE_MS = 2_000;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isBackendUrl(url: string): boolean {
  const pathname = url.split("?")[0] ?? url;
  return pathname === `${WORKSTREAMS_APP_BASE_PATH}/api` ||
    pathname.startsWith(`${WORKSTREAMS_APP_BASE_PATH}/api/`) ||
    pathname === `${WORKSTREAMS_APP_BASE_PATH}/__internal` ||
    pathname.startsWith(`${WORKSTREAMS_APP_BASE_PATH}/__internal/`);
}

function readyState(
  effects: WorkstreamsAppEffects,
  generation: Generation,
  health: WorkstreamsAppHealth,
  restartPending: boolean,
): WorkstreamsAppState {
  return {
    phase: "ready",
    changedAt: effects.now(),
    backendPort: generation.backendPort,
    frontendPort: generation.frontendPort,
    buildId: health.buildId,
    activeJobs: health.activeJobs,
    restartPending,
  };
}

export function createWorkstreamsAppSupervisor(
  effects: WorkstreamsAppEffects,
  config: WorkstreamsAppSupervisorConfig,
): WorkstreamsAppSupervisor {
  const startupTimeoutMs = config.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
  const quietMs = config.quietMs ?? DEFAULT_QUIET_MS;
  const reconcileMs = config.reconcileMs ?? DEFAULT_RECONCILE_MS;
  const activeJobPollMs = config.activeJobPollMs ?? DEFAULT_ACTIVE_JOB_POLL_MS;
  const killGraceMs = config.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
  const exhibitsPort = config.exhibitsPort ?? EXHIBITS_DEFAULT_PORT;

  let currentState: WorkstreamsAppState = { phase: "stopped", changedAt: effects.now() };
  let current: Generation | null = null;
  let generationId = 0;
  let launchPromise: Promise<void> | null = null;
  let restartPending = false;
  let restartVersion = 0;
  let restartReason = "source changed";
  let quietTimer: WorkstreamsAppTimer | null = null;
  let activeJobTimer: WorkstreamsAppTimer | null = null;
  let reconcileTimer: WorkstreamsAppTimer | null = null;
  let watcher: WorkstreamsAppWatch | null = null;
  let lastFingerprint: string | null = null;
  let shuttingDown = false;
  let exhibitsHold: ExhibitsPortHold | null = null;
  let exhibitsToken: string | null = null;
  // Acquire and release are serialized: a restart releases the hold to the new
  // child while the state change that took it may still be settling.
  let exhibitsHoldWork: Promise<void> = Promise.resolve();

  function acquireExhibitsHold(): Promise<void> {
    exhibitsHoldWork = exhibitsHoldWork.then(async () => {
      if (exhibitsHold !== null || shuttingDown) return;
      try {
        exhibitsHold = await effects.holdExhibitsPort({
          port: exhibitsPort,
          render: () => renderExhibitsFallback(currentState, config.logPath),
        });
      } catch (error) {
        // The child may still own the port (a stop that has not landed yet).
        config.log(`[workstreams-app] exhibits fallback could not bind ${String(exhibitsPort)}: ${errorMessage(error)}`);
      }
    });
    return exhibitsHoldWork;
  }

  function releaseExhibitsHold(): Promise<void> {
    exhibitsHoldWork = exhibitsHoldWork.then(async () => {
      const hold = exhibitsHold;
      exhibitsHold = null;
      if (hold === null) return;
      try {
        await hold.release();
      } catch (error) {
        config.log(`[workstreams-app] exhibits fallback release failed: ${errorMessage(error)}`);
      }
    });
    return exhibitsHoldWork;
  }

  function setState(state: WorkstreamsAppState): void {
    currentState = state;
    config.log(`[workstreams-app] ${state.phase}`);
    // A direct exhibit URL must not connection-refuse into silence while the
    // child is down; spawnGeneration releases the port back to the replacement.
    if (state.phase === "failed" || state.phase === "starting" || state.phase === "restarting") {
      void acquireExhibitsHold();
    }
  }

  function clearTimer(timer: WorkstreamsAppTimer | null): null {
    timer?.cancel();
    return null;
  }

  async function stopGeneration(generation: Generation): Promise<void> {
    generation.intentionalStop = true;
    await effects.stopChildren([generation.backend, generation.frontend], killGraceMs);
    await effects.removeGeneration(generation);
  }

  function childExited(
    generation: Generation,
    kind: "backend" | "frontend",
    exit: { code: number | null; signal: NodeJS.Signals | null },
  ): void {
    if (generation.intentionalStop || current !== generation || shuttingDown) return;
    current = null;
    const detail = exit.signal ? `signal ${exit.signal}` : `code ${String(exit.code)}`;
    setState({
      phase: "failed",
      changedAt: effects.now(),
      message: `${kind} exited unexpectedly (${detail})`,
    });
    void effects.removeGeneration(generation);
    generation.intentionalStop = true;
    void effects.stopChildren([generation.backend, generation.frontend], killGraceMs);
  }

  function wireChildExits(generation: Generation): void {
    generation.backend.onExit((exit) => childExited(generation, "backend", exit));
    generation.frontend.onExit((exit) => childExited(generation, "frontend", exit));
  }

  async function spawnGeneration(): Promise<{ generation: Generation; health: WorkstreamsAppHealth }> {
    await effects.prepare(config.logPath);
    const [backendPort, frontendPort] = await Promise.all([effects.getPort(), effects.getPort()]);
    const capability = effects.randomCapability();
    const buildId = effects.randomBuildId();
    exhibitsToken ??= await effects.exhibitsToken();
    const spawnOptions: WorkstreamsAppSpawnOptions = {
      appRoot: config.appRoot,
      backendPort,
      frontendPort,
      exhibitsPort,
      exhibitsToken,
      capability,
      buildId,
      logPath: config.logPath,
    };
    // The child binds the exhibits port, so the fallback must let go first.
    await releaseExhibitsHold();
    const backend = effects.spawnBackend(spawnOptions);
    const frontend = effects.spawnFrontend(spawnOptions);
    const generation: Generation = {
      id: ++generationId,
      backend,
      frontend,
      backendPid: backend.pid,
      frontendPid: frontend.pid,
      backendPort,
      frontendPort,
      capability,
      intentionalStop: false,
      startedAt: effects.now(),
    };
    current = generation;
    wireChildExits(generation);
    await effects.recordGeneration(generation);
    const exitedEarly = (kind: "backend" | "frontend", child: WorkstreamsAppChild) =>
      child.exited.then((exit) => {
        const detail = exit.signal ? `signal ${exit.signal}` : `code ${String(exit.code)}`;
        throw new Error(`${kind} exited before readiness (${detail})`);
      });
    const health = await Promise.race([
      effects.waitUntilReady({ backendPort, frontendPort, capability, timeoutMs: startupTimeoutMs }),
      exitedEarly("backend", backend),
      exitedEarly("frontend", frontend),
    ]);
    return { generation, health };
  }

  function schedulePendingRestart(): void {
    quietTimer = clearTimer(quietTimer);
    quietTimer = effects.setTimer(quietMs, () => {
      quietTimer = null;
      void attemptRestart();
    });
  }

  async function afterLaunch(): Promise<void> {
    if (!restartPending || shuttingDown) return;
    schedulePendingRestart();
  }

  async function launch(mode: "start" | "restart", reason: string): Promise<void> {
    if (shuttingDown || launchPromise) return launchPromise ?? Promise.resolve();
    const coveredRestartVersion = restartVersion;
    const run = (async () => {
      const previous = current;
      if (mode === "restart") {
        setState({ phase: "restarting", changedAt: effects.now(), reason });
      } else {
        setState({ phase: "starting", changedAt: effects.now() });
      }
      current = null;
      if (previous) await stopGeneration(previous);
      try {
        const result = await spawnGeneration();
        if (shuttingDown || current !== result.generation) {
          await stopGeneration(result.generation);
          return;
        }
        if (restartVersion === coveredRestartVersion) restartPending = false;
        setState(readyState(effects, result.generation, result.health, restartPending));
      } catch (error) {
        const failedGeneration = current;
        current = null;
        if (failedGeneration) await stopGeneration(failedGeneration);
        if (!shuttingDown) {
          setState({ phase: "failed", changedAt: effects.now(), message: errorMessage(error) });
        }
      }
    })();
    launchPromise = run;
    try {
      await run;
    } finally {
      if (launchPromise === run) launchPromise = null;
      await afterLaunch();
    }
  }

  function deferForActiveJobs(generation: Generation, health: WorkstreamsAppHealth): void {
    currentState = readyState(effects, generation, health, true);
    activeJobTimer = clearTimer(activeJobTimer);
    activeJobTimer = effects.setTimer(activeJobPollMs, () => {
      activeJobTimer = null;
      void attemptRestart();
    });
  }

  async function attemptRestart(): Promise<void> {
    if (!restartPending || shuttingDown || launchPromise) return;
    const generation = current;
    if (generation && currentState.phase === "ready") {
      try {
        const health = await effects.readHealth(generation.backendPort, generation.capability);
        if (health.activeJobs > 0) {
          deferForActiveJobs(generation, health);
          return;
        }
      } catch (error) {
        config.log(`[workstreams-app] health check before restart failed: ${errorMessage(error)}`);
      }
    }
    await launch(generation ? "restart" : "start", restartReason);
  }

  function requestRestart(reason: string): void {
    if (shuttingDown) return;
    restartPending = true;
    restartVersion++;
    restartReason = reason;
    if (currentState.phase === "ready" && current) {
      currentState = { ...currentState, restartPending: true };
    }
    schedulePendingRestart();
  }

  async function reconcileFingerprint(): Promise<void> {
    try {
      const next = await effects.fingerprint(config.appRoot);
      if (lastFingerprint !== null && next !== lastFingerprint) {
        requestRestart("source fingerprint changed");
      }
      lastFingerprint = next;
    } catch (error) {
      config.log(`[workstreams-app] source fingerprint failed: ${errorMessage(error)}`);
    }
  }

  function installWatchers(): void {
    if (watcher) return;
    try {
      watcher = effects.watch(
        config.appRoot,
        (relativePath) => {
          if (relativePath === null || shouldRestartWorkstreamsBackend(relativePath)) {
            requestRestart(relativePath ? `source changed: ${relativePath}` : "source changed");
          }
        },
        (error) => config.log(`[workstreams-app] source watcher failed; periodic reconciliation remains active: ${error.message}`),
      );
    } catch (error) {
      config.log(`[workstreams-app] source watcher unavailable; periodic reconciliation remains active: ${errorMessage(error)}`);
    }
    reconcileTimer = effects.setInterval(reconcileMs, () => void reconcileFingerprint());
  }

  async function start(): Promise<void> {
    if (shuttingDown) return;
    installWatchers();
    await reconcileFingerprint();
    if (currentState.phase === "ready" || currentState.phase === "starting" || currentState.phase === "restarting") return;
    await launch("start", "router startup");
  }

  async function retry(): Promise<void> {
    if (shuttingDown) return;
    restartPending = false;
    quietTimer = clearTimer(quietTimer);
    activeJobTimer = clearTimer(activeJobTimer);
    await launch(current ? "restart" : "start", "manual retry");
  }

  function targetFor(url: string): WorkstreamsAppTarget | null {
    if (currentState.phase !== "ready" || !current) return null;
    const backend = isBackendUrl(url);
    return {
      port: backend ? current.backendPort : current.frontendPort,
      capability: current.capability,
      kind: backend ? "backend" : "frontend",
    };
  }

  async function shutdown(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    watcher?.close();
    watcher = null;
    quietTimer = clearTimer(quietTimer);
    activeJobTimer = clearTimer(activeJobTimer);
    reconcileTimer = clearTimer(reconcileTimer);
    const generation = current;
    current = null;
    if (generation) await stopGeneration(generation);
    await releaseExhibitsHold();
    setState({ phase: "stopped", changedAt: effects.now() });
  }

  return { start, retry, requestRestart, state: () => currentState, targetFor, shutdown };
}

const WATCH_IGNORED_DIRS = new Set([
  ".cache",
  ".git",
  ".tap",
  "dist",
  "node_modules",
  "test",
]);

export function shouldRestartWorkstreamsBackend(relativePath: string): boolean {
  const normalized = relativePath.split(path.sep).join("/").replace(/^\.\//, "");
  const first = normalized.split("/")[0] ?? normalized;
  if (WATCH_IGNORED_DIRS.has(first)) return false;
  return !(normalized === "src/frontend" || normalized.startsWith("src/frontend/"));
}

async function fingerprintFiles(root: string, relative = ""): Promise<string[]> {
  const dir = path.join(root, relative);
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (relative === "" && error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory() && WATCH_IGNORED_DIRS.has(entry.name)) continue;
    const child = path.join(relative, entry.name);
    if (!shouldRestartWorkstreamsBackend(child)) continue;
    if (entry.isDirectory()) files.push(...await fingerprintFiles(root, child));
    else if (entry.isFile()) files.push(child);
  }
  return files;
}

export async function fingerprintWorkstreamsApp(appRoot: string): Promise<string> {
  const hash = createHash("sha256");
  const files = (await fingerprintFiles(appRoot)).sort();
  if (files.length === 0) hash.update("missing-or-empty");
  for (const relative of files) {
    hash.update(relative);
    hash.update("\0");
    hash.update(await fs.readFile(path.join(appRoot, relative)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function escapeExhibitsHtml(value: string): string {
  return value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
}

/**
 * The buildless page the supervisor serves on the exhibits port while no child
 * owns it. It depends on nothing in the app package, because the reason it is
 * showing is usually that the package would not start.
 */
export function renderExhibitsFallback(state: WorkstreamsAppState, logPath: string): string {
  const detail = state.phase === "failed"
    ? `<div class="err">${escapeExhibitsHtml(state.message)}</div>`
    : `<p>The exhibits surface is currently <strong>${escapeExhibitsHtml(state.phase)}</strong>.</p>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Exhibits unavailable</title>
<style>
  body { font: 15px/1.5 system-ui, sans-serif; max-width: 52rem; margin: 3rem auto; padding: 0 1rem; color: #222; }
  h1 { font-size: 1.35rem; }
  .err { margin: 1rem 0; padding: 0.8rem 1rem; background: #fff5f5; border-left: 4px solid #b43; white-space: pre-wrap; }
  code { background: #f3f3f3; padding: 0.1rem 0.3rem; }
</style>
</head>
<body>
<h1>Exhibits unavailable</h1>
${detail}
<p>Your exhibits are files in the store and are unaffected; only the app serving them is down.</p>
<p>App output is in <code>${escapeExhibitsHtml(logPath)}</code>. Reload once it reports a ready generation.</p>
</body>
</html>`;
}

async function readOrCreateExhibitsToken(stateDir: string): Promise<string> {
  const file = path.join(stateDir, "exhibits-token");
  try {
    const existing = (await fs.readFile(file, "utf8")).trim();
    if (existing.length >= 16) return existing;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  const token = randomBytes(32).toString("base64url");
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(file, `${token}\n`, { mode: 0o600 });
  // writeFile's mode does not apply to a file that already existed.
  await fs.chmod(file, 0o600);
  return token;
}

function holdExhibitsPort(options: { port: number; render: () => string }): Promise<ExhibitsPortHold> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(503, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(options.render());
    });
    server.once("error", reject);
    server.listen(options.port, "127.0.0.1", () => {
      server.removeListener("error", reject);
      // A later listen error would otherwise be an unhandled 'error' event.
      server.on("error", () => {});
      resolve({
        release: () => new Promise<void>((released) => {
          server.closeAllConnections();
          server.close(() => released());
        }),
      });
    });
  });
}

function requestHealth(port: number, capability: string): Promise<WorkstreamsAppHealth> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: `${WORKSTREAMS_APP_BASE_PATH}/__internal/health`,
        method: "GET",
        timeout: 1_000,
        headers: { [WORKSTREAMS_APP_CAPABILITY_HEADER]: capability },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            reject(new Error(`health returned HTTP ${String(res.statusCode)}`));
            return;
          }
          try {
            const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            resolve(parseWorkstreamsAppHealth(value));
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("health request timed out")));
    req.end();
  });
}

function parseWorkstreamsAppHealth(value: unknown): WorkstreamsAppHealth {
  if (typeof value !== "object" || value === null) throw new Error("health response must be an object");
  const status = "status" in value ? value.status : undefined;
  const activeJobs = "activeJobs" in value ? value.activeJobs : undefined;
  const buildId = "buildId" in value ? value.buildId : undefined;
  if (status !== "ready") throw new Error("health status must be ready");
  if (typeof activeJobs !== "number" || !Number.isInteger(activeJobs) || activeJobs < 0) {
    throw new Error("health activeJobs must be a non-negative integer");
  }
  if (typeof buildId !== "string" || buildId === "") throw new Error("health buildId must be a non-empty string");
  return { status, activeJobs, buildId };
}

function waitForFrontend(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: `${WORKSTREAMS_APP_BASE_PATH}/`, method: "GET", timeout: 1_000 },
      (res) => {
        res.resume();
        resolve();
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("frontend request timed out")));
    req.end();
  });
}

async function waitUntilReady(options: {
  backendPort: number;
  frontendPort: number;
  capability: string;
  timeoutMs: number;
}): Promise<WorkstreamsAppHealth> {
  const startedAt = Date.now();
  let lastError = "not ready";
  while (Date.now() - startedAt < options.timeoutMs) {
    try {
      const [health] = await Promise.all([
        requestHealth(options.backendPort, options.capability),
        waitForFrontend(options.frontendPort),
      ]);
      return health;
    } catch (error) {
      lastError = errorMessage(error);
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  throw new Error(`workstreams app did not become ready within ${options.timeoutMs}ms: ${lastError}`);
}

function realTimer(ms: number, callback: () => void, repeat: boolean): WorkstreamsAppTimer {
  const handle = repeat ? setInterval(callback, ms) : setTimeout(callback, ms);
  handle.unref();
  return { cancel: () => repeat ? clearInterval(handle) : clearTimeout(handle) };
}

function killProcessGroup(pid: number | undefined, signal: NodeJS.Signals): void {
  if (pid === undefined) return;
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // Already gone.
    }
  }
}

function spawnAppChild(
  command: "dev:server" | "dev:frontend",
  options: WorkstreamsAppSpawnOptions,
): WorkstreamsAppChild {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    WORKSTREAMS_APP_PORT: String(options.backendPort),
    WORKSTREAMS_APP_FRONTEND_PORT: String(options.frontendPort),
    WORKSTREAMS_APP_BASE_PATH,
    VITE_BASE: `${WORKSTREAMS_APP_BASE_PATH}/`,
  };
  if (command === "dev:server") {
    env.WORKSTREAMS_APP_ROUTER_CAPABILITY = options.capability;
    env.WORKSTREAMS_APP_BUILD_ID = options.buildId;
    // The exhibits listener lives in the backend process, on its own origin
    // with its own credential. Vite never learns either.
    env.EXHIBITS_PORT = String(options.exhibitsPort);
    env.EXHIBITS_TOKEN = options.exhibitsToken;
  } else {
    // Vite is an asset/HMR target, not a second authenticated proxy. In the
    // router-owned runtime, API requests go directly to Fastify. Withholding
    // the secret here ensures a direct request to Vite cannot use its optional
    // standalone-dev API proxy to bypass the outer owner/CSRF gate.
    delete env.WORKSTREAMS_APP_ROUTER_CAPABILITY;
    delete env.WORKSTREAMS_APP_BUILD_ID;
    delete env.EXHIBITS_TOKEN;
  }
  const child = execa("pnpm", ["--dir", options.appRoot, command], {
    cwd: options.appRoot,
    env,
    stdio: ["ignore", { file: options.logPath, append: true }, { file: options.logPath, append: true }],
    detached: true,
    cleanup: true,
  });
  // A killed resident child rejects its execa promise. Consume that rejection
  // immediately; the exit listener below is the lifecycle signal.
  child.catch(() => {});
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.on("exit", (code, signal) => resolve({ code, signal }));
  });
  return {
    pid: child.pid,
    exited,
    onExit: (listener) => {
      child.on("exit", (code, signal) => listener({ code, signal }));
    },
  };
}

function createRealWatcher(
  appRoot: string,
  onChange: (relativePath: string | null) => void,
  onError: (error: Error) => void,
): FSWatcher {
  const watcher = watchFs(appRoot, { recursive: true }, (_event, filename) => {
    onChange(filename === null ? null : filename.toString());
  });
  watcher.on("error", onError);
  return watcher;
}

export function createRealWorkstreamsAppEffects(stateDir: string): WorkstreamsAppEffects {
  const pidStore: PidStore = createPidStore(path.join(stateDir, "pids"));
  const pidName = "_workstreams-app";
  return {
    now: () => Date.now(),
    prepare: async (logPath) => {
      await fs.mkdir(path.dirname(logPath), { recursive: true });
      await fs.appendFile(logPath, `\n=== router start ${new Date().toISOString()} ===\n`);
    },
    getPort: () => getPort(),
    randomCapability: () => randomBytes(32).toString("base64url"),
    randomBuildId: () => randomBytes(12).toString("hex"),
    spawnBackend: (options) => spawnAppChild("dev:server", options),
    spawnFrontend: (options) => spawnAppChild("dev:frontend", options),
    stopChildren: async (children, graceMs) => {
      for (const child of children) killProcessGroup(child.pid, "SIGTERM");
      let timedOut = false;
      await Promise.race([
        Promise.all(children.map((child) => child.exited)),
        new Promise<void>((resolve) => setTimeout(() => {
          timedOut = true;
          resolve();
        }, graceMs)),
      ]);
      if (timedOut) {
        for (const child of children) killProcessGroup(child.pid, "SIGKILL");
      }
    },
    waitUntilReady,
    readHealth: requestHealth,
    fingerprint: fingerprintWorkstreamsApp,
    exhibitsToken: () => readOrCreateExhibitsToken(stateDir),
    holdExhibitsPort,
    watch: createRealWatcher,
    setTimer: (ms, callback) => realTimer(ms, callback, false),
    setInterval: (ms, callback) => realTimer(ms, callback, true),
    recordGeneration: (record) => pidStore.write(pidName, {
      name: pidName,
      vitePid: record.frontendPid,
      fastifyPid: record.backendPid,
      frontendPort: record.frontendPort,
      backendPort: record.backendPort,
      dashboardPort: null,
      socketDir: path.join(stateDir, "workstreams-app"),
      profileDir: path.join(stateDir, "workstreams-app"),
      routerPid: process.pid,
      startedAt: record.startedAt,
    }),
    removeGeneration: (record) => pidStore.remove(
      pidName,
      record ? { vitePid: record.frontendPid, fastifyPid: record.backendPid } : undefined,
    ),
  };
}
