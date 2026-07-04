/**
 * Per-box process supervision for `cb hub` (Track D, chunk D1 in
 * `docs/plans/boxes-as-packages-v2.md`). Adapted from the monorepo dev
 * router's spawn/readiness/teardown mechanics (`../../../bin/router.ts`,
 * `startWorktree`/`onChildExit`/`stopWorktree`), productized as engine code:
 * no lazy-start or idle-shutdown (hub children are resident — schedulers and
 * webhooks want them up), no worktree/Vite concept, and it adds crash-loop
 * backoff, which the router never needed (a broken worktree just parks
 * "failed" until a human clicks retry; an unattended hub box needs to retry
 * itself, within limits).
 *
 * This module is the ONLY thing that knows a box's endpoint is currently "a
 * child process this supervisor spawned" — it implements `EndpointProvider`
 * (`./endpoints.js`) so `./hub-server.ts` never needs to know that.
 */

import * as path from "node:path";
import { execa, type ResultPromise } from "execa";
import getPorts from "get-port";
import { getBoxShape, type BoxShape } from "../cli/lib/box-shape.js";
import { PACKAGE_ROOT } from "../lib/package-root.js";
import { fileExists } from "../lib/file-exists.js";
import type { HubConfig, BoxEntry } from "./hub-config.js";
import type { Endpoint, EndpointProvider } from "./endpoints.js";
import { waitForHttp, killGroup, sleep, HttpReadinessTimeoutError } from "./child-process-utils.js";

type ChildProc = ResultPromise<{ stdio: ["ignore", "pipe", "pipe"]; detached: true; cleanup: true }>;

/**
 * Env vars a hub-spawned box child (`cb serve`) may inherit from the hub's
 * own process env. Fail-closed ALLOWLIST, not a denylist -- `process.env`
 * on the hub process holds a hub-only credential, `CB_SESSION_SECRET`, that
 * must NEVER reach a child: it's symmetric (HMAC), so any box that can
 * VERIFY a session cookie could also FORGE one for a sibling box. Spreading
 * `process.env` into every child (as this used to do) reopens exactly the
 * forgery hole Track D's D2 auth split closed (see
 * `docs/plans/boxes-as-packages-v2.md`'s "Isolation is layered": the hub is
 * trusted, boxes are not trusted with each other's secrets). Widen this
 * list only by adding a new named entry with a reasoned comment -- never by
 * reverting to a spread.
 *
 * `GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET` are listed below
 * deliberately, not withheld like the session secret: they're the app's
 * connector identity (registered with Google), not a per-box or per-hub
 * secret, and every box's calendar/gmail/drive connectors read them
 * directly (`getGoogleClientCreds()` in `src/connectors/google-auth.ts`) to
 * run and refresh their own per-box tokens. Under the current architecture
 * connector OAuth stays per-box -- the box owns its tokens -- so the client
 * creds are shared on purpose. Splitting them so each box holds distinct
 * client creds (or a hub-mediated OAuth proxy) is the OS-user hardening
 * subplan's concern (`docs/unimplemented-plans/box-user-account-spec.md`),
 * not this allowlist's.
 *
 * Built from evidence: every `process.env.X` read under `src/webapp/`,
 * `src/core/`, and `src/connectors/` as of this writing (a hub-spawned
 * child only ever runs `cb serve`, which is built from those trees), plus
 * the OS/runtime basics any Node process needs and the few Claude
 * Agent SDK knobs that are config, not secrets (subscription auth itself
 * reads `~/.claude/`, keyed off `HOME` below -- `ANTHROPIC_API_KEY` is
 * deliberately excluded, and is actively stripped elsewhere:
 * `cli/bootstrap.ts`, `core/script-env.ts`).
 */
