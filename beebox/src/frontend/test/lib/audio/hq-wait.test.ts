// # Waiting for a voice message's HQ transcript
//
// `lib/audio/hq-wait.ts` (`docs/plans/resilient-voice-recording.md`, Track 4)
// decides how a voice send's HQ wait ends: claim a ready result, fall back to the
// realtime text when the budget runs out or the user asks, or stop on a
// permanent failure. These examples drive the waiter with a fake box — a status
// source, the `claim`/`fallBack` mutations, the `voice-recording-status` event
// stream, and a budget timer the example expires by hand.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import {
  createHqWaiter,
  decideOnStatus,
  hqStatusLine,
} from "../../../src/lib/audio/hq-wait.js";
import type { HqWaitDeps, VoiceHqResult, VoiceHqState } from "../../../src/lib/audio/hq-wait.js";

type ClaimReply = Awaited<ReturnType<HqWaitDeps["claim"]>>;
type FallBackReply = Awaited<ReturnType<HqWaitDeps["fallBack"]>>;
type StatusHandlers = Parameters<HqWaitDeps["subscribe"]>[0];

const READY: VoiceHqResult = { text: "clean words", diarized: false, service: "mai", pieces: 1 };
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

function fakeBox(opts?: { claim?: ClaimReply; fallBack?: FallBackReply; fallBackFails?: number }) {
  const calls: string[] = [];
  let hq: VoiceHqState = { state: "queued" };
  let handlers: StatusHandlers | null = null;
  let expire = () => {};
  let fallBackFailures = opts?.fallBackFails ?? 0;
  const deps: HqWaitDeps = {
    status: async (recordingId: string) => {
      calls.push("status");
      return { recordingId, hq, handoff: { mode: "open" }, sealed: true, service: "mai" };
    },
    claim: async () => {
      calls.push("claim");
      return opts?.claim ?? { outcome: "claimed", result: READY };
    },
    fallBack: async () => {
      calls.push("fallBack");
      if (fallBackFailures > 0) { fallBackFailures -= 1; throw new Error("502"); }
      return opts?.fallBack ?? { outcome: "fellBack" };
    },
    subscribe: (h) => {
      handlers = h;
      return () => { calls.push("unsubscribe"); };
    },
    startBudget: (b) => {
      expire = b.onExpire;
      return { stop: () => { calls.push("budget stopped"); } };
    },
    sleep: async () => {},
  };
  return {
    deps,
    calls,
    setHq: (next: VoiceHqState) => { hq = next; },
    event: (next: VoiceHqState) => handlers?.onStatus({ recordingId: "rec", hq: next }),
    reconnect: () => handlers?.onConnect(),
    expire: () => expire(),
  };
}

function request(opts?: { sendLive?: Promise<void> }) {
  const progress: string[] = [];
  return {
    progress,
    req: {
      recordingId: "rec",
      emissionId: "em",
      budgetMs: 300_000,
      sendLive: opts?.sendLive ?? new Promise<void>(() => {}),
      onProgress: (p: { kind: string; hq?: { state: string } }) => { progress.push(p.kind === "status" ? p.hq?.state ?? "" : p.kind); },
    },
  };
}

// ## The decision a status implies
void test("The decision a status implies", async (t) => {
  // doctest:L83
  t.check(
    ([
      { state: "none" },
      { state: "queued" },
      { state: "transcribing", piece: 1, pieces: 1, attempt: 1, pieceSeconds: 300 },
      { state: "retrying", attempt: 1, pieceSeconds: 300, nextAttemptAt: "2026-09-10T18:00:40.000Z", failure: { kind: "transient", code: "http_408", message: "provider timed out" } },
      { state: "ready", result: READY },
    ] satisfies VoiceHqState[]).map((hq) => decideOnStatus(hq)), [
    {
      kind: "wait",
    },
    {
      kind: "wait",
    },
    {
      kind: "wait",
    },
    {
      kind: "wait",
    },
    {
      kind: "claim",
    },
  ]);

  // doctest:L92
  t.check(decideOnStatus({ state: "failed", failure: { kind: "permanent", code: "http_401", message: "missing key" } }), {
    kind: "failed",
    failure: {
      kind: "permanent",
      code: "http_401",
      message: "missing key",
    },
  });
});

// ## The pending bubble's status line
void test("The pending bubble's status line", async (t) => {
  // doctest:L99
  const now = Date.parse("2026-09-10T18:00:00.000Z");
  t.check(
    [
      hqStatusLine({ kind: "status", hq: { state: "queued" } }, { uploading: true, now }),
      hqStatusLine({ kind: "status", hq: { state: "transcribing", piece: 2, pieces: 3, attempt: 1, pieceSeconds: 300 } }, { uploading: false, now }),
      hqStatusLine({ kind: "status", hq: { state: "retrying", attempt: 2, pieceSeconds: 300, nextAttemptAt: "2026-09-10T18:00:40.000Z",
        failure: { kind: "transient", code: "http_408", message: "provider timed out" } } }, { uploading: false, now }),
      hqStatusLine({ kind: "unreachable" }, { uploading: true, now }),
    ],
    ["Uploading audio…", "Transcribing part 2 of 3", "HQ retry in 40 s — provider timed out", "Box restarting — audio saved on this device"],
  );
});

