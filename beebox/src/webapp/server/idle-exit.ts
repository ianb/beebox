/**
 * Idle exit for a socket-activated box (`bbx engine serve --idle-exit <ms>`).
 *
 * Under a `beebox-box@<slug>` unit nobody stops an idle engine but itself: the
 * hub only routes, and systemd keeps the socket listening so the next
 * connection starts a fresh instance. The decision is a pure function of the
 * activity ledger below; the exit is a drain, never a cut: stop accepting,
 * let every accepted request finish (unbounded, the engine's own request
 * timeouts are the bound), then the ordinary clean shutdown with exit 0 so
 * `Restart=on-failure` leaves it down.
 *
 * `box-admission.ts`'s `boxRequestsAreIdle` is not reused on purpose: it counts
 * only requests that take box work (no plain GETs), a maintenance quiescence
 * signal, not an activity signal.
 */

import type { FastifyInstance } from "fastify";
import type { BoxSpec } from "../server-types.js";
import { getChatRuntime } from "../chat-runtime.js";
import { loadChatSchedules } from "../../core/chat/schedules/core.js";
import { localBackupCommandActive } from "../../core/box-backup/local-runner.js";

export interface IdleSignals {
  /** When the last request began, the last socket opened or closed, in ms since the epoch. */
  lastActivityAt: number;
  /** HTTP requests accepted and not yet finished (every method). */
  inFlight: number;
  /** Upgraded connections (tRPC subscriptions, the transcription proxy) still open. */
  openSockets: number;
  /** Chat sessions with a running or busy subprocess. */
  liveRuns: number;
  /** Unfired chat schedules on disk, overdue ones included: they fire from this process. */
  pendingSchedules: number;
}

export type IdleDecision =
  | { exit: true }
  | { exit: false; keptBy: "recent-activity" | "in-flight" | "open-sockets" | "live-runs" | "pending-schedules" };

/** The one rule. Exported so a test can drive it without a server or a clock. */
export function decideIdle(signals: IdleSignals, clock: { now: number; idleMs: number }): IdleDecision {
  if (signals.inFlight > 0) return { exit: false, keptBy: "in-flight" };
  if (signals.openSockets > 0) return { exit: false, keptBy: "open-sockets" };
  if (signals.liveRuns > 0) return { exit: false, keptBy: "live-runs" };
  if (signals.pendingSchedules > 0) return { exit: false, keptBy: "pending-schedules" };
  if (clock.now - signals.lastActivityAt < clock.idleMs) return { exit: false, keptBy: "recent-activity" };
  return { exit: true };
}

/** Counts requests and upgraded sockets on a Fastify server; reads the chat state when asked. */
export class ActivityLedger {
  private lastActivityAt: number;
  private inFlight = 0;
  private openSockets = 0;

  private readonly server: FastifyInstance;
  private readonly boxes: BoxSpec[];
  private readonly now: () => number;

  constructor(params: { server: FastifyInstance; boxes: BoxSpec[]; now: () => number }) {
    this.server = params.server;
    this.boxes = params.boxes;
    this.now = params.now;
    this.lastActivityAt = params.now();
  }

  /** Attach to the raw Node server: these listeners sit beside Fastify's own
   *  and @fastify/websocket's (Node emits to every listener), so they can be
   *  added after the instance is listening, which Fastify's hooks cannot. */
  install(): void {
    this.server.server.on("request", (_request, response) => {
      this.inFlight += 1;
      this.lastActivityAt = this.now();
      // The response closes however the request ends: sent, hijacked, or
      // abandoned by the client.
      response.once("close", () => { this.inFlight -= 1; });
    });
    this.server.server.on("upgrade", (_request, socket) => {
      this.openSockets += 1;
      this.lastActivityAt = this.now();
      socket.once("close", () => {
        this.openSockets -= 1;
        this.lastActivityAt = this.now();
      });
    });
  }

  signals(): IdleSignals {
    let liveRuns = localBackupCommandActive() ? 1 : 0;
    let pendingSchedules = 0;
    for (const box of this.boxes) {
      const runtime = getChatRuntime(box.boxRoot);
      if (runtime) liveRuns += runtime.registry.snapshotAll().filter((session) => session.running || session.busy).length;
      pendingSchedules += loadChatSchedules({ boxRoot: box.boxRoot }).length;
    }
    return { lastActivityAt: this.lastActivityAt, inFlight: this.inFlight, openSockets: this.openSockets, liveRuns, pendingSchedules };
  }
}

const CHECK_EVERY_MS = 15_000;
const DRAIN_POLL_MS = 250;

/**
 * Arm the idle check. `onIdle` runs once, after the listener is closed and
 * every accepted request has finished; it is expected to end the process.
 */
export function installIdleExit(params: {
  server: FastifyInstance;
  boxes: BoxSpec[];
  idleMs: number;
  onIdle: () => void;
  now?: () => number;
  checkEveryMs?: number;
}): ActivityLedger {
  const now = params.now ?? Date.now;
  const ledger = new ActivityLedger({ server: params.server, boxes: params.boxes, now });
  ledger.install();
  let draining = false;
  const timer = setInterval(() => {
    if (draining) return;
    const decision = decideIdle(ledger.signals(), { now: now(), idleMs: params.idleMs });
    if (!decision.exit) return;
    draining = true;
    clearInterval(timer);
    console.log(`Idle for ${String(params.idleMs)} ms; stopping and draining.`);
    // Stop accepting. Under socket activation this closes our copy of the
    // listening descriptor; systemd's keeps the queue, and the next instance
    // serves what arrives from here on.
    params.server.server.close();
    params.server.server.closeIdleConnections();
    const drain = setInterval(() => {
      if (ledger.signals().inFlight > 0) return;
      clearInterval(drain);
      params.onIdle();
    }, DRAIN_POLL_MS);
  }, params.checkEveryMs ?? Math.min(CHECK_EVERY_MS, params.idleMs));
  timer.unref();
  return ledger;
}