const CHILD_ENV_ALLOWLIST: readonly string[] = [
  // --- OS/runtime basics ---
  "PATH",
  "HOME",
  "USERPROFILE", // Windows HOME equivalent -- src/core/box.ts's homeDir fallback.
  "TMPDIR",
  "TEMP",
  "TMP",
  "NODE_ENV", // src/webapp/routes/api.ts, chat-audio-routes.ts: dev-only branches.
  "TZ",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LC_MESSAGES",

  // --- Box-legitimate config/secrets a `cb serve` child reads directly ---
  "PUBLIC_URL", // src/lib/public-url.ts, telegram-helpers.ts, script-env.ts fallback.
  "CB_PUBLIC_URL", // src/lib/public-url.ts -- preferred over PUBLIC_URL when set.
  "CB_OWNER_EMAIL", // src/webapp/auth.ts getOwnerEmail() -- fleet owner identity, not a secret.
  "CB_DIAG_API_KEY", // src/webapp/auth.ts verifyDiagBearerKey -- shared read-only diag bearer key.
  "CB_GOOGLE_TOKENS_FILE", // src/connectors/google-auth.ts, requirements.ts -- a path, not a credential.
  "GOOGLE_OAUTH_CLIENT_ID", // src/connectors/google-auth.ts getGoogleClientCreds() -- app identity, shared per-box by design (see block comment above).
  "GOOGLE_OAUTH_CLIENT_SECRET", // ditto -- connector OAuth stays per-box; the box owns its tokens.
  "CB_LOG_PROMPTS", // src/core/agent-run.ts -- debug flag.
  "CB_STRICT_FETCH", // src/cli/bootstrap.ts -- test/scenario harness flag.
  "CB_STUBS_FILE", // src/cli/lib/fetch.ts -- scenario fixture path.
  "CB_SCENARIO_START_TIME", // src/cli/lib/fetch.ts -- scenario harness.
  "CB_TIME", // src/cli/lib/time.ts, fetch.ts -- scenario/time-travel harness.
  "THINKING_OPENAI_API_KEY", // src/webapp/routes/chat-audio-routes.ts -- box's own transcription key.
  "CALLBACK_MISTRAL_API_KEY", // src/core/mistral-key.ts -- box's own transcription key fallback.

  // --- Claude Agent SDK config knobs (not credentials) ---
  "CLAUDE_CONFIG_DIR", // relocates the ~/.claude/ credentials dir the SDK reads.
  "DISABLE_TELEMETRY",
  "DISABLE_ERROR_REPORTING",
  "DO_NOT_TRACK",
];

/**
 * Build a hub-spawned child's env: only `CHILD_ENV_ALLOWLIST` entries from
 * `sourceEnv` (normally the hub's own `process.env`), plus `hubExtras`
 * (currently just `CB_HUB_SECRET`) layered on top. Pure and exported so it
 * can be pinning-tested directly without spawning anything real -- see
 * `test/hub/supervisor.doctest.md`.
 */
export function buildChildEnv(params: {
  sourceEnv: NodeJS.ProcessEnv;
  hubExtras: Record<string, string>;
}): NodeJS.ProcessEnv {
  const { sourceEnv, hubExtras } = params;
  const env: NodeJS.ProcessEnv = {};
  for (const key of CHILD_ENV_ALLOWLIST) {
    const value = sourceEnv[key];
    if (value !== undefined) env[key] = value;
  }
  return { ...env, ...hubExtras };
}

