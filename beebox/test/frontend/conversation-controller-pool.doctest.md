# Conversation controller ownership and startup recovery

These checks use the production chat machine, replacing only its network actors
and queued POST action. Selection and actor retention are the actual pool code.

```ts setup
import { createActor, fromPromise, fromCallback } from "xstate";
import { chatMachine } from "../../src/frontend/src/machines/chatMachine.js";
import { ConversationControllerPool } from "../../src/frontend/src/components/chat/conversation/controller-pool.js";
import { StartRecords } from "../../src/frontend/src/components/chat/conversation/start-records.js";
import { settleReceipt, expectReceipt } from "../../src/frontend/src/input/targets/receipts.js";
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
function fixture() {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const sends = [];
  const actors = [];
  let autoAccept = true;
  let apiBase = "/test1/api";
  const accept = (input) => { sends.push(input); if (autoAccept) settleReceipt({ disposition: "sent", emissionId: input.messageId, deduplicated: false }); };
  const factory = (input) => {
    const empty = { entries: [], total: 0, sessionId: input.sessionInput === "new" ? null : input.sessionInput, running: false, busy: false, pending: [] };
    const actor = createActor(chatMachine.provide({
      actors: { fetchInitial: fromPromise(async () => empty), fetchHistory: fromPromise(async () => empty), stream: fromCallback(({ input }) => accept(input)) },
      actions: { queueSend: ({ event }) => accept(event) },
    }), { input });
    actors.push(actor);
    return actor;
  };
  const options = { storage, createController: factory, getApiBase: () => apiBase };
  return { pool: new ConversationControllerPool("test1", options), options, storage, sends, actors, holdReceipts: () => { autoAccept = false; }, acceptReceipts: () => { autoAccept = true; }, switchBox: () => { apiBase = "/test2/api"; } };
}
const session = (sessionId) => ({ kind: "session", sessionId, contextDir: "_content" });
const start = { kind: "start", clientConversationId: "logical-new", contextDir: "_content", engine: "codex" };
const bind = (target) => ({ boxSlug: "test1", target, attention: { surface: "card", focusedRef: "/_content/report.md", transcript: "hidden" } });
const send = (messageId) => ({ type: "SEND", messageId, message: "test" });
```

## A captured send survives navigation and inactive actors are released

```ts
const f = fixture();
const first = f.pool.select(session("first"));
await tick();
const captured = f.pool.capture(bind(session("first")));
f.pool.select(session("second"));
await tick();
captured.send(send("captured"));
await captured.finished();
const result = { destination: f.sends[0].binding.target.sessionId, original: first.getSnapshot().status, count: f.actors.length };
f.pool.suspend();
JSON.stringify(result)
=> {"destination":"first","original":"active","count":2}
```

## An unrelated assignment cannot release a fresh conversation's follow-up

```ts
const f = fixture();
const first = f.pool.select(start);
await tick();
const initial = f.pool.capture(bind(start));
initial.send(send("first-start"));
await initial.finished();
const followup = f.pool.capture(bind(start));
followup.send(send("followup"));
f.pool.markReady("unrelated");
await tick();
const held = f.sends.length;
f.pool.markReady("real-id"); // bus can arrive before the owning stream's init
first.send({ type: "SESSION_ASSIGNED", sessionId: "real-id" });
await followup.finished();
const records = new StartRecords(f.storage, "test1");
f.pool.suspend();
JSON.stringify({ held, destination: f.sends[1].binding.target.sessionId, state: records.get("logical-new").state });
=> {"held":1,"destination":"real-id","state":"assigned"}
```

## Reload never turns a follow-up into a second fresh start

```ts
const f = fixture();
const first = f.pool.select(start);
await tick();
const initial = f.pool.capture(bind(start));
initial.send(send("accepted-first"));
await initial.finished();
f.pool.suspend();
const restored = new ConversationControllerPool("test1", f.options);
restored.select(start);
await tick();
const receipt = expectReceipt("after-reload");
const followup = restored.capture(bind(start));
followup.send(send("after-reload"));
await followup.finished();
restored.suspend();
JSON.stringify({ freshSends: f.sends.length, disposition: (await receipt).disposition });
=> {"freshSends":1,"disposition":"rejected"}
```

## A box switch after upload capture cannot send through the new API prefix

