// The shapes the resident workstreams-app supervisor is built from, plus the
// three one-line helpers every half of it needs.
//
// Split out of workstreams-app-supervisor.ts as a pure move so the supervisor,
// its effects implementation, and the two managers it delegates to (exhibits
// port, source watching) can each import the vocabulary without importing each
// other. The supervisor module re-exports all of this, so callers keep the one
// import path they always had.

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
  watch(
    appRoot: string,
    handlers: { onChange: (relativePath: string | null) => void; onError: (error: Error) => void },
  ): WorkstreamsAppWatch;
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
  /** Wait between attempts to bind the exhibits port after a child releases it. */
  exhibitsHoldRetryMs?: number;
}

export interface Generation extends WorkstreamsAppGenerationRecord {
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

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * "This work is over", success or failure — for waiters that only care that the
 * port is no longer claimed. The original promise keeps its rejection for the
 * caller that owns the failure.
 */
export function settled(work: Promise<unknown>): Promise<void> {
  return work.then(() => {}, () => {});
}

/** Cancel a timer if there is one, and hand back the null to store. */
export function clearTimer(timer: WorkstreamsAppTimer | null): null {
  timer?.cancel();
  return null;
}
