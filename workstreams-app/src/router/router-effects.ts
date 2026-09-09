// The seam between router.ts and the worktree-lifecycle core: the injected
// `RouterEffects`/`RouterCoreConfig` surface every impure lifecycle operation
// arrives through, plus the small honestly-typed error helpers the lifecycle
// modules share. Split out of router-core.ts so the lifecycle modules
// (router-core.ts, router-worktree-start.ts, router-worktree-teardown.ts) can
// depend on these shapes without depending on each other.
//
// router.ts constructs the REAL effects (execa, get-port, the serialized pidfile
// store, http.request probes); workstreams-app/test/router/router-core.test.ts substitutes deterministic
// fakes.

import fs from "node:fs/promises";
import { parseEnv } from "node:util";
import type { Readable } from "node:stream";
import type { ResolvedBoxEntry } from "./box-entry.js";
import type { PidStore } from "./router-pidfile.js";
import type { TimerHandle } from "./router-lifecycle.js";


// --- injected effects ---------------------------------------------------------

/** A spawned child, narrowed to exactly what the lifecycle uses (execa's
 *  ResultPromise satisfies this structurally; a test's fake child implements
 *  it). It is a promise (rejects when the child exits non-zero — invariant #3
 *  swallows that at the spawn site) AND a handle exposing pid, output streams,
 *  and the `exit` event. */
export interface SpawnedChild extends Promise<unknown> {
  readonly pid?: number;
  readonly stdout: Readable | null;
  readonly stderr: Readable | null;
  on(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): void;
}

/** The subset of execa options the lifecycle passes through (lifecycle children:
 *  detached + piped stdio; dashboard commands: ignored stdio + a timeout). */
export interface SpawnOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdio?: "ignore" | ["ignore", "pipe", "pipe"];
  detached?: boolean;
  cleanup?: boolean;
  timeout?: number;
}

/** A resolved worktree: where its checkout lives and which boxes it serves.
 *  Produced by the `resolveWorktree` effect (router.ts owns the filesystem
 *  layout constants); the lifecycle only consumes the shape. */
export interface ResolvedWorktree {
  name: string;
  root: string;
  backendCwd: string;
  frontendCwd: string;
  boxes: string[];
}

/**
 * Every impure operation the lifecycle performs. Real implementations live in
 * router.ts; fakes live in the tests. Enumerated deliberately so a reviewer can
 * grep the core for a raw `execa`/`setTimeout`/`Date.now`/`fs` call and know it's
 * a bug (everything must route through here).
 */
export interface RouterEffects {
  /** Spawn a child. Both the two lifecycle children (vite, fastify) and the four
   *  dashboard commands (pre-start stop, start, failed-startup stop, stopDashboard)
   *  go through here. The rejection is swallowed at the spawn site by the caller's
   *  very next line (lifecycle children) or the awaiting `.catch` (dashboard). */
  spawn(command: string, params: { args: string[]; options: SpawnOptions }): SpawnedChild;
  /** SIGTERM (or the given signal) a child's process GROUP, falling back to the
   *  bare pid. No-op for `undefined`. */
  killGroup(pid: number | undefined, signal?: NodeJS.Signals): void;
  /** Whether a pid is alive (used by the boot sweep, not the lifecycle). */
  pidAlive(pid: number): boolean;
  /** Poll an HTTP GET until it responds or `timeoutMs` elapses; reject on
   *  timeout. The whole probe is the effect (its internal per-request timeouts
   *  stay inside), so a fake replaces readiness wholesale. */
  waitForHttp(port: number, probe: { reqPath: string; timeoutMs: number; label: string }): Promise<void>;
  /** Arm a timer; the returned handle cancels it. The real impl `unref()`s the
   *  timer and runs the callback inside a try/catch that logs, so a throwing
   *  escalation/idle callback can't crash the router. */
  setTimer(ms: number, fn: () => void): TimerHandle;
  clearTimer(handle: TimerHandle): void;
  now(): number;
  sleep(ms: number): Promise<void>;
  /** The per-name-serialized pidfile store (invariants #1 + #6). */
  pidStore: PidStore;
  /** Write this worktree's single-slot `hub.json`, returning its path. */
  writeHubConfig(params: { name: string; backendPort: number; resolvedBoxes: ResolvedBoxEntry[] }): Promise<string>;
  getPort(): Promise<number>;
  resolveWorktree(name: string): Promise<ResolvedWorktree | null>;
  resolveBoxEntries(entries: string[]): Promise<ResolvedBoxEntry[]>;
  /** A token identifying the backend source in a checkout, for detecting that a
   *  running generation is executing code that has since changed on disk.
   *  Returns `null` when it cannot be computed — which disables the comparison
   *  for that generation rather than reporting a false mismatch. */
  sourceToken(root: string): Promise<string | null>;
}