/** Params for spawning a box child process -- see `SpawnChildFn`. */
export interface ChildSpawnParams {
  cbBinary: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

/**
 * Injectable child-process spawner. Real `execa` by default; tests override
 * it to simulate a child that never becomes ready, deterministically and
 * without a real process -- see `test/hub/supervisor.doctest.md`'s restart
 * race coverage.
 */
export type SpawnChildFn = (params: ChildSpawnParams) => ChildProc;

function defaultSpawnChild(params: ChildSpawnParams): ChildProc {
  return execa(params.cbBinary, params.args, {
    cwd: params.cwd,
    env: params.env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
    cleanup: true,
  }) as ChildProc;
}

/** Injectable readiness probe -- real `waitForHttp` by default; tests
 *  override it to fail immediately instead of waiting out
 *  `READY_TIMEOUT_MS` for real, so the restart race in
 *  `test/hub/supervisor.doctest.md` runs in milliseconds. */
export type CheckReadyFn = (params: { port: number; label: string }) => Promise<void>;

function defaultCheckReady(params: { port: number; label: string }): Promise<void> {
  return waitForHttp({ port: params.port, reqPath: "/healthz", timeoutMs: READY_TIMEOUT_MS, label: params.label });
}

const READY_TIMEOUT_MS = 30_000;
const KILL_GRACE_MS = 2000;
/** After this many consecutive crash-loop restarts, stop retrying and mark
 *  the box unhealthy until `reloadUnhealthy()` (SIGHUP) is called. No
 *  precedent in router.ts (worktrees don't self-restart) — chosen per the
 *  plan's explicit "pick N=5 unless you find a better precedent" guidance. */
const MAX_CONSECUTIVE_FAILURES = 5;
const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;

export class BoxResolutionError extends Error {
  constructor(entryPath: string) {
    super(
      "Configured box path " + entryPath + " has no .cb-box marker at itself or at its " +
        "content/ subdirectory -- not a callback box (checked both the v2 package-root " +
        "and legacy/v2 content-dir shapes)."
    );
    this.name = "BoxResolutionError";
  }
}

/**
 * Resolve a `hub.json` entry's `path` (may be a v2 PACKAGE root or a
 * content dir -- the plan's bilingual layout, resolved downward here the
 * way `findBoxRoot` resolves upward from a cwd) to the actual box
 * (content) root that `getBoxShape` expects.
 */
export async function resolveBoxRoot(entryPath: string): Promise<string> {
  if (await fileExists(path.join(entryPath, ".cb-box"))) return entryPath;
  const nested = path.join(entryPath, "content");
  if (await fileExists(path.join(nested, ".cb-box"))) return nested;
  throw new BoxResolutionError(entryPath);
}

/** The box's own installed `cb` when present (v2, installed), else the
 *  running engine's own `cb` (legacy boxes, or a v2 box mid-transition
 *  that hasn't been `pnpm install`ed yet -- same fallback the plan
 *  specifies for the transition window). */
async function resolveCbBinary(shape: BoxShape): Promise<string> {
  const ownBin = path.join(shape.packageRoot, "node_modules", ".bin", "cb");
  if (await fileExists(ownBin)) return ownBin;
  return path.join(PACKAGE_ROOT, "bin", "cb");
}

export type BoxRunStatus = "starting" | "running" | "unhealthy" | "stopped";

export interface BoxRuntimeStatus {
  slug: string;
  status: BoxRunStatus;
  pid: number | undefined;
  port: number | undefined;
  restarts: number;
  lastError: string | undefined;
}

interface ManagedBox {
  slug: string;
  entry: BoxEntry;
  status: BoxRunStatus;
  child: ChildProc | undefined;
  port: number | undefined;
  restarts: number;
  consecutiveFailures: number;
  lastError: string | undefined;
  /** Guards against a stale exit/readiness event from a generation that's
   *  already been superseded by a restart -- same hazard router.ts's
   *  `onChildExit` comment describes for worktrees. */
  generation: number;
  restartTimer: NodeJS.Timeout | undefined;
  /**
   * Set to the generation number `launch()`'s own readiness-timeout catch
   * block just killed, right before it calls `killGroup()` -- so when that
   * kill's "exit" event later fires (same generation, since a restart
   * hasn't started yet), `onChildExit` recognizes the failure was already
   * recorded and a restart already scheduled, instead of double-counting
   * both and scheduling a second, overlapping child. Cleared once consumed.
   */
  expectedExitGeneration: number | undefined;
}

export interface SupervisorOptions {
  config: HubConfig;
  /**
   * Handed to every spawned child via `CB_HUB_SECRET` (Track D, chunk D2) --
   * the per-boot secret that gates the hub-injected identity headers a box
   * trusts in hub mode. See `src/webapp/auth.ts`'s
   * `isHubMode`/`resolveRequestIdentity`.
   */
  hubSecret: string;
  /** Injectable child spawner -- real `execa` (`defaultSpawnChild`) unless
   *  a test overrides it. See `SpawnChildFn`. */
  spawnChild?: SpawnChildFn;
  /** Injectable readiness probe -- real `waitForHttp` (`defaultCheckReady`)
   *  unless a test overrides it. See `CheckReadyFn`. */
  checkReady?: CheckReadyFn;
}

/**
 * Owns one child process per configured box: spawns it, waits for
 * `/healthz` to answer, restarts it with backoff on unexpected exit (up to
 * `MAX_CONSECUTIVE_FAILURES`), and tears every child down cleanly on
 * `stopAll()`.
 */
export class Supervisor implements EndpointProvider {
  private readonly boxes = new Map<string, ManagedBox>();
  private readonly config: HubConfig;
  private readonly hubSecret: string;
  private readonly spawnChild: SpawnChildFn;
  private readonly checkReady: CheckReadyFn;

