# Waiting for a voice message's HQ transcript

`lib/audio/hq-wait.ts` (`docs/plans/resilient-voice-recording.md`, Track 4)
decides how a voice send's HQ wait ends: claim a ready result, fall back to the
realtime text when the budget runs out or the user asks, or stop on a
permanent failure. These examples drive the waiter with a fake box — a status
source, the `claim`/`fallBack` mutations, the `voice-recording-status` event
stream, and a budget timer the example expires by hand.

```ts setup
import {
  createHqWaiter,
  decideOnStatus,
  hqStatusLine,
} from "../../../../src/frontend/src/lib/audio/hq-wait.js";

const READY = { text: "clean words", diarized: false, service: "mai", pieces: 1 };
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

function fakeBox(opts?: { claim?: unknown; fallBack?: unknown; fallBackFails?: number }) {
  const calls: string[] = [];
  let hq: unknown = { state: "queued" };
  let handlers: { onStatus: (e: unknown) => void; onConnect: () => void } | null = null;
  let expire = () => {};
  let fallBackFailures = opts?.fallBackFails ?? 0;
  const deps = {
    status: async (recordingId: string) => {
      calls.push("status");
      return { recordingId, hq, handoff: { mode: "open" }, sealed: true, service: "mai" };
    },
    claim: async () => {
      calls.push("claim");
      return opts?.claim ?? { outcome: "claimed", result: READY };
    },
    fallBack: async (input: { sessionId: string }) => {
      calls.push(`fallBack ${input.sessionId}`);
      if (fallBackFailures > 0) { fallBackFailures -= 1; throw new Error("502"); }
      return opts?.fallBack ?? { outcome: "late" };
    },
    subscribe: (h: { onStatus: (e: unknown) => void; onConnect: () => void }) => {
      handlers = h;
      return () => { calls.push("unsubscribe"); };
    },
    startBudget: (b: { onExpire: () => void }) => {
      expire = b.onExpire;
      return { stop: () => { calls.push("budget stopped"); } };
    },
    sleep: async () => {},
  };
  return {
    deps,
    calls,
    setHq: (next: unknown) => { hq = next; },
    event: (next: unknown) => handlers?.onStatus({ recordingId: "rec", hq: next }),
    reconnect: () => handlers?.onConnect(),
    expire: () => expire(),
  };
}

function request(box: ReturnType<typeof fakeBox>, opts?: { sessionId?: string | null; sendLive?: Promise<void> }) {
  const progress: string[] = [];
  return {
    progress,
    req: {
      recordingId: "rec",
      emissionId: "em",
      budgetMs: 300_000,
      sessionId: () => (opts?.sessionId === undefined ? "chat-1" : opts.sessionId),
      sendLive: opts?.sendLive ?? new Promise<void>(() => {}),
      onProgress: (p: { kind: string; hq?: { state: string } }) => { progress.push(p.kind === "status" ? p.hq?.state ?? "" : p.kind); },
    },
  };
}
```

## The decision a status implies

```ts
["none", "queued", "transcribing", "retrying", "ready"].map((state) => decideOnStatus({ state }).kind).join(",")
=> wait,wait,wait,wait,claim

JSON.stringify(decideOnStatus({ state: "failed", failure: { kind: "permanent", code: "http_401", message: "missing key" } }))
=> {"kind":"failed","failure":{"kind":"permanent","code":"http_401","message":"missing key"}}
```

## The pending bubble's status line

```ts
const now = Date.parse("2026-09-10T18:00:00.000Z");
[
  hqStatusLine({ kind: "status", hq: { state: "queued" } }, { uploading: true, now }),
  hqStatusLine({ kind: "status", hq: { state: "transcribing", piece: 2, pieces: 3, attempt: 1, pieceSeconds: 300 } }, { uploading: false, now }),
  hqStatusLine({ kind: "status", hq: { state: "retrying", attempt: 2, pieceSeconds: 300, nextAttemptAt: "2026-09-10T18:00:40.000Z",
    failure: { kind: "transient", code: "http_408", message: "provider timed out" } } }, { uploading: false, now }),
  hqStatusLine({ kind: "unreachable" }, { uploading: true, now }),
].join(" | ")
=> Uploading audio… | Transcribing part 2 of 3 | HQ retry in 40 s — provider timed out | Box restarting — audio saved on this device
```

