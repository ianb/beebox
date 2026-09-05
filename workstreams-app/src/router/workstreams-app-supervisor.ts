// Resident workstreams-app lifecycle owned by the dependency-light dev router.
//
// This is deliberately separate from the lazy per-worktree lifecycle in
// router-core.ts. The workstreams app is one always-on main-checkout service,
// has its own capability boundary, and restarts only when its own backend
// sources change. It must not inherit the per-worktree idle protocol or mutate
// the agent-facing bin/workstreams command.
//
// This module is the state machine only. Its siblings hold the parts it stands
// on, and it re-exports their public surface so callers keep importing one
// path: workstreams-app-contract.ts (shapes), -exhibits.ts (the fallback port),
// -sources.ts (what counts as a change), -generation.ts (the child pair),
// -restart.ts (when a requested restart happens), and -effects.ts (the real
// implementations).

import {
  EXHIBITS_DEFAULT_PORT,
  errorMessage,
  settled,
  WORKSTREAMS_APP_BASE_PATH,
  type Generation,
  type WorkstreamsAppEffects,
  type WorkstreamsAppHealth,
  type WorkstreamsAppState,
  type WorkstreamsAppSupervisor,
  type WorkstreamsAppSupervisorConfig,
  type WorkstreamsAppTarget,
} from "./workstreams-app-contract.js";
import { createExhibitsHoldManager, renderExhibitsFallback } from "./workstreams-app-exhibits.js";
import { createGenerationManager } from "./workstreams-app-generation.js";
import { createRestartPolicy } from "./workstreams-app-restart.js";
import { createSourceWatch } from "./workstreams-app-sources.js";

export {
  EXHIBITS_DEFAULT_PORT,
  WORKSTREAMS_APP_BASE_PATH,
  WORKSTREAMS_APP_CAPABILITY_HEADER,
} from "./workstreams-app-contract.js";
export type {
  ExhibitsPortHold,
  WorkstreamsAppChild,
  WorkstreamsAppEffects,
  WorkstreamsAppGenerationRecord,
  WorkstreamsAppHealth,
  WorkstreamsAppPhase,
  WorkstreamsAppSpawnOptions,
  WorkstreamsAppState,
  WorkstreamsAppSupervisor,
  WorkstreamsAppSupervisorConfig,
  WorkstreamsAppTarget,
  WorkstreamsAppTimer,
  WorkstreamsAppWatch,
} from "./workstreams-app-contract.js";
export { renderExhibitsFallback } from "./workstreams-app-exhibits.js";
export { fingerprintWorkstreamsApp, shouldRestartWorkstreamsBackend } from "./workstreams-app-sources.js";
export { createRealWorkstreamsAppEffects } from "./workstreams-app-effects.js";

const DEFAULT_STARTUP_TIMEOUT_MS = 30_000;
const DEFAULT_QUIET_MS = 1_000;
const DEFAULT_RECONCILE_MS = 30_000;
const DEFAULT_ACTIVE_JOB_POLL_MS = 1_000;
const DEFAULT_KILL_GRACE_MS = 2_000;
const DEFAULT_EXHIBITS_HOLD_RETRY_MS = 250;

function isBackendUrl(url: string): boolean {
  const pathname = url.split("?")[0] ?? url;
  return pathname === `${WORKSTREAMS_APP_BASE_PATH}/api` ||
    pathname.startsWith(`${WORKSTREAMS_APP_BASE_PATH}/api/`) ||
    pathname === `${WORKSTREAMS_APP_BASE_PATH}/__internal` ||
    pathname.startsWith(`${WORKSTREAMS_APP_BASE_PATH}/__internal/`);
}

function resolveTarget(options: {
  state: WorkstreamsAppState;
  generation: Generation | null;
  url: string;
}): WorkstreamsAppTarget | null {
  const { generation } = options;
  if (options.state.phase !== "ready" || !generation) return null;
  const backend = isBackendUrl(options.url);
  return {
    port: backend ? generation.backendPort : generation.frontendPort,
    capability: generation.capability,
    kind: backend ? "backend" : "frontend",
  };
}

