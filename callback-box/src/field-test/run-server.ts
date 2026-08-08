/**
 * Field-test server lifecycle — the "dedicated `cb serve`" half of a run
 * (`docs/plans/agent-field-tests.md`, Track 2).
 *
 * A run owns one server on a port nobody else has: allocate a free port, spawn
 * `cb serve` on it with the run's env overlay (`CB_TIME`,
 * `CB_BROWSE_API_KEY`, later `CB_FAKE_GMAIL`), wait until it actually answers
 * HTTP, and be able to kill it dead. No activity-loop logic lives here — the
 * loop drives this module, never the other way round.
 *
 * The process mechanics (kill the whole group, then verify) are the hub
 * supervisor's, reused rather than re-derived: `src/hub/child-process-utils.ts`
 * exists as shared supervision primitives. The readiness probe is NOT
 * `waitForHttp` — that one accepts any HTTP response, deliberately, because a
 * hub child's `/healthz` may legitimately answer 401/503 while healthy. A
 * field run's operator is about to drive this origin with a browser, so
 * readiness here has to prove the box is served by THIS child (see
 * `probeReady`).
 */

import { execa, type ResultPromise } from "execa";
import * as net from "node:net";
import { randomBytes } from "node:crypto";
import { sleep } from "../lib/sleep.js";
import { errorMessage } from "../lib/error-guards.js";
import { killGroup, pidAlive } from "../hub/child-process-utils.js";
import { cbBinary, type FieldBox } from "./run-box.js";

/** How long a run waits for `cb serve` to answer `/` before giving up. The
 *  server builds no assets at startup; 30s is generous headroom for a cold
 *  CLI-bundle rebuild on the first spawn after a source change. */
const READY_TIMEOUT_MS = 30_000;
const READY_POLL_MS = 150;
/** Grace period between SIGTERM and SIGKILL during teardown. */
const KILL_GRACE_MS = 2000;
/** Keep only the tail of the child's output — a failing server can be chatty,
 *  and only the end of it says why it died. */
const CAPTURED_OUTPUT_LIMIT = 8000;

export interface FieldServerOptions {
  /** Env overlay for the child, merged over this process's env. */
  env: NodeJS.ProcessEnv;
  /** Override the readiness timeout (tests use a short one). */
  readyTimeoutMs?: number | undefined;
  /**
   * Bind this exact port instead of allocating a free one.
   *
   * A run RESTARTS its server — after a `reset` cleanup and at every simulated
   * day boundary — and the operator's base URL is baked into a system prompt
   * written once, at the start of the run. A restart on a fresh port would
   * leave the persona driving a browser at a dead port with no way to learn
   * the new one, so a run allocates once and re-binds the same port. If the
   * old child has not released it, the readiness probe fails loudly rather
   * than the run continuing against nothing.
   */
  port?: number | undefined;
}

export interface FieldServer {
  port: number;
  /** `http://127.0.0.1:<port>` — the server's own origin. */
  origin: string;
  /** `<origin>/<slug>` — the box's URL base, i.e. what `BROWSE_BASE_URL`
   *  wants so browse's `/`-leading paths land in THIS run's box. */
  baseUrl: string;
  /** The `CB_DIAG_API_KEY` this server was started with — a per-run random
   *  value unless the caller supplied one. The harness needs it to query the
   *  box's diagnostics (quiescence checks, Track 2 chunk 2). */
  diagKey: string;
  pid: number | undefined;
  /** Terminate the server: SIGTERM to the process group, SIGKILL after a
   *  grace period, then wait for the child to be reaped. Idempotent. */
  stop(): Promise<void>;
}

export class FieldServerStartError extends Error {
  constructor({ port, reason, output }: { port: number; reason: string; output: string }) {
    super(`cb serve on port ${String(port)} ${reason}\n--- child output ---\n${output}`);
    this.name = "FieldServerStartError";
  }
}

/**
 * A port the OS says is free right now: bind `:0`, read what was assigned,
 * release it. Inherently a TOCTOU window — nothing stops another process
 * taking the port between release and spawn — which is why the caller's
 * readiness probe is the real check, and its failure is loud.
 */
export async function allocateFreePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new FreePortError(String(address)));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

export class FreePortError extends Error {
  constructor(address: string) {
    super(`Could not read an assigned TCP port from a :0 listener (address was ${address})`);
    this.name = "FreePortError";
  }
}

/**
 * Readiness probe: the box-scoped `health.check` tRPC query, authenticated
 * with the per-run diagnostic key.
 *
 * Deliberately NOT a bare 200 on `/`. A free port is a TOCTOU promise (see
 * `allocateFreePort`), and `/` answers 200 from any web server that won the
 * race — a run would then hand its operator a browser pointed at somebody
 * else's app. This URL proves both halves: only THIS child knows the random
 * key (`CB_DIAG_API_KEY`, minted per run below), and only a server with this
 * box mounted under this slug routes the path at all. `health.check` and
 * `debugLog.get` are the two procedures the diag-key bypass whitelists
 * (`src/webapp/auth.ts`).
 */