```ts
const f = fixture();
f.pool.select(session("first"));
await tick();
const captured = f.pool.capture(bind(session("first")));
f.switchBox();
const receipt = expectReceipt("wrong-box");
captured.send(send("wrong-box"));
await captured.finished();
f.pool.suspend();
JSON.stringify({ sends: f.sends.length, disposition: (await receipt).disposition });
=> {"sends":0,"disposition":"rejected"}
```

## Corrupted startup metadata fails closed

```ts
let message = "";
try {
  new StartRecords({ getItem: () => "{broken", setItem: () => {} }, "test1");
} catch (error) {
  message = error.message;
};
message
=> Conversation startup records need recovery
```

## A first send during loading waits for the owning stream

```ts
const f = fixture();
const actor = f.pool.select(start);
const captured = f.pool.capture(bind(start));
captured.send(send("early-first"));
await captured.finished();
const result = { state: actor.getSnapshot().value, starts: f.sends.length, queued: f.sends[0].type === "SEND" };
f.pool.suspend();
JSON.stringify(result)
=> {"state":"streaming","starts":1,"queued":false}
```

## Two starts only adopt their own stream identities

```ts
const f = fixture();
const other = { ...start, clientConversationId: "other-start" };
const first = f.pool.select(start);
await tick();
const firstSend = f.pool.capture(bind(start));
firstSend.send(send("one"));
await firstSend.finished();
const second = f.pool.select(other);
await tick();
const secondSend = f.pool.capture(bind(other));
secondSend.send(send("two"));
await secondSend.finished();
const assigned = [];
f.pool.setAssignmentHandler((id, target) => assigned.push([id, target.clientConversationId]));
f.pool.markReady("real-two");
second.send({ type: "SESSION_ASSIGNED", sessionId: "real-two" });
f.pool.markReady("real-one");
first.send({ type: "SESSION_ASSIGNED", sessionId: "real-one" });
f.pool.suspend();
JSON.stringify(assigned)
=> [["real-two","other-start"],["real-one","logical-new"]]
```

## Suspension releases a locally held follow-up without dispatch

```ts
const f = fixture();
f.pool.select(start);
await tick();
const firstSend = f.pool.capture(bind(start));
firstSend.send(send("before-suspend"));
await firstSend.finished();
const receipt = expectReceipt("held-suspend");
const held = f.pool.capture(bind(start));
held.send(send("held-suspend"));
f.pool.suspend();
await held.finished();
JSON.stringify({ starts: f.sends.length, disposition: (await receipt).disposition })
=> {"starts":1,"disposition":"rejected"}
```

## Metadata failures preserve acceptance and don't crash assignment observers

```ts
const f = fixture();
const originalWrite = f.storage.setItem;
let writes = 0;
f.storage.setItem = (key, value) => {
  writes++;
  if (writes > 1) throw new Error("disk full");
  originalWrite(key, value);
};
const notices = [];
f.pool.setRecoveryHandler((notice) => { if (notice !== null) notices.push(notice); });
const actor = f.pool.select(start);
await tick();
const receipt = expectReceipt("accepted-storage-failed");
const captured = f.pool.capture(bind(start));
captured.send(send("accepted-storage-failed"));
await captured.finished();
f.pool.markReady("ready-but-not-saved");
actor.send({ type: "SESSION_ASSIGNED", sessionId: "ready-but-not-saved" });
const result = { disposition: (await receipt).disposition, notices: notices.length, active: actor.getSnapshot().status };
f.pool.suspend();
JSON.stringify(result)
=> {"disposition":"sent","notices":2,"active":"active"}
```

## Storage failure before dispatch never submits the fresh start

```ts
const f = fixture();
f.storage.setItem = () => { throw new Error("storage blocked"); };
f.pool.select(start);
await tick();
const receipt = expectReceipt("no-attempt-record");
const captured = f.pool.capture(bind(start));
captured.send(send("no-attempt-record"));
await captured.finished();
f.pool.suspend();
JSON.stringify({ sends: f.sends.length, disposition: (await receipt).disposition })
=> {"sends":0,"disposition":"rejected"}
```

## Effect replay preserves actors; real detach stops them

```ts
const f = fixture();
const actor = f.pool.select(session("first"));
await tick();
const detach = f.pool.attach();
detach();
const finalDetach = f.pool.attach();
await tick();
const replayKept = f.pool.controller(session("first")) === actor && actor.getSnapshot().status === "active";
finalDetach();
await tick();
JSON.stringify({ replayKept, afterUnmount: actor.getSnapshot().status });
=> {"replayKept":true,"afterUnmount":"stopped"}
```

## A definitively refused first send is retryable and releases held follow-ups

