# Chat Review: journal state

`.beebox/chat-review/state.json` records, per session, which transcript
spans have been folded into the account and who owns the husk's title.

Unlike the retrospective walker's state — a terminal "done, never look again"
flag — this is a journal: a session is re-read every time it grows, so what is
stored is a boundary, not a finished marker.

Losing this file is cheap by design: the worst case is one redundant pass per
session, and the applied-span id on the husk turns even that into a no-op.

```ts setup
import { makeTmpBox } from "../../../helpers/doctest-helpers.js";
import {
  MAX_REVIEW_ATTEMPTS,
  emptyReviewState,
  emptySessionState,
  loadReviewState,
  saveReviewState,
  sessionState,
  removeSessionFromReview,
} from "../../../../src/core/chat/review/state.js";
import { withChatReviewLock } from "../../../../src/core/chat/review/lock.js";
import { runChatReview } from "../../../../src/core/chat/review/run/core.js";
import { getSessionLogPath } from "../../../../src/core/chat/session/transcript-paths.js";
import { appendFile, mkdir, utimes, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

async function errorName(fn: () => Promise<unknown>): Promise<string> {
  try { await fn(); return "no error"; }
  catch (error) { return error instanceof Error ? error.name : "unknown"; }
}
```

## An unseen session reads as a bootstrap, with no journal entry

```ts
const state = emptyReviewState();
JSON.stringify(sessionState(state, "never-seen"))
=> {"applied":{},"titleOwner":"unmanaged","titleHash":null,"attempts":0}
```

## Round-trips through disk

```ts
const box = await makeTmpBox();
const state = emptyReviewState();
state.lastRunAt = "2026-07-28T04:00:00Z";
state.sessions["s1"] = {
  applied: {
    metadata: {
      spanId: "abc123", endUuid: "u-9", endIndex: 8,
      prefixHash: "def456", at: "2026-07-28T04:00:00Z",
    },
  },
  titleOwner: "generated",
  titleHash: "hash-of-title",
  attempts: 0,
};
await saveReviewState(box.root, state);

const reloaded = await loadReviewState(box.root);
JSON.stringify(reloaded.sessions["s1"].applied.metadata.endUuid)
=> "u-9"
```

## Missing, corrupt, and mis-shaped files all start fresh

A malformed state file must not stop the night's run — re-reviewing is
recoverable, refusing to run is not.

```ts continue
await box.write(".beebox/chat-review/state.json", "{not json at all");
JSON.stringify(await loadReviewState(box.root))
=> {"lastRunAt":null,"sessions":{}}
```

```ts continue
await box.write(".beebox/chat-review/state.json", JSON.stringify({ sessions: "wrong shape" }));
JSON.stringify(await loadReviewState(box.root))
=> {"lastRunAt":null,"sessions":{}}
```

```ts continue
const fresh = await makeTmpBox();
JSON.stringify(await loadReviewState(fresh.root))
=> {"lastRunAt":null,"sessions":{}}

await fresh.cleanup();
```

```ts cleanup
await box.cleanup();
```

## In-process review contention fails fast

```ts
const box = await makeTmpBox();
let releaseGate: (() => void) | undefined;
let markStarted: (() => void) | undefined;
const started = new Promise<void>((resolve) => { markStarted = resolve; });
const gate = new Promise<void>((resolve) => { releaseGate = resolve; });
const first = withChatReviewLock(box.root, { holder: "first", fn: async () => { markStarted?.(); await gate; } });
await started;
const second = await errorName(() => withChatReviewLock(box.root, { holder: "second", fn: async () => {} }));
releaseGate?.();
await first;
second
=> LockHeldError
```

```ts cleanup
await box.cleanup();
```

## Removing one session preserves the journal

```ts
const box = await makeTmpBox();
const state = emptyReviewState();
state.lastRunAt = "2026-08-07T12:00:00Z";
state.sessions.gone = emptySessionState();
state.sessions.keep = emptySessionState();
await saveReviewState(box.root, state);
const removed = await removeSessionFromReview(box.root, "gone");
const after = await loadReviewState(box.root);
JSON.stringify({ removed: removed !== null, lastRunAt: after.lastRunAt, sessions: Object.keys(after.sessions) })
=> {"removed":true,"lastRunAt":"2026-08-07T12:00:00Z","sessions":["keep"]}
```

```ts cleanup
await box.cleanup();
```

## Give-up is per span: a session that exhausted span A is retried on span B

A session whose reviewer fails `MAX_REVIEW_ATTEMPTS` times on one span is
skipped for that span (`exhausted`), but new material is a new span, so the
same session is retried. A few nights of provider trouble cannot retire a
session for good. This drives `runChatReview` with a reviewer that records its
calls.

```ts
const box = await makeTmpBox();
process.env["BBX_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");
const NOW = new Date("2026-07-28T12:00:00Z");
const sessionId = "5b1f3c1e-2d4a-4e6b-8c7d-9e0f1a2b3c4d";
const entry = (uuid: string) => JSON.stringify({
  type: "user", uuid, timestamp: "2026-07-28T03:00:00Z",
  message: { role: "user", content: [{ type: "text", text: "a".repeat(4000) }] },
});
const logPath = getSessionLogPath(box.root, sessionId);
const backdate = () => utimes(logPath, new Date("2026-07-28T07:00:00Z"), new Date("2026-07-28T07:00:00Z"));
await box.write(`_content/chat/web/2026-07-28_span.chat.card`, `---\nsession: ${sessionId}\n---\n\n`);
await mkdir(dirname(logPath), { recursive: true });
await writeFile(logPath, [entry("a1"), entry("a2")].join("\n") + "\n");
await backdate();

let reviewerCalls = 0;
const failing = {
  async review() { reviewerCalls += 1; throw new Error("model unavailable"); },
  async title() { throw new Error("unexpected title call"); },
};
const run = () => runChatReview(box.root, { reviewer: failing, maxSessions: 10, now: NOW, ownerEmail: null });

// MAX_REVIEW_ATTEMPTS failing runs on span A, then one more that must skip it.
for (let i = 0; i < MAX_REVIEW_ATTEMPTS; i++) await run();
const skipped = await run();
const onSpanA = { calls: reviewerCalls, exhausted: skipped.exhausted };

// New material makes a new span: the reviewer is asked again.
await appendFile(logPath, entry("b1") + "\n");
await backdate();
const retried = await run();
JSON.stringify({ onSpanA, onSpanB: { calls: reviewerCalls, exhausted: retried.exhausted, failures: retried.reviewerFailures } })
=> {"onSpanA":{"calls":2,"exhausted":1},"onSpanB":{"calls":3,"exhausted":0,"failures":1}}
```

```ts cleanup
await box.cleanup();
```