## A ready result is claimed and sent as HQ text

The waiter reads the status when it subscribes, then follows events for its
own recording only.

```ts
const box = fakeBox();
const { req, progress } = request(box);
const outcome = createHqWaiter(box.deps).wait(req);
await flush();
box.calls.join(",")
=> status

box.event({ state: "transcribing", piece: 1, pieces: 1, attempt: 1, pieceSeconds: 300 });
box.event({ state: "ready", result: READY });
JSON.stringify(await outcome)
=> {"kind":"hq","result":{"text":"clean words","diarized":false,"service":"mai","pieces":1}}

progress.join(",")
=> queued,transcribing,ready

box.calls.join(",")
=> status,claim,unsubscribe,budget stopped
```

## Every (re)subscribe re-queries status, so a restart's missed events are recovered

The box restarted mid-wait; no event reached this tab, but the job finished.
When the stream reconnects, the re-query sees `ready`:

```ts
const box = fakeBox();
const { req } = request(box);
const outcome = createHqWaiter(box.deps).wait(req);
await flush();
box.setHq({ state: "ready", result: READY });
box.reconnect();
(await outcome).kind
=> hq

box.calls.filter((c) => c === "status").length
=> 2
```

## The budget runs out: fall back, recorded as `late`

```ts
const box = fakeBox();
const { req } = request(box);
const outcome = createHqWaiter(box.deps).wait(req);
await flush();
box.expire();
JSON.stringify(await outcome)
=> {"kind":"fallback","reason":"budget","recorded":true,"service":"mai"}

box.calls.includes("fallBack chat-1")
=> true
```

If HQ finished just before the fallback landed, `fallBack` answers with the
result and the HQ text is sent after all:

```ts
const box = fakeBox({ fallBack: { outcome: "claimed", result: READY } });
const { req } = request(box);
const outcome = createHqWaiter(box.deps).wait(req);
await flush();
box.expire();
(await outcome).kind
=> hq
```

## "Send live text now" in a new chat: the fallback waits for the send

A new chat has no session to name in `fallBack` until its first message is
sent, so the wait ends without calling it (`recorded: false`); the caller
records the fallback after the send.

```ts
let tap = () => {};
const sendLive = new Promise<void>((resolve) => { tap = resolve; });
const box = fakeBox();
const { req } = request(box, { sessionId: null, sendLive });
const outcome = createHqWaiter(box.deps).wait(req);
await flush();
tap();
JSON.stringify(await outcome)
=> {"kind":"fallback","reason":"user","recorded":false,"service":"mai"}

box.calls.some((c) => c.startsWith("fallBack"))
=> false
```

`recordLate` then records it once the chat has a session, retrying a box that
is still restarting:

```ts continue
const retrying = fakeBox({ fallBackFails: 2 });
await createHqWaiter(retrying.deps).recordLate({ recordingId: "rec", emissionId: "em", sessionId: Promise.resolve("chat-new") });
retrying.calls.join(",")
=> fallBack chat-new,fallBack chat-new,fallBack chat-new
```

## A permanent failure ends the wait with the reason

```ts
const box = fakeBox();
const { req } = request(box);
const outcome = createHqWaiter(box.deps).wait(req);
await flush();
box.event({ state: "failed", failure: { kind: "permanent", code: "missing_openrouter_key", message: "No OpenRouter key is configured" } });
JSON.stringify(await outcome)
=> {"kind":"fallback","reason":{"kind":"permanent","code":"missing_openrouter_key","message":"No OpenRouter key is configured"},"recorded":true,"service":"mai"}
```
