/**
 * The real wiring for `hq-wait.ts` (`docs/plans/resilient-voice-recording.md`,
 * Track 4): `voiceRecording` tRPC calls, the `voice-recording-status` bus
 * event on the shared `events.subscribe` stream, and a sleep-immune budget.
 * Also the registry the pending bubble's "Send live text now" control reaches
 * a running wait through.
 */

import { startAwakeTimeout } from "@shared/awake-timeout.js";
import { delay } from "@shared/backoff.js";
import { trpcClient } from "../trpc";
import { busEventData, unwrapBusEvent, type WireBusEvent } from "../bus-events";
import { createHqWaiter, type HqWaitDeps, type HqWaitOutcome, type HqWaitRequest, type HqWaiter } from "./hq-wait";

// The handoff mutations are idempotent by (recordingId, emissionId) on the
// box, so a transient failure may be retried.
const IDEMPOTENT = { context: { idempotent: true } };

const realDeps: HqWaitDeps = {
  status: (recordingId) => trpcClient.voiceRecording.status.query({ recordingId }),
  claim: (input) => trpcClient.voiceRecording.claim.mutate(input, IDEMPOTENT),
  fallBack: (input) => trpcClient.voiceRecording.fallBack.mutate(input, IDEMPOTENT),
  subscribe: ({ onStatus, onConnect }) => {
    const sub = trpcClient.events.subscribe.subscribe(undefined, {
      onStarted: () => onConnect(),
      onData: (wire: WireBusEvent) => {
        const status = busEventData(unwrapBusEvent(wire), "voice-recording-status");
        if (status) onStatus(status);
      },
      onError: (err: { message: string }) => {
        // wsLink reconnects on its own; onStarted then re-queries status.
        console.warn(`[hq-wait] event stream: ${err.message}`);
      },
    });
    return () => sub.unsubscribe();
  },
  startBudget: ({ ms, onExpire }) => startAwakeTimeout({ timeoutMs: ms, onTimeout: () => onExpire() }),
  sleep: delay,
};

/** The handoff mutations alone, for resolving a wait a reload interrupted. */
export const voiceHandoffCalls = { claim: realDeps.claim, fallBack: realDeps.fallBack };

let waiter: HqWaiter | null = null;
function realWaiter(): HqWaiter {
  waiter ??= createHqWaiter(realDeps);
  return waiter;
}

/** "Send live text now" handlers for the waits running in this tab, by emission id. */
const sendLiveRequests = new Map<string, () => void>();

/** The user asked a pending voice message to stop waiting for HQ. */
export function requestHqSendLive(emissionId: string): void {
  const request = sendLiveRequests.get(emissionId);
  if (request) request();
  else console.warn(`[hq-wait] Send-live for ${emissionId}: no wait is running`);
}

export function awaitHq(request: Omit<HqWaitRequest, "sendLive">): Promise<HqWaitOutcome> {
  let signal = (): void => {};
  const sendLive = new Promise<void>((resolve) => {
    signal = resolve;
  });
  sendLiveRequests.set(request.emissionId, signal);
  return realWaiter().wait({ ...request, sendLive }).finally(() => {
    sendLiveRequests.delete(request.emissionId);
  });
}
