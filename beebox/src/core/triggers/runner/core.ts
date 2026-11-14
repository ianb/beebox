/**
 * The trigger runner: one per box in the server. It evaluates a session's
 * armed activations when the session's activity settles (1 s after the
 * latest batch, at most 3 s after the first pending one), on each
 * activation's tick while someone is present, and marks activations expired
 * at their deadline. Admission, delivery and the state write happen inside
 * one hold of the session's trigger lock, so a disarm during a judge call
 * either lands before admission (the result is dropped as `stale`) or after
 * the write (the message is already in the chat).
 *
 * Every dependency with a side effect is injected (timers, the evaluation
 * child, delivery, presence, the clock), so the unit tier runs it with fake
 * timers and a fake child. See docs/implemented-plans/activity-triggers.md, Track C.
 */

import { readActivity } from "../../activity/log.js";
import { entriesForSession, readCursor } from "../../activity/cursor.js";
import type { ActivityLine } from "../../activity/entry.js";
import { livePresence } from "../../notification/presence.js";
import { getBoxTime } from "../../../lib/time.js";
import {
  expiryOf,
  listActivations,
  listAllActivations,
  readActivationFile,
  TERMINAL_STATES,
  updateActivationsLocked,
  withTriggerLock,
  type Activation,
} from "../activation.js";
import { evaluateInChild, type Evaluate, type EvalOutput } from "../eval.js";
import type { EvalJob } from "../eval-child/core.js";
import { appendTrace, type TraceLine, type TraceOutcome } from "../trace.js";
import { HISTORY_CAP, type TriggerReason } from "../types.js";
import { admitResult, settleDelivery, type Deliver } from "./admit.js";

export { FIRE_FLOOR_MS } from "./admit.js";

/** Evaluate this long after the latest activity batch… */
export const SETTLE_MS = 1000;
/** …but no later than this long after the first pending batch. */
export const SETTLE_CAP_MS = 3000;
/** Injected timers: `after` runs `fn` once after `ms` and returns a cancel. */
export interface RunnerTimers {
  after: (ms: number, fn: () => void) => () => void;
}

export const realTimers: RunnerTimers = {
  after: (ms, fn) => {
    const handle = setTimeout(fn, ms);
    handle.unref();
    return () => { clearTimeout(handle); };
  },
};

export interface RunnerDeps {
  boxRoot: string;
  /** Run one evaluation (a child process, or a fake). */
  evaluate?: Evaluate;
  /** Deliver a fire to the session; see {@link Deliver}. */
  deliver: Deliver;
  /** How many web sessions are live in the box. */
  presence?: () => Promise<number>;
  /** Emit `trigger-changed` for the session. */
  emit: (sessionId: string) => void;
  timers?: RunnerTimers;
  now?: () => Date;
  readLog?: () => Promise<ActivityLine[]>;
}

interface Pending {
  firstAt: number;
  cancel: () => void;
}

interface Tick {
  cancel: () => void;
  /** Whether the last tick was skipped for absence, so the trace says so once. */
  skippedForAbsence: boolean;
}

export class TriggerRunner {
  private readonly deps: Required<RunnerDeps>;
  private readonly pending = new Map<string, Pending>();
  private readonly inFlight = new Set<string>();
  private readonly rearm = new Set<string>();
  private readonly ticks = new Map<string, Tick>();
  private readonly deadlines = new Map<string, () => void>();
  private readonly work = new Set<Promise<void>>();
  private stopped = false;

  constructor(deps: RunnerDeps) {
    const { boxRoot } = deps;
    this.deps = {
      ...deps,
      evaluate: deps.evaluate ?? ((job) => evaluateInChild(job)),
      presence: deps.presence ?? (async () => (await livePresence(boxRoot)).activeWeb),
      timers: deps.timers ?? realTimers,
      now: deps.now ?? (() => getBoxTime(boxRoot)),
      readLog: deps.readLog ?? (() => readActivity(boxRoot)),
    };
  }

