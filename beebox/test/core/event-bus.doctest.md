# EventBus read-side validation

The bus persists events in SQLite and replays them across reconnects and
processes — rows that did NOT come through the typed `emit` surface. `parseRows`
therefore validates every row read back against the per-event zod schemas in
`event-bus-schemas.ts` (the same schemas `EventMap` is derived from). A row that
fails — bad JSON, an unknown event name, or a schema mismatch — degrades to a
logged, counted `event: "unknown"` sentinel instead of corrupting the stream or
killing dispatch of its siblings.

Persisted rows are a reconnect bridge, not a source of truth: on bus open an
`EVENT_SCHEMA_GENERATION` mismatch truncates the events table so clients
reconnecting across a deploy resync instead of replaying stale-shaped rows.

```ts setup
import Database from "better-sqlite3";
import { join } from "node:path";
import { createEventBus, EVENT_SCHEMA_GENERATION } from "../../src/core/event-bus.js";
import { eventSchemas } from "../../src/core/event-bus-schemas.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

const TS = "2026-07-09T00:00:00.000Z";

// One representative valid payload per event — the exact shape its emit sites
// produce. If a schema were stricter than a real payload, the round-trip below
// would reject a legitimate live row.
const samples = {
  "file-change": { event: "add", path: "notes/a.md", timestamp: TS },
  "chat-last-audio-request": { requestId: "req-1", messageId: "msg-1" },
  "screenshot-request": { requestId: "req-1", session: "s1", expiresAt: TS },
  "ui-scan-request": { requestId: "req-2", session: "s1", expiresAt: TS },
  "card-created": { path: "Voice.voice-memo.card", template: "voice-memo", timestamp: TS, audioPath: "attach/a.webm" },
  "command-complete": { command: "wakeup", success: true, timestamp: TS },
  "question-answered": { path: "Q.question.card", answer: "yes", selectedId: "opt-1", timestamp: TS },
  "question-dismissed": { path: "Q.question.card", timestamp: TS },
  "question-expired": { path: "Q.question.card", timestamp: TS },
  "cards-changed": { source: "telegram" },
  "chat-user-message": { sessionId: "s1", message: "hi", user: { email: "a@example.com", name: "Ada" }, timestamp: TS },
  "chat-complete": { sessionId: "s1", timestamp: TS },
  "chat-task": { sessionId: "s1", task: { phase: "started", taskId: "t1", status: "running", description: "Generate image" } },
  "chat-features-changed": { sessionId: "s1", features: { theme: "dark" } },
  "schedule-fired": { id: "sch_1", label: "tea", alarm: true, announce: null },
  "chat-history": { sessionId: "s1", entries: [{ uuid: "u1", type: "user", timestamp: TS, content: [{ type: "text", text: "hi" }] }] },
  "chat-session-assigned": { sessionId: "s1" },
  "capture-status": { stagingId: "cap_1", sessionId: "s1", status: "preparing", docPath: "captures/cap_1.capture-session.card" },
  "chat-retranscription": { sessionId: "s1", messageId: "msg-1", newText: "corrected text", service: "whisper", diarized: false, recordedAt: TS },
  "chat-audio-consulted": { sessionId: "s1", messageId: "msg-1", command: "ask-about-audio", question: "did I say can or cannot?" },
};
```

## Every event round-trips through its schema

The sample catalog covers all 20 events, and each parses cleanly against the
schema the read boundary uses:

```ts
Object.keys(samples).length
=> 20

JSON.stringify(Object.keys(samples).sort()) === JSON.stringify(Object.keys(eventSchemas).sort())
=> true

const failures = Object.entries(samples).filter((e) => !eventSchemas[e[0]].safeParse(e[1]).success).map((e) => e[0]);
JSON.stringify(failures)
=> []
```

## Nullable fields accept both branches

`chat-user-message.user`, `chat-complete.sessionId`, and `schedule-fired.announce`
are all nullable — the null branch is legal:

```ts
eventSchemas["chat-user-message"].safeParse({ sessionId: null, message: "hi", user: null, timestamp: TS }).success
=> true

eventSchemas["schedule-fired"].safeParse({ id: "s", label: "l", alarm: false, announce: "wake up" }).success
=> true
```

## A one-sided answer is valid

An answer carries only `answer` OR `selectedId`; `JSON.stringify` drops the
undefined one, so the persisted row omits it. Both must stay optional (Zod v4
treats a bare `z.unknown()` object property as required):

```ts
eventSchemas["question-answered"].safeParse({ path: "Q.question.card", selectedId: "opt-1", timestamp: TS }).success
=> true

eventSchemas["question-answered"].safeParse({ path: "Q.question.card", answer: "freeform", timestamp: TS }).success
=> true
```

## A persisted event reads back byte-identical

Validation gates, it never transforms: a valid row reaches consumers exactly as
emitted. Persist a card-created (with its optional `audioPath`) and read it back:

