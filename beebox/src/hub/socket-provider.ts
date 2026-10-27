/**
 * The endpoint provider for a unit host: every box is a systemd socket unit
 * (`beebox-box@<slug>.socket`, docs/implemented-plans/per-box-units.md Track D), and the
 * hub neither spawns nor stops anything. It polls unit state in one batched
 * `systemctl list-units` call, connects to a box's socket to wake it (the
 * connection is what starts the service), and remembers the last readiness
 * result so `get()` and `unavailable()` stay synchronous and never run a
 * command on the request path.
 *
 * `get()` answers from the polled map: a box is routable when its unit is
 * active and a readiness probe over its socket has answered. A WebSocket
 * upgrade therefore never wakes a sleeping box (the hub's WS handler calls
 * `get()` alone), while `ensureRunning()`, on the HTTP path, connects and
 * waits up to the readiness bound. State names mirror systemd's.
 *
 * A crashing box is retried by systemd, not here: the unit restarts itself with
 * a growing delay and has no start limit (deploy/systemd/beebox-box@.service).
 * While it waits out a delay, its sub-state is `auto-restart`; the hub reports
 * that as a crash loop (503 with the last journal line) and does not wait on
 * the socket, which cannot answer until systemd's delay has passed.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import type { HubConfig } from "./config.js";
import type { Endpoint, EndpointProvider } from "./endpoints.js";
import { fetchEndpoint } from "./endpoint-fetch.js";
import { readHubMeta } from "../core/hub-meta.js";
import { errorMessage } from "../shared/error-guards.js";
import type { BoxRuntimeStatus, BoxRunStatus } from "./box-status.js";
import { invariant, assertNever } from "../shared/invariant.js";

const run = promisify(execFile);

/** `systemctl list-units --output=json` rows; `active` is the ActiveState. */
const unitRowSchema = z.object({ unit: z.string(), active: z.string(), sub: z.string() });
const unitListSchema = z.array(unitRowSchema);

export type UnitState = "active" | "activating" | "deactivating" | "inactive" | "failed" | "auto-restart" | "unknown";

export interface SocketBox {
  slug: string;
  boxRoot: string;
  socketPath: string;
  state: UnitState;
  /** The last readiness probe over the socket answered. Reset when the unit leaves `active`. */
  ready: boolean;
  /** A failed or restarting unit's last journal line, fetched once per failure for the hub's 503. */
  lastJournal: string | undefined;
  /** A cold start in flight, so concurrent requests await one probe. */
  waking: Promise<Endpoint | undefined> | undefined;
  lastError: string | undefined;
}

/** Injectable command runner: `systemctl` and `journalctl` in production, a fake in tests. */
export type CommandRunner = (command: string, args: string[]) => Promise<string>;

export const defaultCommandRunner: CommandRunner = async (command, args) => (await run(command, args, { timeout: 10_000 })).stdout;

export interface SocketProviderOptions {
  config: HubConfig;
  runCommand?: CommandRunner;
  /** Probe one box over its socket; the default fetches `/api/build-info` (or `/healthz` with the diag key). */
  probe?: (endpoint: Endpoint) => Promise<boolean>;
  pollMs?: number;
  readyTimeoutMs?: number;
}

const POLL_MS = 2_000;
const READY_TIMEOUT_MS = 30_000;
const PROBE_TIMEOUT_MS = 2_000;
const READY_POLL_MS = 100;

export async function defaultProbe(endpoint: Endpoint): Promise<boolean> {
  const key = process.env.BBX_DIAG_API_KEY;
  try {
    const response = await fetchEndpoint(endpoint, {
      path: key ? "/healthz" : "/api/build-info",
      ...(key ? { headers: { authorization: `Bearer ${key}` } } : {}),
      timeoutMs: PROBE_TIMEOUT_MS,
    });
    return response.status === 200;
  } catch (_e) {
    // Refused, reset, or timed out: not ready yet. The caller bounds the retries.
    return false;
  }
}

/** systemd's ActiveState, except a unit waiting to restart after a crash (sub-state `auto-restart` or, since v254, `auto-restart-queued`). */
export function unitStateOf(active: string, sub: string): UnitState {
  if (sub.startsWith("auto-restart")) return "auto-restart";
  switch (active) {
    case "active": case "activating": case "deactivating": case "inactive": case "failed":
      return active;
    default:
      return "unknown";
  }
}

/** systemd's state as the hub's health vocabulary (`hub/health.ts`). */
function runStatusOf(state: UnitState): BoxRunStatus {
  switch (state) {
    case "active": return "running";
    case "activating": return "starting";
    case "deactivating": case "inactive": case "unknown": return "stopped";
    case "failed": return "unhealthy";
    // With a nonzero `consecutiveFailures` this is a crash loop to `hub/health.ts`.
    case "auto-restart": return "starting";
    default: return assertNever(state);
  }
}

export class SocketProvider implements EndpointProvider {
  private readonly boxes = new Map<string, SocketBox>();
  private readonly runCommand: CommandRunner;
  private readonly probe: (endpoint: Endpoint) => Promise<boolean>;
  private readonly pollMs: number;
  private readonly readyTimeoutMs: number;
  private timer: NodeJS.Timeout | undefined;

