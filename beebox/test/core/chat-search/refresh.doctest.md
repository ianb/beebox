# chat-search refresh + query: incremental index over chat transcripts

The lazy refresh turns the box's chat husks and their engine transcripts
into a chunk index (`src/core/chat-search/`). Fixtures seed Claude-format
JSONL transcripts under `BBX_CLAUDE_PROJECTS_DIR` exactly the way the chat
review discovery tests do; Codex sessions are exercised through the shared
entry adapter elsewhere (its reader is the app-server RPC, not fixture
files).

```ts setup
import { mkdir, rm, utimes, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { getSessionLogPath } from "../../../src/core/chat/session/transcript-paths.js";
import { searchChats } from "../../../src/core/chat-search/query.js";
import { loadChatManifest } from "../../../src/core/chat-search/manifest.js";
import { chatSearchStore } from "../../../src/core/chat-search/store.js";

const T0 = new Date("2026-09-28T12:00:00Z");

function userEntry(uuid: string, text: string, at: string) {
  return { type: "user", uuid, timestamp: at, message: { role: "user", content: [{ type: "text", text }] } };
}

function assistantEntry(uuid: string, text: string, at: string) {
  return { type: "assistant", uuid, timestamp: at, message: { role: "assistant", content: [{ type: "text", text }] } };
}

async function seed(box, opts: {
  sessionId: string;
  entries: object[];
  mtime: Date;
  title?: string;
}) {
  const title = opts.title === undefined ? "" : `title: ${JSON.stringify(opts.title)}\n`;
  await box.write(
    `_content/chat/web/2026-09-28_${opts.sessionId}.chat.card`,
    `---\nsession: ${opts.sessionId}\nengine: claude\n${title}---\n\n`
  );
  await writeTranscript(box, opts.sessionId, opts.entries, opts.mtime);
}

async function writeTranscript(box, sessionId: string, entries: object[], mtime: Date) {
  const logPath = getSessionLogPath(box.root, sessionId);
  await mkdir(dirname(logPath), { recursive: true });
  await writeFile(logPath, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  await utimes(logPath, mtime, mtime);
}
```

## First query builds the index and finds the chat that said it

```ts
const box = await makeTmpBox();
process.env["BBX_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");

await seed(box, {
  sessionId: "sess-roof",
  entries: [
    userEntry("u1", "Did the insurance claim go through?", "2026-09-27T09:00:00Z"),
    assistantEntry("a1", "Yes — the roof claim was approved on Tuesday.", "2026-09-27T09:01:00Z"),
  ],
  mtime: T0,
  title: "Insurance follow-up",
});

const result = await searchChats(box.root, { query: "roof claim" });

result.total
=> 1

result.results[0].sessionId
=> sess-roof

result.results[0].anchor
=> u1

result.results[0].title
=> Insurance follow-up

result.results[0].snippet.includes("roof")
=> true

result.stale
=> false
```

The manifest recorded the cursor the next refresh diffs against.

```ts continue
const manifest = await loadChatManifest(box.root);
const record = manifest.sessions["sess-roof"];

JSON.stringify({ engine: record.engine, entryCount: record.entryCount, docs: record.docIds.length })
=> {"engine":"claude","entryCount":2,"docs":1}
```

## An appended turn is findable immediately, and only the new tail is chunked

```ts continue
await writeTranscript(
  box,
  "sess-roof",
  [
    userEntry("u1", "Did the insurance claim go through?", "2026-09-27T09:00:00Z"),
    assistantEntry("a1", "Yes — the roof claim was approved on Tuesday.", "2026-09-27T09:01:00Z"),
    userEntry("u2", "What about the deductible on the solar panels?", "2026-09-28T11:00:00Z"),
    assistantEntry("a2", "The panel deductible is separate: $500.", "2026-09-28T11:01:00Z"),
  ],
  new Date("2026-09-28T12:05:00Z")
);

const updated = await searchChats(box.root, { query: "deductible panels" });

updated.total
=> 1

updated.results[0].anchor
=> u2

const after = await loadChatManifest(box.root);
const afterRecord = after.sessions["sess-roof"];

afterRecord.entryCount
=> 4

afterRecord.docIds.length
=> 2
```

The first chunk is untouched — its doc id is stable across the append, so
a persisted index only ever inserts.

```ts continue
afterRecord.docIds[0]
=> sess-roof#u1

afterRecord.docIds.includes("sess-roof#u2")
=> true
```

## Two chats match: one row each, better score first

```ts continue
await seed(box, {
  sessionId: "sess-other",
  entries: [
    userEntry("v1", "Remind me to clean the panels on the roof this weekend.", "2026-09-20T09:00:00Z"),
  ],
  mtime: new Date("2026-09-20T10:00:00Z"),
});

const both = await searchChats(box.root, { query: "panels" });

both.total
=> 2

both.results.map((r) => r.sessionId).includes("sess-roof")
=> true

both.results.map((r) => r.sessionId).includes("sess-other")
=> true
```

## A rewritten (shortened) transcript rebuilds its session's docs

```ts continue
await writeTranscript(
  box,
  "sess-roof",
  [userEntry("w1", "Fresh start: piano tuning.", "2026-09-28T12:00:00Z")],
  new Date("2026-09-28T12:10:00Z")
);

const rebuilt = await searchChats(box.root, { query: "piano tuning" });

rebuilt.total
=> 1

const rebuiltManifest = await loadChatManifest(box.root);

JSON.stringify(rebuiltManifest.sessions["sess-roof"].docIds)
=> ["sess-roof#w1"]
```

The pre-rewrite material is gone from the index — old chunks pointed at a
transcript that no longer says it:

```ts continue
const gone = await searchChats(box.root, { query: "roof claim deductible" });

gone.results.map((r) => r.sessionId).includes("sess-roof")
=> false
```

## Deleting the husk drops the session's docs

```ts continue
await rm(box.path("_content/chat/web/2026-09-28_sess-other.chat.card"));

const afterDelete = await searchChats(box.root, { query: "panels" });

afterDelete.total
=> 0

const finalManifest = await loadChatManifest(box.root);

JSON.stringify(Object.keys(finalManifest.sessions))
=> ["sess-roof"]
```

## A blank query matches nothing without touching the index

```ts continue
const blank = await searchChats(box.root, { query: "   " });

JSON.stringify({ total: blank.total, results: blank.results.length, stale: blank.stale })
=> {"total":0,"results":0,"stale":false}
```

The index is a disposable cache beside the manifest:

```ts continue
(await chatSearchStore.restore(box.root)) !== null
=> true
```

```ts cleanup
delete process.env["BBX_CLAUDE_PROJECTS_DIR"];
await box.cleanup();
```