async function probeReady({ url, diagKey }: { url: string; diagKey: string }): Promise<boolean> {
  try {
    const response = await fetch(url, {
      redirect: "manual",
      headers: { Authorization: `Bearer ${diagKey}` },
    });
    // Drain so the socket is released rather than left half-read.
    await response.text();
    return response.status === 200;
  } catch (_e) {
    // Pre-listen ECONNREFUSED is the expected steady state of this loop until
    // the server is up; logging every poll would be the noise this codebase
    // treats as a bug. A genuine failure surfaces as the timeout error below,
    // which carries the child's own output.
    return false;
  }
}

/** One captured-output sink for both child streams, capped at the tail. */
function captureOutput(child: ResultPromise, onChunk: (text: string) => void): void {
  for (const stream of [child.stdout, child.stderr]) {
    stream?.on("data", (chunk: Buffer) => onChunk(chunk.toString("utf-8")));
  }
}

/**
 * Start `cb serve` for `box` on a freshly allocated port and return once the
 * box answers its authenticated health query. Throws `FieldServerStartError`
 * (carrying the child's captured output) if the child exits early or never
 * becomes ready; the child is killed before the throw, so a failed start
 * leaves no process behind.
 */
export async function startFieldServer(box: FieldBox, options: FieldServerOptions): Promise<FieldServer> {
  const port = options.port ?? (await allocateFreePort());
  // `--host 127.0.0.1` rather than `cb serve`'s "localhost" default, so the
  // interface the server binds is exactly the one this module probes and
  // hands the operator (a "localhost" that resolves to ::1 first would have
  // them disagree).
  const origin = `http://127.0.0.1:${String(port)}`;
  // Per-run diagnostic key: this is what makes readiness provably OUR child
  // (see probeReady). A caller-supplied one wins — the harness may want the
  // same key across a day-advance restart.
  const diagKey = options.env["CB_DIAG_API_KEY"] ?? randomBytes(24).toString("hex");

  const child = execa(
    cbBinary(),
    ["serve", box.packageRoot, "--port", String(port), "--host", "127.0.0.1", "--slug", box.slug],
    {
      cwd: box.packageRoot,
      env: { ...process.env, ...options.env, CB_DIAG_API_KEY: diagKey },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
      cleanup: true,
    }
  );

  let output = "";
  captureOutput(child, (text) => {
    output = (output + text).slice(-CAPTURED_OUTPUT_LIMIT);
  });

  // Held in an object, not two `let`s: the only writers are callbacks, and a
  // `let` written only from a callback narrows to its initializer type at
  // every read site, which is a lie here.
  const state: ChildState = { exit: null, failure: null };
  const hasExited = (): boolean => state.exit !== null;
  child.on("exit", (code, signal) => {
    state.exit = { code, signal };
  });
  // The execa promise rejects on a non-zero exit or a kill; the `exit` event
  // above is what the start path reads, so absorb the rejection here rather
  // than leaving it unhandled — keeping its message as extra context for the
  // failure report.
  const settled: Promise<void> = child.then(
    () => {
      state.failure = null;
    },
    (e: unknown) => {
      state.failure = errorMessage(e);
    }
  );

  const server: FieldServer = {
    port,
    origin,
    baseUrl: `${origin}/${box.slug}`,
    diagKey,
    pid: child.pid,
    stop: async () => {
      // Read the flag through a call so the narrowing from one check doesn't
      // convince the compiler the next one is dead code — the writer is the
      // `exit` callback above, which TS's control flow can't see.
      if (!hasExited()) {
        killGroup(child.pid, "SIGTERM");
        const deadline = Date.now() + KILL_GRACE_MS;
        while (!hasExited() && Date.now() < deadline) {
          await sleep(50);
        }
        if (!hasExited()) killGroup(child.pid, "SIGKILL");
      }
      await settled;
    },
  };

  const timeoutMs = options.readyTimeoutMs ?? READY_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const exit = state.exit;
    if (exit !== null) {
      await server.stop();
      throw new FieldServerStartError({ port, reason: describeExit(exit, state.failure), output });
    }
    if (await probeReady({ url: `${server.baseUrl}/api/trpc/health.check`, diagKey })) return server;
    await sleep(READY_POLL_MS);
  }

  await server.stop();
  throw new FieldServerStartError({
    port,
    reason: `did not serve box "${box.slug}" within ${String(timeoutMs)}ms`,
    output,
  });
}

interface ChildExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

interface ChildState {
  exit: ChildExit | null;
  /** The execa rejection's message, when the child failed rather than being
   *  killed by us — extra context only; `exit` is the authority. */
  failure: string | null;
}

function describeExit(exit: ChildExit, failure: string | null): string {
  const detail = failure === null ? "" : ` (${failure})`;
  if (exit.signal !== null) return `exited on signal ${exit.signal} before becoming ready${detail}`;
  return `exited with code ${String(exit.code)} before becoming ready${detail}`;
}

/** Whether a stopped server's process is really gone. Exported for the
 *  lifecycle doctest's teardown assertion. */
export function serverProcessAlive(server: FieldServer): boolean {
  return server.pid !== undefined && pidAlive(server.pid);
}