  /** Start timers for every armed activation in the box. */
  async boot(): Promise<void> {
    for (const sessionId of (await listAllActivations(this.deps.boxRoot, { now: this.deps.now() })).keys()) await this.reload(sessionId);
  }

  /** Re-read a session's activations and set its tick and deadline timers to match; expiries found are written and announced. */
  async reload(sessionId: string): Promise<void> {
    if (this.stopped) return;
    const who = { boxRoot: this.deps.boxRoot, sessionId };
    const read = await readActivationFile(who);
    const now = this.deps.now();
    if (read.activations.some((a) => expiryOf(a, now) !== null)) await this.expire(sessionId);
    const activations = read.invalid ? [] : await listActivations(who, { now });
    const live = new Set<string>();
    for (const a of activations) {
      if (TERMINAL_STATES.includes(a.state)) continue;
      live.add(a.id);
      if (a.tick !== undefined && !this.ticks.has(a.id)) this.scheduleTick(sessionId, a);
      if (a.deadline !== null && !this.deadlines.has(a.id)) {
        const delay = Math.max(0, Date.parse(a.deadline) - now.getTime());
        this.deadlines.set(a.id, this.deps.timers.after(delay, () => { this.track(() => this.expire(sessionId), "expiry"); }));
      }
    }
    for (const [id, tick] of this.ticks) if (!live.has(id) && activations.some((a) => a.id === id)) { tick.cancel(); this.ticks.delete(id); }
    for (const [id, cancel] of this.deadlines) if (!live.has(id) && activations.some((a) => a.id === id)) { cancel(); this.deadlines.delete(id); }
  }

  /** Activity landed for these sessions: start or push back each one's settle timer. */
  async onActivity(sessionIds: Iterable<string>): Promise<void> {
    if (this.stopped) return;
    for (const sessionId of new Set(sessionIds)) {
      if (!(await this.hasLive(sessionId))) continue;
      this.schedule(sessionId);
    }
  }

  /** Resolves once every evaluation, tick and expiry the runner started has finished. For tests and shutdown. */
  async idle(): Promise<void> {
    while (this.work.size > 0) await Promise.allSettled([...this.work]);
  }

  /** Run `fn` as tracked work; its failure is logged, never thrown. */
  private track(fn: () => Promise<void>, what: string): void {
    const p = fn().catch((e: unknown) => { console.warn(`[triggers] ${what} failed:`, e); }).finally(() => { this.work.delete(p); });
    this.work.add(p);
  }

  /** Cancel every timer. Evaluations in flight finish and write their outcome. */
  stop(): void {
    this.stopped = true;
    for (const p of this.pending.values()) p.cancel();
    this.pending.clear();
    for (const t of this.ticks.values()) t.cancel();
    this.ticks.clear();
    for (const cancel of this.deadlines.values()) cancel();
    this.deadlines.clear();
  }

  private running(): boolean {
    return !this.stopped;
  }

  private async hasLive(sessionId: string): Promise<boolean> {
    const activations = await listActivations({ boxRoot: this.deps.boxRoot, sessionId }, { now: this.deps.now() });
    return activations.some((a) => !TERMINAL_STATES.includes(a.state));
  }

  private schedule(sessionId: string): void {
    const nowMs = this.deps.now().getTime();
    const current = this.pending.get(sessionId);
    const firstAt = current?.firstAt ?? nowMs;
    current?.cancel();
    const delay = Math.max(0, Math.min(SETTLE_MS, firstAt + SETTLE_CAP_MS - nowMs));
    const cancel = this.deps.timers.after(delay, () => {
      this.pending.delete(sessionId);
      this.track(() => this.evaluateSession(sessionId, { reason: "activity" }), "evaluation");
    });
    this.pending.set(sessionId, { firstAt, cancel });
  }