function readyState(options: {
  effects: WorkstreamsAppEffects;
  generation: Generation;
  health: WorkstreamsAppHealth;
  restartPending: boolean;
}): WorkstreamsAppState {
  return {
    phase: "ready",
    changedAt: options.effects.now(),
    backendPort: options.generation.backendPort,
    frontendPort: options.generation.frontendPort,
    buildId: options.health.buildId,
    activeJobs: options.health.activeJobs,
    restartPending: options.restartPending,
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
  const exhibitsHoldRetryMs = config.exhibitsHoldRetryMs ?? DEFAULT_EXHIBITS_HOLD_RETRY_MS;

  let currentState: WorkstreamsAppState = { phase: "stopped", changedAt: effects.now() };
  let launchPromise: Promise<void> | null = null;
  let shuttingDown = false;

  const exhibits = createExhibitsHoldManager({
    effects,
    log: config.log,
    port: exhibitsPort,
    retryMs: exhibitsHoldRetryMs,
    render: () => renderExhibitsFallback(currentState, config.logPath),
    isShuttingDown: () => shuttingDown,
  });

  const generations = createGenerationManager({
    effects,
    config,
    exhibitsPort,
    killGraceMs,
    startupTimeoutMs,
    isShuttingDown: () => shuttingDown,
    releaseExhibitsPort: () => exhibits.release(),
    onUnexpectedExit: ({ message, portFreed }) => {
      setState({ phase: "failed", changedAt: effects.now(), message }, portFreed);
    },
  });

  const restarts = createRestartPolicy({
    effects,
    log: config.log,
    quietMs,
    activeJobPollMs,
    generations,
    isShuttingDown: () => shuttingDown,
    isLaunching: () => launchPromise !== null,
    state: () => currentState,
    markPending: () => {
      if (currentState.phase === "ready") currentState = { ...currentState, restartPending: true };
    },
    markDeferred: (generation, health) => {
      currentState = readyState({ effects, generation, health, restartPending: true });
    },
    launch: (mode, reason) => launch(mode, reason),
  });

  const sources = createSourceWatch({
    effects,
    appRoot: config.appRoot,
    log: config.log,
    reconcileMs,
    requestRestart: restarts.request,
  });

  /**
   * `portFreed` is awaited before the fallback binds — the caller passes it
   * when a child of the outgoing generation may still hold the exhibits port.
   */
  function setState(state: WorkstreamsAppState, portFreed?: Promise<void>): void {
    currentState = state;
    config.log(`[workstreams-app] ${state.phase}`);
    // A direct exhibit URL must not connection-refuse into silence while the
    // child is down; a spawning generation releases the port to its children.
    if (state.phase === "failed" || state.phase === "starting" || state.phase === "restarting") {
      void exhibits.acquire(portFreed);
    }
  }

  async function launch(mode: "start" | "restart", reason: string): Promise<void> {
    if (shuttingDown || launchPromise) return launchPromise ?? Promise.resolve();
    const coveredRestartVersion = restarts.version();
    const run = (async () => {
      const previous = generations.take();
      // Same ordering rule as an unexpected child exit: the outgoing generation
      // owns the exhibits port until it is stopped, so the fallback waits.
      const stopped = previous ? generations.stop(previous) : Promise.resolve();
      setState(mode === "restart"
        ? { phase: "restarting", changedAt: effects.now(), reason }
        : { phase: "starting", changedAt: effects.now() }, settled(stopped));
      await stopped;
      try {
        const result = await generations.spawn();
        if (shuttingDown || generations.current() !== result.generation) {
          await generations.stop(result.generation);
          return;
        }
        restarts.settle(coveredRestartVersion);
        setState(readyState({
          effects,
          generation: result.generation,
          health: result.health,
          restartPending: restarts.pending(),
        }));
      } catch (error) {
        const failedGeneration = generations.take();
        if (failedGeneration) await generations.stop(failedGeneration);
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
      await restarts.rearm();
    }
  }

  async function start(): Promise<void> {
    if (shuttingDown) return;
    sources.install();
    await sources.reconcile();
    if (currentState.phase === "ready" || currentState.phase === "starting" || currentState.phase === "restarting") return;
    await launch("start", "router startup");
  }

  async function retry(): Promise<void> {
    if (shuttingDown) return;
    restarts.clearPending();
    restarts.cancelTimers();
    await launch(generations.current() ? "restart" : "start", "manual retry");
  }

  function targetFor(url: string): WorkstreamsAppTarget | null {
    return resolveTarget({ state: currentState, generation: generations.current(), url });
  }

  async function shutdown(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    sources.close();
    restarts.cancelTimers();
    const generation = generations.take();
    if (generation) await generations.stop(generation);
    await exhibits.release();
    setState({ phase: "stopped", changedAt: effects.now() });
  }

  return { start, retry, requestRestart: restarts.request, state: () => currentState, targetFor, shutdown };
}
