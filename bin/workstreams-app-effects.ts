// The real implementations behind WorkstreamsAppEffects: HTTP health probing,
// process spawning and killing, timers, and the persisted exhibits token. Split
// out of workstreams-app-supervisor.ts as a pure move, so the state machine
// there is readable without the plumbing it stands on (and so tests keep
// substituting the whole surface rather than pieces of this file).

import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { parseEnv } from "node:util";
import { execa } from "execa";
import getPorts from "get-port";
import { createPidStore, type PidStore } from "./router-pidfile.js";
import {
  WORKSTREAMS_APP_BASE_PATH,
  WORKSTREAMS_APP_CAPABILITY_HEADER,
  type WorkstreamsAppChild,
  type WorkstreamsAppEffects,
  type WorkstreamsAppHealth,
  type WorkstreamsAppSpawnOptions,
  type WorkstreamsAppTimer,
} from "./workstreams-app-contract.js";
import { holdExhibitsPort } from "./workstreams-app-exhibits.js";
import { createRealWatcher, fingerprintWorkstreamsApp } from "./workstreams-app-sources.js";

/** The health endpoint answered, but not with a 200. */
class HealthStatusError extends Error {
  constructor(readonly statusCode: number | undefined) {
    super(`health returned HTTP ${String(statusCode)}`);
    this.name = "HealthStatusError";
  }
}

/** One of the two startup probes ran out of its one-second budget. */
class HealthRequestTimeoutError extends Error {
  constructor() {
    super("health request timed out");
    this.name = "HealthRequestTimeoutError";
  }
}

class FrontendRequestTimeoutError extends Error {
  constructor() {
    super("frontend request timed out");
    this.name = "FrontendRequestTimeoutError";
  }
}

/** The four ways a health body can fail to be the health body. */
class HealthNotAnObjectError extends Error {
  constructor() {
    super("health response must be an object");
    this.name = "HealthNotAnObjectError";
  }
}

class HealthStatusNotReadyError extends Error {
  constructor() {
    super("health status must be ready");
    this.name = "HealthStatusNotReadyError";
  }
}

class HealthActiveJobsError extends Error {
  constructor() {
    super("health activeJobs must be a non-negative integer");
    this.name = "HealthActiveJobsError";
  }
}

class HealthBuildIdError extends Error {
  constructor() {
    super("health buildId must be a non-empty string");
    this.name = "HealthBuildIdError";
  }
}

/** The app never reached a ready generation inside the startup budget. */
class AppNotReadyError extends Error {
  constructor(readonly timeoutMs: number, readonly lastError: string) {
    super(`workstreams app did not become ready within ${timeoutMs}ms: ${lastError}`);
    this.name = "AppNotReadyError";
  }
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
            reject(new HealthStatusError(res.statusCode));
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
    req.on("timeout", () => req.destroy(new HealthRequestTimeoutError()));
    req.end();
  });
}

function parseWorkstreamsAppHealth(value: unknown): WorkstreamsAppHealth {
  if (typeof value !== "object" || value === null) throw new HealthNotAnObjectError();
  const status = "status" in value ? value.status : undefined;
  const activeJobs = "activeJobs" in value ? value.activeJobs : undefined;
  const buildId = "buildId" in value ? value.buildId : undefined;
  if (status !== "ready") throw new HealthStatusNotReadyError();
  if (typeof activeJobs !== "number" || !Number.isInteger(activeJobs) || activeJobs < 0) {
    throw new HealthActiveJobsError();
  }
  if (typeof buildId !== "string" || buildId === "") throw new HealthBuildIdError();
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
    req.on("timeout", () => req.destroy(new FrontendRequestTimeoutError()));
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
      lastError = error instanceof Error ? error.message : String(error);
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  throw new AppNotReadyError(options.timeoutMs, lastError);
}

function realTimer(ms: number, options: { callback: () => void; repeat: boolean }): WorkstreamsAppTimer {
  const handle = options.repeat ? setInterval(options.callback, ms) : setTimeout(options.callback, ms);
  handle.unref();
  return { cancel: () => options.repeat ? clearInterval(handle) : clearTimeout(handle) };
}

function killProcessGroup(pid: number | undefined, signal: NodeJS.Signals): void {
  if (pid === undefined) return;
  try {
    process.kill(-pid, signal);
  } catch (_groupError) {
    // ESRCH for the group: the child was never a group leader, or the whole
    // group is already gone. Fall back to the bare pid.
    try {
      process.kill(pid, signal);
    } catch (_pidError) {
      // Already gone.
    }
  }
}

/**
 * The main checkout's `callback-box/.env`, for the resident app the same way
 * `router-core.ts` hands each worktree child its own copy: dev config such as
 * `CALLBACK_OPENAI_API_KEY` (comment transcription, the issue browser's
 * Related section) lives there, and a real exported variable still wins.
 * Missing or unparseable means no file config, never a failed start — the
 * app has explicit no-key states for exactly this.
 */
function mainCheckoutEnvFile(appRoot: string): NodeJS.Dict<string> {
  const envPath = path.join(appRoot, "..", "callback-box", ".env");
  let text: string;
  try {
    text = readFileSync(envPath, "utf8");
  } catch (_e) {
    // No `.env` in the main checkout, or it cannot be read: no file config.
    return {};
  }
  try {
    return parseEnv(text);
  } catch (_e) {
    // An unparseable `.env` is dev config to fix, not a reason to refuse
    // to start the app.
    return {};
  }
}

function spawnAppChild(
  command: "dev:server" | "dev:frontend",
  options: WorkstreamsAppSpawnOptions,
): WorkstreamsAppChild {
  const env: NodeJS.ProcessEnv = {
    ...mainCheckoutEnvFile(options.appRoot),
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

export function createRealWorkstreamsAppEffects(stateDir: string): WorkstreamsAppEffects {
  const pidStore: PidStore = createPidStore(path.join(stateDir, "pids"));
  const pidName = "_workstreams-app";
  return {
    now: () => Date.now(),
    prepare: async (logPath) => {
      await fs.mkdir(path.dirname(logPath), { recursive: true });
      await fs.appendFile(logPath, `\n=== router start ${new Date().toISOString()} ===\n`);
    },
    getPort: () => getPorts(),
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
    setTimer: (ms, callback) => realTimer(ms, { callback, repeat: false }),
    setInterval: (ms, callback) => realTimer(ms, { callback, repeat: true }),
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