  private scheduleTick(sessionId: string, activation: Activation): void {
    const seconds = activation.tick;
    if (seconds === undefined) return;
    const tick: Tick = { cancel: () => {}, skippedForAbsence: this.ticks.get(activation.id)?.skippedForAbsence ?? false };
    tick.cancel = this.deps.timers.after(seconds * 1000, () => {
      this.track(() => this.onTick(sessionId, activation.id), "tick");
    });
    this.ticks.set(activation.id, tick);
  }

  private async onTick(sessionId: string, activationId: string): Promise<void> {
    if (this.stopped) return;
    const tick = this.ticks.get(activationId);
    const activation = (await listActivations({ boxRoot: this.deps.boxRoot, sessionId }, { now: this.deps.now() })).find((a) => a.id === activationId);
    if (activation === undefined || TERMINAL_STATES.includes(activation.state)) {
      this.ticks.delete(activationId);
      if (activation !== undefined && activation.state === "expired") await this.expire(sessionId);
      return;
    }
    if ((await this.deps.presence()) === 0) {
      if (tick !== undefined && !tick.skippedForAbsence) {
        tick.skippedForAbsence = true;
        await this.trace({ sessionId, activation, reason: "tick", entries: 0, records: [], outcome: "skipped", error: "nobody is present", ms: 0 });
      }
    } else {
      if (tick !== undefined) tick.skippedForAbsence = false;
      if (!this.inFlight.has(sessionId)) await this.evaluateSession(sessionId, { reason: "tick", activationId });
    }
    const still = (await listActivations({ boxRoot: this.deps.boxRoot, sessionId }, { now: this.deps.now() })).find((a) => a.id === activationId);
    // Read through a method: after the early return above, TypeScript keeps `this.stopped` narrowed to `false` across the awaits.
    if (still !== undefined && !TERMINAL_STATES.includes(still.state) && this.running()) this.scheduleTick(sessionId, still);
    else this.ticks.delete(activationId);
  }

  /** Write any expiry the clock now shows, under the lock, drop the timers, and announce it. */
  private async expire(sessionId: string): Promise<void> {
    const who = { boxRoot: this.deps.boxRoot, sessionId };
    const now = this.deps.now();
    let expired: Activation[] = [];
    try {
      await withTriggerLock(who, async () => {
        const read = await readActivationFile(who);
        if (read.invalid) return;
        expired = read.activations.filter((a) => a.state !== "expired" && expiryOf(a, now) !== null);
        // The store traces the expiry; this runner announces it through its own bus.
        if (expired.length > 0) await updateActivationsLocked(who, { now, announce: false, fn: (a) => a });
      });
    } catch (e) {
      console.warn(`[triggers] could not write expiry for ${sessionId}:`, e);
      return;
    }
    for (const a of expired) this.dropTimers(a.id);
    if (expired.length > 0) this.deps.emit(sessionId);
  }

  private dropTimers(activationId: string): void {
    this.ticks.get(activationId)?.cancel();
    this.ticks.delete(activationId);
    this.deadlines.get(activationId)?.();
    this.deadlines.delete(activationId);
  }

  private async evaluateSession(sessionId: string, opts: { reason: TriggerReason; activationId?: string }): Promise<void> {
    if (this.stopped) return;
    if (this.inFlight.has(sessionId)) {
      this.rearm.add(sessionId);
      return;
    }
    this.inFlight.add(sessionId);
    try {
      const who = { boxRoot: this.deps.boxRoot, sessionId };
      const now = this.deps.now();
      const activations = (await listActivations(who, { now }))
        .filter((a) => !TERMINAL_STATES.includes(a.state))
        .filter((a) => opts.activationId === undefined || a.id === opts.activationId);
      if (activations.length === 0) return;
      const lines = entriesForSession(await this.deps.readLog(), { sessionId, cursor: await readCursor(this.deps.boxRoot, sessionId) });
      for (const snapshot of activations) {
        // Reread just before the child starts: a disarm or expiry while an earlier activation ran must not start this one's code.
        const activation = (await listActivations(who, { now: this.deps.now() })).find((a) => a.id === snapshot.id);
        if (activation === undefined || TERMINAL_STATES.includes(activation.state)) continue;
        await this.evaluateOne({ sessionId, activation, lines, reason: opts.reason });
      }
    } catch (e) {
      console.warn(`[triggers] evaluation failed for ${sessionId}:`, e);
    } finally {
      this.inFlight.delete(sessionId);
      if (this.rearm.delete(sessionId) && this.running()) this.schedule(sessionId);
    }
  }

