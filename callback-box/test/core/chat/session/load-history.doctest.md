# Coalescing identical history reads

`loadSessionHistory` is the one door every request-driven transcript read goes
through (`chat.history`, `chat.bootstrap`, `ChatSession.getHistory`). A phone
reconnecting fires those in a burst — with retries and no backoff — and each one
used to re-parse the whole JSONL: ~50 MB of transient heap per request on prod's
15.5 MB session, stacking linearly to the 1.9 GB V8 cap. That killed `cb serve`
four times on 2026-08-03/04
(`issues/bugs/2026-08-04-chat-history-parse-transient-oom.md`).

Concurrent callers asking for the *same* read now share one parse.

```ts setup
import { loadSessionHistory, sessionHistoryReadStats } from "../../../../src/core/chat/session/load-history.js";
import { getSessionLogPath } from "../../../../src/core/chat/session/transcript-paths.js";
import { makeTmpBox } from "../../../helpers/doctest-helpers.js";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { dirname } from "node:path";

const SESSION = "11111111-2222-3333-4444-555555555555";
const TAIL = { mode: "tail", tail: 200, minRealUserMessages: 2 };

function line(i) {
  return JSON.stringify({
    type: "user",
    uuid: `u${i}`,
    timestamp: `2026-01-01T00:0${i}:00Z`,
    message: { role: "user", content: [{ type: "text", text: `<typed>Message ${i}</typed>` }] },
  });
}

// Write the transcript where `resolveSessionLogPath` will look for it.
async function seed(boxRoot, count) {
  const logPath = getSessionLogPath(boxRoot, SESSION);
  await mkdir(dirname(logPath), { recursive: true });
  const lines = [];
  for (let i = 0; i < count; i++) lines.push(line(i));
  await writeFile(logPath, lines.join("\n") + "\n");
  return logPath;
}

// Reads performed since a marker — the seam coalescing is visible through.
function readsSince(before) {
  return sessionHistoryReadStats().reads - before;
}
```

## Ten concurrent identical reads, one parse

```ts
const box = await makeTmpBox();
process.env["CB_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");
await seed(box.root, 6);

const before = sessionHistoryReadStats().reads;
const results = await Promise.all(
  Array.from({ length: 10 }, () => loadSessionHistory(box.root, { sessionId: SESSION, slice: TAIL })),
);
print(`parses: ${readsSince(before)}`);
print(`all answered: ${results.every((r) => r.entries.length === 6)}`);
print(`shared object: ${results.every((r) => r.entries === results[0].entries)}`);
=>
parses: 1
all answered: true
shared object: true
```

The window is shared, so it is frozen — a caller that starts mutating its
answer would be corrupting every peer's:

```ts continue
Object.isFrozen(results[0].entries)
=> true
```

The map empties as soon as the read settles. It is a coalescing window, not a
cache:

```ts continue
sessionHistoryReadStats().inFlight
=> 0
```

So a caller arriving *after* the resolution reads the file again:

```ts continue
const after = sessionHistoryReadStats().reads;
await loadSessionHistory(box.root, { sessionId: SESSION, slice: TAIL });
readsSince(after)
=> 1
```

## Different reads never share an answer

The key is `(logPath, slice)`, not the session. A page-mode request and the chat
page's tail request read the same file into different windows, so they must not
coalesce with each other — nor with a different session's read:

```ts continue
const mixed = sessionHistoryReadStats().reads;
const [tail, page, other] = await Promise.all([
  loadSessionHistory(box.root, { sessionId: SESSION, slice: TAIL }),
  loadSessionHistory(box.root, { sessionId: SESSION, slice: { mode: "page", offset: 0, limit: 2 } }),
  loadSessionHistory(box.root, { sessionId: "99999999-8888-7777-6666-555555555555", slice: TAIL }),
]);
print(`parses: ${readsSince(mixed)}`);
print(`tail: ${tail.entries.length}, page: ${page.entries.length}, other: ${other.entries.length}`);
=>
parses: 3
tail: 6, page: 2, other: 0
```

A tail that differs only in `minRealUserMessages` is a different window too:

