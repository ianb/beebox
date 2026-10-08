/**
 * The per-box status the supervisor reports (`Supervisor.getStatuses()`),
 * which the hub's `/healthz` returns and `health.ts` derives its verdict from.
 */
export type BoxRunStatus = "starting" | "running" | "unhealthy" | "stopped";

export interface BoxRuntimeStatus {
  slug: string;
  status: BoxRunStatus;
  pid: number | undefined;
  port: number | undefined;
  /** Lifetime restart count — never resets. Informational only; do NOT derive
   *  a health verdict from it (a box that blipped once weeks ago would pin the
   *  hub unhealthy forever). The live crash-loop signal is
   *  `consecutiveFailures`. */
  restarts: number;
  /** Consecutive failed launches since the last success — reset to 0 the
   *  moment a launch reaches "running" (`launch()`), incremented on each
   *  failed launch/unexpected exit. Nonzero while `status === "starting"`
   *  means the box is crash-looping right now; this is the field the health
   *  verdict keys on. */
  consecutiveFailures: number;
  lastError: string | undefined;
  /** Timing of the most recent successful launch; a lazy box's cold start. */
  lastStart: LaunchTiming | undefined;
}

/** Milliseconds from launch start: child spawned, then child answered the readiness probe. */
export interface LaunchTiming {
  at: string;
  spawnMs: number;
  readyMs: number;
}

/** The fields of a supervised box (`supervisor/core.ts`'s `ManagedBox`) that its status reports. */
interface StatusSource extends Omit<BoxRuntimeStatus, "pid" | "lastStart"> {
  child: { pid?: number | undefined } | undefined;
  lastStart?: LaunchTiming;
}

export function runtimeStatus(box: StatusSource): BoxRuntimeStatus {
  return {
    slug: box.slug,
    status: box.status,
    pid: box.child?.pid,
    port: box.port,
    restarts: box.restarts,
    consecutiveFailures: box.consecutiveFailures,
    lastError: box.lastError,
    lastStart: box.lastStart,
  };
}