  private async evaluateOne(args: { sessionId: string; activation: Activation; lines: ActivityLine[]; reason: TriggerReason }): Promise<void> {
    const { sessionId, activation, lines, reason } = args;
    const entries = lines.filter((l) => l.seq > activation.lastEvalSeq);
    const history = lines.filter((l) => l.seq > activation.armedAtSeq).slice(-HISTORY_CAP);
    const latest = history.at(-1);
    const startedAt = this.deps.now();
    const job: EvalJob = {
      boxRoot: this.deps.boxRoot,
      file: activation.file,
      config: activation.config,
      reason,
      entries,
      history,
      sinceLastActivityMs: latest === undefined ? null : Math.max(0, startedAt.getTime() - Date.parse(latest.at)),
      fires: activation.fires,
      lastFireAt: activation.lastFireAt ?? null,
      armedAt: activation.armedAt,
    };
    const output = await this.deps.evaluate(job);
    const maxSeq = Math.max(activation.lastEvalSeq, ...entries.map((l) => l.seq));
    await this.admit({ sessionId, activationId: activation.id, output, maxSeq, reason, entries: entries.length });
  }

  /** Admission, fire and the state write, under one hold of the session's trigger lock. */
  private async admit(args: { sessionId: string; activationId: string; output: EvalOutput; maxSeq: number; reason: TriggerReason; entries: number }): Promise<void> {
    const { sessionId, activationId, output, maxSeq, reason } = args;
    const who = { boxRoot: this.deps.boxRoot, sessionId };
    const admission = await withTriggerLock(who, () => admitResult({ who, activationId, output, maxSeq, entries: args.entries, now: this.deps.now(), deliver: this.deps.deliver }));
    let { outcome, error, ended } = admission;
    if (admission.pending !== undefined) {
      // Admitted, so the lock is released; a cold engine start may still fail the send.
      try {
        await admission.pending;
      } catch (e) {
        const settled = await withTriggerLock(who, () => settleDelivery(who, { activationId, error: e, now: this.deps.now() }));
        outcome = "delivery-failed";
        error = settled.error;
        ended = ended || settled.ended;
      }
    }
    await this.trace({ sessionId, activation: { id: activationId, label: admission.label }, reason, entries: args.entries, records: output.records, outcome, error, ms: output.ms });
    if (admission.changed || outcome === "delivery-failed") this.deps.emit(sessionId);
    if (ended) this.dropTimers(activationId);
  }

  private trace(args: { sessionId: string; activation: Pick<Activation, "id" | "label">; reason: TraceLine["reason"]; entries: number; records: TraceLine["records"]; outcome: TraceOutcome; error?: string | undefined; ms: number }): Promise<void> {
    return appendTrace(this.deps.boxRoot, {
      at: this.deps.now().toISOString(),
      session: args.sessionId,
      activation: args.activation.id,
      label: args.activation.label,
      reason: args.reason,
      entries: args.entries,
      records: args.records,
      outcome: args.outcome,
      ...(args.error === undefined ? {} : { error: args.error }),
      ms: args.ms,
    });
  }
}

const runners = new Map<string, TriggerRunner>();

export function setTriggerRunner(boxRoot: string, runner: TriggerRunner): void {
  runners.set(boxRoot, runner);
}

export function clearTriggerRunner(boxRoot: string): void {
  runners.delete(boxRoot);
}

/** The box's runner, or undefined when its chat routes are not registered (tests, the CLI). */
export function getTriggerRunner(boxRoot: string): TriggerRunner | undefined {
  return runners.get(boxRoot);
}