  constructor(options: SocketProviderOptions) {
    this.runCommand = options.runCommand ?? defaultCommandRunner;
    this.probe = options.probe ?? defaultProbe;
    this.pollMs = options.pollMs ?? POLL_MS;
    this.readyTimeoutMs = options.readyTimeoutMs ?? READY_TIMEOUT_MS;
    for (const [slug, entry] of Object.entries(options.config.boxes)) {
      invariant(entry.socket !== undefined, "a SocketProvider is built only from a unit-host config (every entry has a socket)");
      this.boxes.set(slug, { slug, boxRoot: entry.path, socketPath: entry.socket, state: "unknown", ready: false, lastJournal: undefined, waking: undefined, lastError: undefined });
    }
  }

  /**
   * First poll, a readiness pass over every unit already active (a hub-only
   * restart must not refuse WebSockets to a running box), then the periodic
   * poll, then one GET to each box whose metadata says a chat schedule is
   * pending, so check-ins re-arm after a reboot.
   */
  async start(): Promise<void> {
    await this.poll();
    for (const box of this.boxes.values()) {
      if (box.state === "active") box.ready = await this.probe(this.endpointOf(box));
    }
    this.timer = setInterval(() => { void this.poll().catch((e: unknown) => console.warn(`[hub] unit poll failed: ${errorMessage(e)}`)); }, this.pollMs);
    this.timer.unref();
    for (const box of this.boxes.values()) {
      if (readHubMeta(box.boxRoot)?.pendingSchedules === true && !box.ready) {
        console.log(`[hub] waking box "${box.slug}": it holds a pending chat schedule`);
        void this.ensureRunning(box.slug).catch((e: unknown) => console.warn(`[hub] could not wake "${box.slug}": ${errorMessage(e)}`));
      }
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** One `systemctl list-units` for every box unit; a failing unit's last journal line is fetched once. */
  async poll(): Promise<void> {
    const output = await this.runCommand("systemctl", ["list-units", "beebox-box@*.service", "--all", "--output=json", "--no-pager", "--plain"]);
    const rows = unitListSchema.parse(JSON.parse(output === "" ? "[]" : output));
    const seen = new Map<string, UnitState>();
    for (const row of rows) {
      const match = /^beebox-box@(.+)\.service$/.exec(row.unit);
      if (match?.[1] !== undefined) seen.set(match[1], unitStateOf(row.active, row.sub));
    }
    for (const box of this.boxes.values()) {
      const state = seen.get(box.slug) ?? "inactive";
      const was = box.state;
      box.state = state;
      if (state !== "active") box.ready = false;
      const failing = state === "failed" || state === "auto-restart";
      if (failing && was !== state) {
        box.lastJournal = await this.lastJournalLine(box.slug);
        const what = state === "failed" ? "unit failed" : "unit crashed and is waiting to restart";
        box.lastError = `${what}${box.lastJournal === undefined ? "" : `: ${box.lastJournal}`}`;
      }
      if (!failing) box.lastJournal = undefined;
    }
  }

  private async lastJournalLine(slug: string): Promise<string | undefined> {
    try {
      const line = (await this.runCommand("journalctl", ["-u", `beebox-box@${slug}.service`, "-n", "1", "--no-pager", "-o", "cat"])).trim();
      return line === "" ? undefined : line;
    } catch (e) {
      return `journal unavailable: ${errorMessage(e)}`;
    }
  }

  private endpointOf(box: SocketBox): Endpoint {
    return { slug: box.slug, origin: "http://localhost", socketPath: box.socketPath };
  }

  get(slug: string): Endpoint | undefined {
    const box = this.boxes.get(slug);
    if (!box || box.state !== "active" || !box.ready) return undefined;
    return this.endpointOf(box);
  }

  slugs(): string[] { return Array.from(this.boxes.keys()); }

  /**
   * Connect to the socket (which starts the unit) and wait for readiness, up
   * to the bound. Concurrent callers share one wake. A unit that is `failed`
   * or waiting to restart is not poked: systemd's restart delay owns it.
   */
  async ensureRunning(slug: string): Promise<Endpoint | undefined> {
    const box = this.boxes.get(slug);
    if (!box) return undefined;
    const live = this.get(slug);
    if (live) return live;
    if (this.isFailing(box)) return undefined;
    if (box.waking) return box.waking;
    box.waking = this.wake(box).finally(() => { box.waking = undefined; });
    return box.waking;
  }

  private isFailing(box: SocketBox): boolean {
    return box.state === "failed" || box.state === "auto-restart";
  }

  private async wake(box: SocketBox): Promise<Endpoint | undefined> {
    const endpoint = this.endpointOf(box);
    const deadline = Date.now() + this.readyTimeoutMs;
    while (Date.now() < deadline) {
      // A poll saw the unit crash while this wake waited: its journal line is
      // the answer, not a probe timeout.
      if (this.isFailing(box)) return undefined;
      if (await this.probe(endpoint)) {
        box.ready = true;
        box.state = "active";
        box.lastError = undefined;
        return endpoint;
      }
      await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
    }
    box.lastError = `box/${box.slug} did not answer on ${box.socketPath} within ${String(this.readyTimeoutMs)} ms (unit ${box.state})`;
    return undefined;
  }

  unavailable(slug: string): string | undefined {
    const box = this.boxes.get(slug);
    if (!box || this.get(slug)) return undefined;
    return box.lastError ?? `unit ${box.state}`;
  }

  getStatuses(): BoxRuntimeStatus[] {
    return Array.from(this.boxes.values()).map((box) => ({
      slug: box.slug,
      status: runStatusOf(box.state),
      pid: undefined,
      port: undefined,
      restarts: 0,
      consecutiveFailures: box.state === "failed" || box.state === "auto-restart" ? 1 : 0,
      lastError: box.lastError,
      lastStart: undefined,
    }));
  }
}
