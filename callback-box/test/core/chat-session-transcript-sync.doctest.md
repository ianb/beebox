# Transcript durability gate

The Claude CLI emits a turn's `result` over stdout *before* it flushes the
final assistant entry to the transcript `.jsonl` (~150ms lag, measured).
Consumers refetch history the moment a turn ends — the chat UI's
STREAM_RESULT refresh, other tabs reacting to `chat-complete` — so without a
gate the refetch reads a transcript missing the final message and the reply
silently vanishes until some later refetch (the "final segment doesn't render
until reload" bug). `ChatSession` therefore holds `result`/`done` until the
transcript contains the turn's last assistant entry, matched by the SDK
message `uuid` (which is verbatim the transcript line's `uuid`).

Transcript files live under `~/.claude/projects/<munged box path>/`, so like
`chat-session-history.doctest.md` these tests seed JSONLs at the resolved
path and remove that directory afterwards.

```ts setup
import { once } from "node:events";
import { mkdir, writeFile, appendFile, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { ChatSession } from "../../src/core/chat/session/index.js";
import { createFakeChatBackend } from "../../src/services/claude-chat.js";
import { waitForTranscriptEntry } from "../../src/core/chat/session/transcript-sync.js";
import { resolveSessionLogPath } from "../../src/core/chat/session/history.js";
import { getSessionDir } from "../../src/cli/lib/session.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { tick, plainTestPrompt } from "../helpers/chat-session-spawner-helpers.js";

const entryLine = (uuid) =>
  JSON.stringify({
    type: "assistant",
    uuid,
    message: { role: "assistant", content: [{ type: "text", text: "hi" }] },
  }) + "\n";
```

## waitForTranscriptEntry: found, missing, late

An entry already on disk resolves `true` immediately; an absent one runs out
the (test-shortened) timeout and resolves `false`; one that lands mid-wait is
picked up by the next poll.

```ts
const box = await makeTmpBox();
const sessionId = "tsync-helper";
const logPath = await resolveSessionLogPath(box.root, sessionId);
await mkdir(dirname(logPath), { recursive: true });
await writeFile(logPath, entryLine("uuid-already-there"));

await waitForTranscriptEntry({ boxRoot: box.root, sessionId, uuid: "uuid-already-there", timeoutMs: 500 })
=> true

await waitForTranscriptEntry({ boxRoot: box.root, sessionId, uuid: "uuid-missing", timeoutMs: 200 })
=> false

const pending = waitForTranscriptEntry({ boxRoot: box.root, sessionId, uuid: "uuid-late", timeoutMs: 3000 });
setTimeout(() => { void appendFile(logPath, entryLine("uuid-late")); }, 100);
await pending
=> true
```

```ts cleanup
await rm(getSessionDir(box.root), { recursive: true, force: true });
await box.cleanup();
```

## ChatSession holds `done` until the final assistant entry is flushed

A turn whose assistant message carries a uuid must not surface `result`/
`done` while the transcript lacks that entry. Appending the entry releases
the gate within a poll interval.

```ts
const box = await makeTmpBox();
const backend = createFakeChatBackend();
const session = new ChatSession(box.root, { backend, systemPrompt: plainTestPrompt, skipBootstrap: true });
await session.send("hello");
await tick();
const run = backend.lastRun();
run?.emitSessionInit("tsync-gate");
await tick();
const logPath = await resolveSessionLogPath(box.root, "tsync-gate");
await mkdir(dirname(logPath), { recursive: true });
await writeFile(logPath, entryLine("seg-1-uuid"));
let doneFired = false;
session.on("done", () => { doneFired = true; });
run?.emitMessage({
  type: "assistant",
  uuid: "final-uuid",
  session_id: "tsync-gate",
  parent_tool_use_id: null,
  message: { role: "assistant", content: [{ type: "text", text: "final segment" }] },
});
run?.emitResult();
await sleep(200);

doneFired
=> false

const done = once(session, "done");
await appendFile(logPath, entryLine("final-uuid"));
await done;
doneFired
=> true
```

```ts cleanup
session.stop();
await rm(getSessionDir(box.root), { recursive: true, force: true });
await box.cleanup();
```

## No assistant uuid → no wait

Turns whose messages carry no uuid (the fake backend's plain helpers, or an
errored turn with no assistant output) skip the gate entirely — `done` fires
promptly even though no transcript file exists at all.

```ts
const box = await makeTmpBox();
const backend = createFakeChatBackend();
const session = new ChatSession(box.root, { backend, systemPrompt: plainTestPrompt, skipBootstrap: true });
await session.send("hello");
await tick();
const run = backend.lastRun();
const done = once(session, "done");
run?.emitSessionInit("tsync-nouid");
run?.emitAssistantText("plain reply");
const t0 = Date.now();
run?.emitResult();
await done;

Date.now() - t0 < 1000
=> true
```

```ts cleanup
session.stop();
await box.cleanup();
```