/** Static configuration + hooks the lifecycle needs (non-impure values, plus the
 *  tab-title state-change hook that replaces router.ts's old monkey-patching). */
export interface RouterCoreConfig {
  idleTimeoutMs: number;
  killGraceMs: number;
  /** Where per-worktree log files are written (real streams, per the plan; tests
   *  point this at a tmp dir). */
  logDir: string;
  /** Base dir for a worktree's agent-browser socket/profile dirs. */
  browseDir: string;
  agentBrowserBin: string;
  /** `true` reverts the backend to the legacy single server-main.ts process. */
  devNoHub: boolean;
  /** This router process's pid, stamped into pidfile records. */
  routerPid: number;
  log: (msg: string) => void;
  /** Called after every state change (touch / stop / child-exit) so router.ts
   *  can refresh the terminal tab title. Replaces the old let-rebinding hack. */
  onStateChange?: () => void;
}

// --- error helpers (honestly typed; bin/ can't import beebox's guards) ---

/** A message from an unknown thrown value, without an `as Error` cast. */
export function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** An errno `code` off an unknown thrown value, or undefined. The `in` narrow
 *  exposes the property as `unknown` without a cast. */
export function errnoCode(e: unknown): string | undefined {
  if (typeof e === "object" && e !== null && "code" in e) {
    const code = e.code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

export interface StatusError extends Error {
  statusCode?: number;
}

export function statusError(message: string, statusCode: number): StatusError {
  const err: StatusError = new Error(message);
  err.statusCode = statusCode;
  return err;
}

/** The HTTP status carried on a thrown value, or undefined (no `as` cast). */
export function httpStatusOf(err: unknown): number | undefined {
  if (err instanceof Error && "statusCode" in err) {
    const sc = err.statusCode;
    if (typeof sc === "number") return sc;
  }
  return undefined;
}

/**
 * Read a checkout's `beebox/.env` into a plain object.
 *
 * Deliberately does NOT mutate the router's own `process.env`: the router
 * serves many checkouts, and one worktree's file must not leak into another's
 * children (or into the router itself). `util.parseEnv` is Node's own dotenv
 * parser, so this adds no dependency and follows the same syntax `--env-file`
 * does.
 *
 * A missing file is the normal case (a checkout need not have one) and reads
 * as empty. Any other read/parse failure is logged and treated as empty rather
 * than failing the worktree start: dev config is an enhancement, and refusing
 * to start the whole worktree over a malformed line would be a worse failure
 * than running without it.
 */
export async function readEnvFile(
  envPath: string,
  log: (msg: string) => void,
): Promise<NodeJS.Dict<string>> {
  let text: string;
  try {
    text = await fs.readFile(envPath, "utf8");
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") {
      log(`[env] ignoring unreadable ${envPath}: ${errMessage(e)}`);
    }
    return {};
  }
  try {
    return parseEnv(text);
  } catch (e) {
    log(`[env] ignoring unparseable ${envPath}: ${errMessage(e)}`);
    return {};
  }
}