  constructor(options: SupervisorOptions) {
    this.config = options.config;
    this.hubSecret = options.hubSecret;
    this.spawnChild = options.spawnChild ?? defaultSpawnChild;
    this.checkReady = options.checkReady ?? defaultCheckReady;
    for (const [slug, entry] of Object.entries(options.config.boxes)) {
      this.boxes.set(slug, {
        slug,
        entry,
        status: "starting",
        child: undefined,
        port: undefined,
        restarts: 0,
        consecutiveFailures: 0,
        lastError: undefined,
        generation: 0,
        restartTimer: undefined,
        expectedExitGeneration: undefined,
      });
    }
  }

  /** Start every configured box and wait for each to answer `/healthz`
   *  (or exhaust its restart budget). Never rejects -- a box that fails to
   *  come up is reported via `getStatuses()`, not thrown. */
  async startAll(): Promise<void> {
    await Promise.all(Array.from(this.boxes.values()).map((box) => this.launch(box)));
  }

  /** SIGTERM every live child, SIGKILL any survivor after the grace
   *  period, same discipline as the dev router's teardown. */
  async stopAll(): Promise<void> {
    const boxes = Array.from(this.boxes.values());
    for (const box of boxes) {
      if (box.restartTimer) clearTimeout(box.restartTimer);
      box.status = "stopped";
    }
    const pids = boxes.map((box) => box.child?.pid).filter((pid): pid is number => pid !== undefined);
    for (const pid of pids) killGroup(pid, "SIGTERM");
    if (pids.length === 0) return;
    await sleep(KILL_GRACE_MS);
    for (const pid of pids) killGroup(pid, "SIGKILL");
  }

  /** SIGHUP handling: give any crash-looped ("unhealthy") box a fresh
   *  restart budget and try again. Does not re-read `hub.json` -- adding
   *  or removing boxes still requires a hub restart; this only clears the
   *  "stop retrying" latch the plan calls for. */
  reloadUnhealthy(): void {
    for (const box of this.boxes.values()) {
      if (box.status !== "unhealthy") continue;
      box.consecutiveFailures = 0;
      box.lastError = undefined;
      void this.launch(box);
    }
  }

  get(slug: string): Endpoint | undefined {
    const box = this.boxes.get(slug);
    if (!box || box.status !== "running" || box.port === undefined) return undefined;
    return { slug, origin: `http://127.0.0.1:${box.port}` };
  }

  slugs(): string[] {
    return Array.from(this.boxes.keys());
  }