```ts
const box = await makeTmpBox();
const bus = createEventBus(box.root);
bus.emit("card-created", samples["card-created"]);
const rows = bus.readSince(0);
JSON.stringify(rows.map((r) => r.event))
=> ["card-created"]

JSON.stringify(rows[0].data)
=> {"path":"Voice.voice-memo.card","template":"voice-memo","timestamp":"2026-07-09T00:00:00.000Z","audioPath":"attach/a.webm"}
```

```ts cleanup
bus.close();
await box.cleanup();
```

## readRecent — a bounded tail of one event type

`readSince(afterId)` answers "what have I missed", which needs a cursor the
caller has been holding. A page load has no cursor: it is asking what the box
knows right now, and the only bounded honest answer is a recent slice of one
type. `chat.bootstrap` reads the messages the box accepted this way.

Newest-first is how the bound should bite — the recent end is the end the
question is about — but every consumer reads a conversation forwards, so the
result comes back oldest-first:

```ts
const box2 = await makeTmpBox();
const bus2 = createEventBus(box2.root);
for (const source of ["a", "b", "c", "d"]) bus2.emit("cards-changed", { source });
bus2.emit("chat-complete", { sessionId: "s-1", timestamp: TS });

bus2.readRecent({ event: "cards-changed", limit: 3 }).map((e) => e.data.source).join(",")
=> b,c,d
```

It answers about one type only — a busier neighbouring event stream cannot
crowd out the answer:

```ts continue
JSON.stringify(bus2.readRecent({ event: "chat-complete", limit: 10 }).map((e) => e.event))
=> ["chat-complete"]
```

A type nothing has emitted is empty, not an error:

```ts continue
bus2.readRecent({ event: "chat-user-message", limit: 10 }).length
=> 0
```

```ts cleanup
bus2.close();
await box2.cleanup();
```

## A bad row degrades to a sentinel without breaking its siblings

Emit one valid row, then hand-write three broken ones directly into SQLite: a
schema violation, malformed JSON, and an unknown event name. All four rows
dispatch — the three bad ones as `unknown` sentinels, the valid one intact:

```ts
const box = await makeTmpBox();
const bus = createEventBus(box.root);
bus.emit("cards-changed", { source: "telegram" });

const dbPath = join(box.root, ".beebox/events.db");
const raw = new Database(dbPath);
const ins = raw.prepare("INSERT INTO events (event, data) VALUES (?, ?)");
ins.run("card-created", JSON.stringify({ path: 123 }));   // schema mismatch
ins.run("cards-changed", "{not json");                     // syntax-level failure
ins.run("mystery-event", JSON.stringify({ x: 1 }));        // unknown event name
raw.close();

const rows = bus.readSince(0);
JSON.stringify(rows.map((r) => r.event))
=> ["cards-changed","unknown","unknown","unknown"]
```

The valid sibling keeps its real payload; a sentinel carries the original event
name and raw payload for debugging:

```ts continue
JSON.stringify(rows[0].data)
=> {"source":"telegram"}

rows[1].data.originalEvent
=> card-created
```

```ts cleanup
bus.close();
await box.cleanup();
```

## A generation mismatch truncates persisted rows on open

Persist two rows, then simulate a deploy that bumped the schema generation by
rewriting the stored generation to an older value. Reopening the bus truncates
the now-stale rows so nothing gets replayed against the new schemas:

```ts
const box = await makeTmpBox();
const bus1 = createEventBus(box.root);
bus1.emit("cards-changed", { source: "a" });
bus1.emit("cards-changed", { source: "b" });
bus1.readSince(0).length
=> 2
```

```ts continue
bus1.close();

const raw = new Database(join(box.root, ".beebox/events.db"));
raw.prepare("UPDATE event_meta SET schema_generation = ? WHERE id = 1").run(EVENT_SCHEMA_GENERATION - 1);
raw.close();

const bus2 = createEventBus(box.root);
bus2.readSince(0).length
=> 0
```

```ts cleanup
bus2.close();
await box.cleanup();
```

## A legacy DB (no meta row) drops its pre-generation rows on first open

A box upgraded from before generation stamping has an events table full of
rows of unknown shape and no `event_meta`. Opening the bus for the first time
under the new code truncates them rather than replaying stale-shaped data:

```ts
const box = await makeTmpBox();
const legacyPath = join(box.root, ".beebox");
await box.write(".beebox/.keep", "");
const legacy = new Database(join(legacyPath, "events.db"));
legacy.exec("CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, event TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))");
legacy.prepare("INSERT INTO events (event, data) VALUES (?, ?)").run("cards-changed", JSON.stringify({ source: "old" }));
legacy.close();

const bus = createEventBus(box.root);
bus.readSince(0).length
=> 0
```

```ts cleanup
bus.close();
await box.cleanup();
```