// ## A ready result is claimed and sent as HQ text
//
// The waiter reads the status when it subscribes, then follows events for its
// own recording only.
void test("The waiter reads the status when it subscribes, then follows events for its o...", async (t) => {
  // doctest:L116
  const box = fakeBox();
  const { req, progress } = request();
  const outcome = createHqWaiter(box.deps).wait(req);
  await flush();
  t.check(box.calls, ["status"]);

  // doctest:L123
  box.event({ state: "transcribing", piece: 1, pieces: 1, attempt: 1, pieceSeconds: 300 });
  box.event({ state: "ready", result: READY });
  t.check(await outcome, {
    kind: "hq",
    result: {
      text: "clean words",
      diarized: false,
      service: "mai",
      pieces: 1,
    },
  });

  // doctest:L128
  t.check(progress, ["queued", "transcribing", "ready"]);

  // doctest:L131
  t.check(box.calls, ["status", "claim", "unsubscribe", "budget stopped"]);
});

// ## Every (re)subscribe re-queries status, so a restart's missed events are recovered
//
// The box restarted mid-wait; no event reached this tab, but the job finished.
// When the stream reconnects, the re-query sees `ready`:
void test("The box restarted mid-wait; no event reached this tab, but the job finished.", async (t) => {
  // doctest:L141
  const box = fakeBox();
  const { req } = request();
  const outcome = createHqWaiter(box.deps).wait(req);
  await flush();
  box.setHq({ state: "ready", result: READY });
  box.reconnect();
  t.check(await outcome, {
    kind: "hq",
    result: {
      text: "clean words",
      diarized: false,
      service: "mai",
      pieces: 1,
    },
  });

  // doctest:L150
  t.check(box.calls, [
    "status",
    "status",
    "claim",
    "unsubscribe",
    "budget stopped",
  ]);
});

// ## The budget runs out: fall back
void test("The budget runs out: fall back", async (t) => {
  // doctest:L157
  const box = fakeBox();
  const { req } = request();
  const outcome = createHqWaiter(box.deps).wait(req);
  await flush();
  box.expire();
  t.check(await outcome, {
    kind: "fallback",
    reason: "budget",
    service: "mai",
  });

  // doctest:L165
  t.check(box.calls, [
    "status",
    "fallBack",
    "unsubscribe",
    "budget stopped",
  ]);
});

// If HQ finished just before the fallback landed, `fallBack` answers with the
// result and the HQ text is sent after all:
void test("If HQ finished just before the fallback landed, fallBack answers with the res...", async (t) => {
  // doctest:L173
  const box = fakeBox({ fallBack: { outcome: "claimed", result: READY } });
  const { req } = request();
  const outcome = createHqWaiter(box.deps).wait(req);
  await flush();
  box.expire();
  t.check(await outcome, {
    kind: "hq",
    result: {
      text: "clean words",
      diarized: false,
      service: "mai",
      pieces: 1,
    },
  });
});

// ## "Send live text now" falls back the same way
void test("\"Send live text now\" falls back the same way", async (t) => {
  // doctest:L185
  let tap = () => {};
  const sendLive = new Promise<void>((resolve) => { tap = resolve; });
  const box = fakeBox();
  const { req } = request({ sendLive });
  const outcome = createHqWaiter(box.deps).wait(req);
  await flush();
  tap();
  t.check(await outcome, {
    kind: "fallback",
    reason: "user",
    service: "mai",
  });

  // doctest:L195
  t.check(box.calls, [
    "status",
    "fallBack",
    "unsubscribe",
    "budget stopped",
  ]);

  // A box that is unreachable when the fallback is requested still ends the wait
  // with the live text — there is nothing left to retry after the send, since a
  // sealed recording is GC'd from the box on its own schedule regardless:

  // doctest:L204
  const unreachable = fakeBox({ fallBackFails: 1 });
  const { req: req2 } = request();
  const outcome2 = createHqWaiter(unreachable.deps).wait(req2);
  await flush();
  unreachable.expire();
  t.check(await outcome2, {
    kind: "fallback",
    reason: "budget",
    service: "mai",
  });
});

// ## A permanent failure ends the wait with the reason
void test("A permanent failure ends the wait with the reason", async (t) => {
  // doctest:L216
  const box = fakeBox();
  const { req } = request();
  const outcome = createHqWaiter(box.deps).wait(req);
  await flush();
  box.event({ state: "failed", failure: { kind: "permanent", code: "missing_openrouter_key", message: "No OpenRouter key is configured" } });
  t.check(await outcome, {
    kind: "fallback",
    reason: {
      kind: "permanent",
      code: "missing_openrouter_key",
      message: "No OpenRouter key is configured",
    },
    service: "mai",
  });
});