```ts continue
const widened = sessionHistoryReadStats().reads;
await Promise.all([
  loadSessionHistory(box.root, { sessionId: SESSION, slice: { mode: "tail", tail: 200 } }),
  loadSessionHistory(box.root, { sessionId: SESSION, slice: { mode: "tail", tail: 200, minRealUserMessages: 2 } }),
]);
readsSince(widened)
=> 2
```

```ts cleanup
delete process.env["CB_CLAUDE_PROJECTS_DIR"];
await box.cleanup();
```

## `fresh: true` never joins an in-flight scan

A caller reading BECAUSE it knows the transcript just changed (the
post-turn-completion broadcast in `chat-schedule-fire.ts`) must get its own
read, not the answer of a scan that started before the change: it neither
joins nor registers itself in the coalescing map.

```ts
const box = await makeTmpBox();
process.env["CB_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");
await seed(box.root, 6);

const before = sessionHistoryReadStats().reads;
const [ordinary, fresh] = await Promise.all([
  loadSessionHistory(box.root, { sessionId: SESSION, slice: TAIL }),
  loadSessionHistory(box.root, { sessionId: SESSION, slice: TAIL, fresh: true }),
]);
print(`parses: ${readsSince(before)}`);
print(`shared object: ${ordinary.entries === fresh.entries}`);
=>
parses: 2
shared object: false
```

A `fresh` read also isn't visible to *other* callers to join — it never
occupies the `inFlight` slot:

```ts continue
const beforeOrdinary = sessionHistoryReadStats().reads;
const [freshAlone, twoOrdinary] = await Promise.all([
  loadSessionHistory(box.root, { sessionId: SESSION, slice: TAIL, fresh: true }),
  Promise.all([
    loadSessionHistory(box.root, { sessionId: SESSION, slice: TAIL }),
    loadSessionHistory(box.root, { sessionId: SESSION, slice: TAIL }),
  ]),
]);
print(`parses: ${readsSince(beforeOrdinary)}`);
print(`the two ordinary reads shared one parse: ${twoOrdinary[0].entries === twoOrdinary[1].entries}`);
=>
parses: 2
the two ordinary reads shared one parse: true
```

```ts cleanup
delete process.env["CB_CLAUDE_PROJECTS_DIR"];
await box.cleanup();
```

## A transcript that appears later is picked up

A missing JSONL is a normal state (a brand-new chat), and it answers empty. That
answer is *not* remembered: the next call re-reads, so the file the session is
about to write is visible as soon as it exists. This is why the in-flight entry
is dropped on settle rather than kept.

```ts
const box = await makeTmpBox();
process.env["CB_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");

const empty = await loadSessionHistory(box.root, { sessionId: SESSION, slice: TAIL });
print(`before: ${empty.entries.length} entries, total ${empty.total}`);

await seed(box.root, 3);
const found = await loadSessionHistory(box.root, { sessionId: SESSION, slice: TAIL });
print(`after: ${found.entries.length} entries, total ${found.total}`);
=>
before: 0 entries, total 0
after: 3 entries, total 3
```

A failed read is dropped from the map too — it is never handed to a later
caller. Pointing the session at a *directory* makes the read fail with EISDIR
(not the ENOENT that legitimately means "no transcript yet"), and the loader
rethrows rather than reporting an empty conversation:

```ts continue
const logPath = getSessionLogPath(box.root, SESSION);
await rm(logPath);
await mkdir(logPath);

const before = sessionHistoryReadStats().reads;
const failures = await Promise.allSettled(
  Array.from({ length: 3 }, () => loadSessionHistory(box.root, { sessionId: SESSION, slice: TAIL })),
);
print(`parses: ${readsSince(before)}`);
print(`rejected: ${failures.filter((r) => r.status === "rejected").length}`);
print(`in flight after: ${sessionHistoryReadStats().inFlight}`);
=>
parses: 1
rejected: 3
in flight after: 0
```

```ts cleanup
delete process.env["CB_CLAUDE_PROJECTS_DIR"];
await box.cleanup();
```