```ts
const f = fixture();
f.holdReceipts();
const actor = f.pool.select(start);
await tick();
const first = f.pool.capture(bind(start));
first.send(send("refused-first"));
await tick();
const waitingReceipt = expectReceipt("waiting-followup");
const waiting = f.pool.capture(bind(start));
waiting.send(send("waiting-followup"));
settleReceipt({ disposition: "rejected", emissionId: "refused-first", reason: "invalid model", definitive: true });
actor.send({ type: "STREAM_FAILED", error: "invalid model", accepted: false });
await first.finished();
await waiting.finished();
const saved = new StartRecords(f.storage, "test1").get("logical-new");
f.acceptReceipts();
const retry = f.pool.capture(bind(start));
retry.send(send("refused-first"));
await retry.finished();
const result = { stateAfterRefusal: saved.state, firstID: saved.firstEmissionId, heldDisposition: (await waitingReceipt).disposition,
  postedIDs: f.sends.map((entry) => entry.messageId) };
f.pool.suspend();
JSON.stringify(result)
=> {"stateAfterRefusal":"prepared","firstID":"refused-first","heldDisposition":"rejected","postedIDs":["refused-first","refused-first"]}
```

## Uncertain rejection releases waiters but keeps restart recovery-only

```ts
const f = fixture();
f.holdReceipts();
const actor = f.pool.select(start);
await tick();
const first = f.pool.capture(bind(start));
first.send(send("uncertain-first"));
await tick();
const waitingReceipt = expectReceipt("uncertain-followup");
const waiting = f.pool.capture(bind(start));
waiting.send(send("uncertain-followup"));
settleReceipt({ disposition: "rejected", emissionId: "uncertain-first", reason: "network response lost" });
actor.send({ type: "STREAM_FAILED", error: "network response lost", accepted: false });
await first.finished();
await waiting.finished();
const saved = new StartRecords(f.storage, "test1").get("logical-new");
f.pool.suspend();
JSON.stringify({ state: saved.state, posted: f.sends.length, heldDisposition: (await waitingReceipt).disposition })
=> {"state":"attempted","posted":1,"heldDisposition":"rejected"}
```

## Restore and edit may start again, but a pre-refusal capture cannot

```ts
const f = fixture();
f.holdReceipts();
const actor = f.pool.select(start);
await tick();
const first = f.pool.capture(bind(start));
first.send(send("replace-first"));
await tick();
const delayed = f.pool.capture(bind(start)); // attachments still preparing
settleReceipt({ disposition: "rejected", emissionId: "replace-first", reason: "invalid request", definitive: true });
actor.send({ type: "STREAM_FAILED", error: "invalid request", accepted: false });
await first.finished();
const delayedReceipt = expectReceipt("replace-delayed");
delayed.send(send("replace-delayed"));
await delayed.finished();
f.acceptReceipts();
const edited = f.pool.capture(bind(start)); // a new gesture after Restore/edit
edited.send(send("replace-edited"));
await edited.finished();
const record = new StartRecords(f.storage, "test1").get("logical-new");
const result = { refusedDelayed: (await delayedReceipt).disposition, firstID: record.firstEmissionId, postedIDs: f.sends.map((entry) => entry.messageId) };
f.pool.suspend();
JSON.stringify(result)
=> {"refusedDelayed":"rejected","firstID":"replace-edited","postedIDs":["replace-first","replace-edited"]}
```

## Accepted startup without init has a bounded visible wait and releases its actor

```ts
const f = fixture();
f.pool.suspend();
const pool = new ConversationControllerPool("test1", { ...f.options, aliasWaitMs: 50 });
const actor = pool.select(start);
await tick();
const first = pool.capture(bind(start));
first.send(send("no-init-first"));
await first.finished();
const receipt = expectReceipt("no-init-followup");
const waiting = pool.capture(bind(start));
waiting.send(send("no-init-followup"));
actor.send({ type: "STREAM_FAILED", error: "engine crashed", accepted: true });
await waiting.finished();
const record = new StartRecords(f.storage, "test1").get("logical-new");
// Release the selection; the uncertain alias wait itself must not pin this actor.
pool.select(session("elsewhere"));
await tick();
const result = { disposition: (await receipt).disposition, state: record.state, firstID: record.firstEmissionId, posted: f.sends.length, actor: actor.getSnapshot().status };
pool.suspend();
JSON.stringify(result)
=> {"disposition":"rejected","state":"accepted","firstID":"no-init-first","posted":1,"actor":"stopped"}
```
