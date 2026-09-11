/**
 * Waiting for a voice message's HQ transcript
 * (`docs/plans/resilient-voice-recording.md`, Track 4). A voice send with HQ
 * seals its recording with an HQ request, then waits here, within a bounded
 * budget, for the box's HQ job. The wait ends one of three ways:
 *
 * - the result is ready → `claim` it → send the HQ text;
 * - the budget runs out, or the user taps "Send live text now" → `fallBack`
 *   → send the realtime text marked `hq="failed"` — unless `fallBack`
 *   answers that HQ won the race, which sends the HQ text after all;
 * - the HQ job failed for good → send the realtime text marked `hq="failed"`.
 *
 * After a fallback the HQ result stays on the box, reachable through
 * `bbx chat retranscribe`; it is never delivered as a later message.
 *
 * This module is the decision logic plus a waiter over injected IO, so the
 * doctest drives it with a fake status source; `await-hq.ts` wires the real
 * tRPC calls, event stream and sleep-immune budget.
 */

import type { RouterOutput } from "../trpc";

type VoiceStatus = RouterOutput["voiceRecording"]["status"];
type ClaimOutcome = RouterOutput["voiceRecording"]["claim"];
type FallBackOutcome = RouterOutput["voiceRecording"]["fallBack"];
export type VoiceHqState = VoiceStatus["hq"];
export type VoiceHqResult = Extract<ClaimOutcome, { outcome: "claimed" }>["result"];
export type HqFailure = Extract<FallBackOutcome, { outcome: "failed" }>["failure"];

/** How long a send waits for HQ before sending the realtime text (plan: 5 minutes). */
export const HQ_WAIT_BUDGET_MS = 5 * 60 * 1000;

export type HqWaitOutcome =
  | { kind: "hq"; result: VoiceHqResult }
  | {
      kind: "fallback";
      /** Why: the budget ran out, the user chose, or the HQ job failed for good. */
      reason: "budget" | "user" | HqFailure;
      /** The HQ service, when a status reply named it (for the failure notice). */
      service: string | null;
    };

/** What the waiter learned most recently, for the pending bubble's status line. */
export type HqProgress = { kind: "status"; hq: VoiceHqState } | { kind: "unreachable" };

/** What a status means for the wait: keep waiting, claim the result, or stop on a failure. */
export function decideOnStatus(hq: VoiceHqState): { kind: "wait" } | { kind: "claim" } | { kind: "failed"; failure: HqFailure } {
  switch (hq.state) {
    case "ready":
      return { kind: "claim" };
    case "failed":
      return { kind: "failed", failure: hq.failure };
    case "none":
    case "queued":
    case "transcribing":
    case "retrying":
      return { kind: "wait" };
  }
}

/** A claim reply as an outcome, or null when HQ is not ready after all (keep waiting). */
export function outcomeOfClaim(claim: ClaimOutcome, service: string | null): HqWaitOutcome | null {
  switch (claim.outcome) {
    case "claimed":
      return { kind: "hq", result: claim.result };
    case "failed":
      return { kind: "fallback", reason: claim.failure, service };
    case "pending":
      return null;
  }
}

export function outcomeOfFallBack(
  reply: FallBackOutcome,
  opts: { reason: "budget" | "user"; service: string | null },
): HqWaitOutcome {
  switch (reply.outcome) {
    case "claimed":
      return { kind: "hq", result: reply.result };
    case "fellBack":
      return { kind: "fallback", reason: opts.reason, service: opts.service };
    case "failed":
      return { kind: "fallback", reason: reply.failure, service: opts.service };
  }
}

/** The pending bubble's one-line status. */
export function hqStatusLine(progress: HqProgress, opts: { uploading: boolean; now: number }): string {
  if (progress.kind === "unreachable") return "Box restarting — audio saved on this device";
  const { hq } = progress;
  switch (hq.state) {
    case "none":
    case "queued":
      return opts.uploading ? "Uploading audio…" : "Waiting for HQ transcription…";
    case "transcribing":
      return hq.pieces > 1 ? `Transcribing part ${String(hq.piece)} of ${String(hq.pieces)}` : "Transcribing…";
    case "retrying": {
      const seconds = Math.max(0, Math.ceil((Date.parse(hq.nextAttemptAt) - opts.now) / 1000));
      return `HQ retry in ${String(seconds)} s — ${hq.failure.message}`;
    }
    case "ready":
      return "HQ transcript ready";
    case "failed":
      return `HQ failed: ${hq.failure.message}`;
  }
}

