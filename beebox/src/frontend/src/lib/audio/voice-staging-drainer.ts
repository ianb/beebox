/**
 * The drain loop for the voice-staging queue
 * (`voice-staging-queue.ts`, Track 2 of
 * `docs/plans/resilient-voice-recording.md`): repeatedly asks the pure core
 * (`nextDrainStep`) what to do, and carries it out — send an op, wait, or
 * drop a terminally-failed recording. State mutation lives in
 * `voice-staging-queue-state.ts`; this file is "what happens next".
 */

import { errorMessage } from "@shared/error-guards";
import { nextDrainStep, VOICE_QUEUE_BOUND_MS } from "./voice-staging-queue-core";
import { refreshStatus, removeOp, dropRecording, persistPut, type Ctx } from "./voice-staging-queue-state";
import type { StoredVoiceOp } from "./voice-staging-storage";

async function bumpAttempts(ctx: Ctx, op: StoredVoiceOp): Promise<void> {
  const updated: StoredVoiceOp = { ...op, attempts: op.attempts + 1 };
  ctx.state.ops = ctx.state.ops.map((o) => (o.recordingId === op.recordingId && o.seq === op.seq ? updated : o));
  await persistPut(ctx, updated);
}

function describeTerminal(reason: "expired" | "rejected", op: StoredVoiceOp): string {
  if (reason === "expired") return "Recording upload gave up after 7 days.";
  return `Recording upload was rejected (${op.payload.kind}).`;
}

function scheduleWait(ctx: Ctx, ms: number): void {
  if (ctx.state.drainTimer !== null) return;
  ctx.state.drainTimer = setTimeout(() => {
    ctx.state.drainTimer = null;
    runDrain(ctx).catch((e: unknown) => console.error("[voice-staging] Drain loop failed:", e));
  }, ms);
}

export async function runDrain(ctx: Ctx): Promise<void> {
  if (ctx.state.draining) return;
  ctx.state.draining = true;
  try {
    for (;;) {
      const step = nextDrainStep(ctx.state.ops, {
        now: ctx.deps.now(),
        lastOutcome: ctx.state.lastOutcome,
        boundMs: VOICE_QUEUE_BOUND_MS,
      });
      if (step.type === "idle") return;
      if (step.type === "wait") {
        scheduleWait(ctx, step.ms);
        return;
      }
      if (step.type === "terminal") {
        await dropRecording(ctx, { recordingId: step.recordingId, message: describeTerminal(step.reason, step.op) });
        ctx.state.lastOutcome = null;
        continue;
      }
      const outcome = await ctx.deps.send(step.op);
      if (outcome.kind === "success") {
        await removeOp(ctx, step.op);
        ctx.state.lastOutcome = null;
      } else if (outcome.kind === "terminal") {
        await dropRecording(ctx, { recordingId: step.op.recordingId, message: errorMessage(outcome.error) });
        ctx.state.lastOutcome = null;
      } else {
        await bumpAttempts(ctx, step.op);
        ctx.state.lastOutcome = { recordingId: step.op.recordingId, seq: step.op.seq, at: ctx.deps.now(), kind: "transient" };
      }
    }
  } finally {
    ctx.state.draining = false;
  }
}

/** Cancel any scheduled wait and run a drain pass now — enqueue, `online`, and a visible tab all call this. */
export function wake(ctx: Ctx): void {
  if (ctx.state.drainTimer !== null) {
    clearTimeout(ctx.state.drainTimer);
    ctx.state.drainTimer = null;
  }
  runDrain(ctx).catch((e: unknown) => console.error("[voice-staging] Drain loop failed:", e));
}

/** Merge whatever the storage already held (a prior tab, a reload) into the live op list, then wake. */
export async function loadPersisted(ctx: Ctx): Promise<void> {
  try {
    const loaded = await ctx.state.storage.loadAll();
    const known = new Set(ctx.state.ops.map((o) => `${o.recordingId} ${String(o.seq)}`));
    const merged = loaded.filter((o) => !known.has(`${o.recordingId} ${String(o.seq)}`));
    if (merged.length === 0) return;
    ctx.state.ops = [...ctx.state.ops, ...merged];
    refreshStatus(ctx);
    wake(ctx);
  } catch (e) {
    // `downgradeToInMemory` would need re-importing just for this one call site;
    // loadAll's own storage failure just means starting from an empty queue.
    console.warn("[voice-staging] Failed to load persisted ops (starting empty):", e);
  }
}
