// When a requested restart actually happens. Split out of
// workstreams-app-supervisor.ts as a pure move: the supervisor owns launching a
// generation, and this module owns the two waits in front of it — the quiet
// period that coalesces a burst of file changes, and the poll that lets active
// jobs finish before their process is replaced.

import {
  clearTimer,
  errorMessage,
  type Generation,
  type WorkstreamsAppEffects,
  type WorkstreamsAppHealth,
  type WorkstreamsAppState,
  type WorkstreamsAppTimer,
} from "./workstreams-app-contract.js";
import { type GenerationManager } from "./workstreams-app-generation.js";

export interface RestartPolicy {
  /** Ask for a restart; it happens once the app has been quiet for `quietMs`. */
  request(reason: string): void;
  /** The request version a launch covers — a request during it bumps this. */
  version(): number;
  pending(): boolean;
  /** A launch finished: the request is served unless one arrived meanwhile. */
  settle(coveredVersion: number): void;
  /** Re-arm the quiet timer when a restart is still owed after a launch. */
  rearm(): Promise<void>;
  clearPending(): void;
  cancelTimers(): void;
}

/**
 * The generation's health, or null when the probe failed. A failed probe is not
 * a reason to refuse the restart — it is logged and the restart proceeds.
 */
async function probeHealth(options: {
  effects: WorkstreamsAppEffects;
  generation: Generation;
  log: (message: string) => void;
}): Promise<WorkstreamsAppHealth | null> {
  try {
    return await options.effects.readHealth(options.generation.backendPort, options.generation.capability);
  } catch (error) {
    options.log(`[workstreams-app] health check before restart failed: ${errorMessage(error)}`);
    return null;
  }
}

export function createRestartPolicy(options: {
  effects: WorkstreamsAppEffects;
  log: (message: string) => void;
  quietMs: number;
  activeJobPollMs: number;
  generations: GenerationManager;
  isShuttingDown: () => boolean;
  isLaunching: () => boolean;
  state: () => WorkstreamsAppState;
  /** Show the pending restart in a ready state the app is still serving from. */
  markPending: () => void;
  /** Stay ready, with the restart still owed, while jobs are in flight. */
  markDeferred: (generation: Generation, health: WorkstreamsAppHealth) => void;
  launch: (mode: "start" | "restart", reason: string) => Promise<void>;
}): RestartPolicy {
  const { effects } = options;
  let pending = false;
  let version = 0;
  let reason = "source changed";
  let quietTimer: WorkstreamsAppTimer | null = null;
  let activeJobTimer: WorkstreamsAppTimer | null = null;

  function scheduleQuiet(): void {
    quietTimer = clearTimer(quietTimer);
    quietTimer = effects.setTimer(options.quietMs, () => {
      quietTimer = null;
      void attemptRestart();
    });
  }

  function scheduleActiveJobPoll(): void {
    activeJobTimer = clearTimer(activeJobTimer);
    activeJobTimer = effects.setTimer(options.activeJobPollMs, () => {
      activeJobTimer = null;
      void attemptRestart();
    });
  }

  async function attemptRestart(): Promise<void> {
    if (!pending || options.isShuttingDown() || options.isLaunching()) return;
    const generation = options.generations.current();
    if (generation && options.state().phase === "ready") {
      const health = await probeHealth({ effects, generation, log: options.log });
      if (health !== null && health.activeJobs > 0) {
        options.markDeferred(generation, health);
        scheduleActiveJobPoll();
        return;
      }
    }
    await options.launch(generation ? "restart" : "start", reason);
  }

  return {
    request(nextReason: string): void {
      if (options.isShuttingDown()) return;
      pending = true;
      version++;
      reason = nextReason;
      if (options.state().phase === "ready" && options.generations.current()) options.markPending();
      scheduleQuiet();
    },
    version: () => version,
    pending: () => pending,
    settle(coveredVersion: number): void {
      if (version === coveredVersion) pending = false;
    },
    async rearm(): Promise<void> {
      if (!pending || options.isShuttingDown()) return;
      scheduleQuiet();
    },
    clearPending(): void {
      pending = false;
    },
    cancelTimers(): void {
      quietTimer = clearTimer(quietTimer);
      activeJobTimer = clearTimer(activeJobTimer);
    },
  };
}