  getStatuses(): BoxRuntimeStatus[] {
    return Array.from(this.boxes.values()).map((box) => ({
      slug: box.slug,
      status: box.status,
      pid: box.child?.pid,
      port: box.port,
      restarts: box.restarts,
      lastError: box.lastError,
    }));
  }

  private async launch(box: ManagedBox): Promise<void> {
    box.status = "starting";
    const generation = ++box.generation;
    try {
      const boxRoot = await resolveBoxRoot(box.entry.path);
      const shape = await getBoxShape(boxRoot);
      const cbBinary = await resolveCbBinary(shape);
      const port = await getPorts();

      const env = buildChildEnv({ sourceEnv: process.env, hubExtras: { CB_HUB_SECRET: this.hubSecret } });
      const child = this.spawnChild({
        cbBinary,
        args: ["serve", boxRoot, "--slug", box.slug, "--port", String(port)],
        cwd: shape.packageRoot,
        env,
      });
      // Swallow the execa promise rejection here (not just via .on("exit")) --
      // otherwise a killed child's eventual rejection surfaces minutes later
      // as an unhandledRejection and crashes the hub. Same fix router.ts
      // applies to its vite/fastify children.
      child.catch(() => { /* handled via onExit below */ });

      box.child = child;
      box.port = port;

      child.on("exit", (code, signal) => {
        this.onChildExit({ box, generation, code, signal });
      });

      await this.checkReady({ port, label: `box/${box.slug}` });
      if (box.generation !== generation) return; // superseded mid-startup
      box.status = "running";
      box.consecutiveFailures = 0;
      box.lastError = undefined;
    } catch (e) {
      if (box.generation !== generation) return; // superseded mid-startup
      const message = describeError(e);
      box.lastError = message;
      box.consecutiveFailures += 1;
      if (box.child) {
        // We're about to kill this generation's child ourselves (e.g. a
        // readiness timeout) -- mark the exit that kill will eventually
        // produce as "expected" so onChildExit doesn't ALSO treat it as an
        // unexpected crash and schedule a second, overlapping restart. Set
        // BEFORE killGroup() so there's no window for the exit event (which
        // can fire synchronously in tests, and fast in practice) to arrive
        // unguarded.
        box.expectedExitGeneration = generation;
        killGroup(box.child.pid, "SIGTERM");
        setTimeout(() => killGroup(box.child?.pid, "SIGKILL"), KILL_GRACE_MS).unref();
      }
      box.child = undefined;
      box.port = undefined;
      this.markFailedOrScheduleRestart(box);
    }
  }

  private onChildExit(params: {
    box: ManagedBox;
    generation: number;
    code: number | null;
    signal: NodeJS.Signals | null;
  }): void {
    const { box, generation, code, signal } = params;
    if (box.generation !== generation) return; // stale exit from a superseded generation
    if (box.status === "stopped") return; // expected -- stopAll() is tearing down
    if (box.expectedExitGeneration === generation) {
      // This generation's child was killed by launch()'s own
      // readiness-timeout catch block, which already recorded the failure
      // and scheduled the restart -- without this guard the same failure
      // gets double-counted and a second, overlapping child gets spawned.
      box.expectedExitGeneration = undefined;
      return;
    }
    box.lastError = `child exited unexpectedly (code=${String(code)}, signal=${String(signal)})`;
    box.consecutiveFailures += 1;
    box.child = undefined;
    box.port = undefined;
    this.markFailedOrScheduleRestart(box);
  }

  private markFailedOrScheduleRestart(box: ManagedBox): void {
    if (box.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      box.status = "unhealthy";
      return;
    }
    box.status = "starting";
    box.restarts += 1;
    const delay = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** (box.consecutiveFailures - 1));
    box.restartTimer = setTimeout(() => {
      void this.launch(box);
    }, delay);
    box.restartTimer.unref();
  }
}

function describeError(e: unknown): string {
  if (e instanceof HttpReadinessTimeoutError) return e.message;
  return e instanceof Error ? e.message : String(e);
}