export interface HqWaitDeps {
  status: (recordingId: string) => Promise<VoiceStatus>;
  claim: (input: { recordingId: string; emissionId: string }) => Promise<ClaimOutcome>;
  fallBack: (input: { recordingId: string; emissionId: string }) => Promise<FallBackOutcome>;
  /** Status events for every recording; `onConnect` fires on each (re)subscribe. */
  subscribe: (handlers: {
    onStatus: (event: { recordingId: string; hq: VoiceHqState }) => void;
    onConnect: () => void;
  }) => () => void;
  startBudget: (opts: { ms: number; onExpire: () => void }) => { stop: () => void };
  sleep: (ms: number) => Promise<void>;
}

export interface HqWaitRequest {
  recordingId: string;
  emissionId: string;
  budgetMs: number;
  /** Resolves when the user asks to send the live text now. */
  sendLive: Promise<void>;
  onProgress: (progress: HqProgress) => void;
}

export interface HqWaiter {
  wait: (request: HqWaitRequest) => Promise<HqWaitOutcome>;
}

export function createHqWaiter(deps: HqWaitDeps): HqWaiter {
  return {
    wait: (request) => new Promise((resolve) => runWait({ deps, request, resolve })),
  };
}

function runWait(opts: { deps: HqWaitDeps; request: HqWaitRequest; resolve: (outcome: HqWaitOutcome) => void }): void {
  const { deps, request, resolve } = opts;
  const { recordingId, emissionId } = request;
  let settled = false;
  // Opaque read: `settled` flips inside callbacks across awaits, which TS's
  // narrowing of a same-function `let` cannot see.
  const isSettled = (): boolean => settled;
  let acting = false;
  let wantFallBack: "budget" | "user" | null = null;
  let service: string | null = null;
  let unsubscribe = (): void => {};
  let budget = { stop: (): void => {} };

  const finish = (outcome: HqWaitOutcome): void => {
    if (settled) return;
    settled = true;
    unsubscribe();
    budget.stop();
    resolve(outcome);
  };
  const fallBackNow = async (reason: "budget" | "user"): Promise<HqWaitOutcome> => {
    try {
      return outcomeOfFallBack(await deps.fallBack({ recordingId, emissionId }), { reason, service });
    } catch (e) {
      // The box is unreachable: send the live text anyway. Recording the
      // fallback stops mattering once late correction is gone — the box GCs
      // a sealed non-terminal recording 7 days after sealing regardless.
      console.warn(`[hq-wait] ${recordingId}: fallBack failed; sending live text now:`, e);
      return { kind: "fallback", reason, service };
    }
  };
  // One box call at a time; a fallback asked for meanwhile runs right after.
  const act = async (run: () => Promise<HqWaitOutcome | null>): Promise<void> => {
    if (settled || acting) return;
    acting = true;
    try {
      const outcome = await run();
      if (outcome !== null) finish(outcome);
    } catch (e) {
      console.warn(`[hq-wait] ${recordingId}: box call failed; still waiting:`, e);
      request.onProgress({ kind: "unreachable" });
    } finally {
      acting = false;
    }
    const reason = wantFallBack;
    if (!isSettled() && reason !== null) await act(() => fallBackNow(reason));
  };
  const onHq = (hq: VoiceHqState): void => {
    if (settled) return;
    request.onProgress({ kind: "status", hq });
    const decision = decideOnStatus(hq);
    if (decision.kind === "claim") {
      void act(async () => outcomeOfClaim(await deps.claim({ recordingId, emissionId }), service));
    } else if (decision.kind === "failed") {
      finish({ kind: "fallback", reason: decision.failure, service });
    }
  };
  const refresh = (): void => {
    deps.status(recordingId).then(
      (dto) => {
        service = dto.service;
        onHq(dto.hq);
      },
      (e: unknown) => {
        console.warn(`[hq-wait] ${recordingId}: status unavailable; still waiting:`, e);
        if (!settled) request.onProgress({ kind: "unreachable" });
      },
    );
  };
  const requestFallBack = (reason: "budget" | "user"): void => {
    if (settled) return;
    wantFallBack = reason;
    void act(() => fallBackNow(reason));
  };

  // Re-query status on every (re)subscribe, so events missed during a box
  // restart are recovered.
  const stopEvents = deps.subscribe({
    onStatus: (event) => {
      if (event.recordingId === recordingId) onHq(event.hq);
    },
    onConnect: refresh,
  });
  const budgetTimer = deps.startBudget({ ms: request.budgetMs, onExpire: () => requestFallBack("budget") });
  if (isSettled()) {
    stopEvents();
    budgetTimer.stop();
    return;
  }
  unsubscribe = stopEvents;
  budget = budgetTimer;
  void request.sendLive.then(() => requestFallBack("user"));
  refresh();
}
