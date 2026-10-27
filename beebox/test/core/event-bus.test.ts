// # EventBus read-side validation
//
// The bus persists events in SQLite and replays them across reconnects and
// processes — rows that did NOT come through the typed `emit` surface. `parseRows`
// therefore validates every row read back against the per-event zod schemas in
// `event-bus-schemas.ts` (the same schemas `EventMap` is derived from). A row that
// fails — bad JSON, an unknown event name, or a schema mismatch — degrades to a
// logged, counted `event: "unknown"` sentinel instead of corrupting the stream or
// killing dispatch of its siblings.
//
// Persisted rows are a reconnect bridge, not a source of truth: on bus open an
// `EVENT_SCHEMA_GENERATION` mismatch truncates the events table so clients
// reconnecting across a deploy resync instead of replaying stale-shaped rows.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any } from "@ianbicking/tap-check/check";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { assertEventSchemaNotNewer, createEventBus, EVENT_SCHEMA_GENERATION } from "../../src/core/event-bus/core.js";
import { eventSchemas, isBusEventName } from "../../src/core/event-bus/schemas.js";
import { makeTmpBox } from "../helpers/test-helpers.js";

const TS = "2026-07-09T00:00:00.000Z";

// SQLite's `datetime('now')` stamp: it differs on every run.
const createdAt = any(String).matches(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);

// One representative valid payload per event — the exact shape its emit sites
// produce. If a schema were stricter than a real payload, the round-trip below
// would reject a legitimate live row.
const samples = {
  "file-change": { event: "add", path: "notes/a.md", timestamp: TS },
  "chat-last-audio-request": { requestId: "req-1", messageId: "msg-1" },
  "screenshot-request": { requestId: "req-1", session: "s1", expiresAt: TS },
  "ui-scan-request": { requestId: "req-2", session: "s1", expiresAt: TS },
  "card-created": { path: "Voice.doc.card", template: "doc", timestamp: TS, audioPath: "attach/a.webm" },
  "command-complete": { command: "wakeup", success: true, timestamp: TS },
  "question-answered": { path: "Q.question.card", answer: "yes", selectedId: "opt-1", timestamp: TS },
  "question-dismissed": { path: "Q.question.card", timestamp: TS },
  "question-expired": { path: "Q.question.card", timestamp: TS },
  "cards-changed": { source: "gmail" },
  "chat-user-message": { sessionId: "s1", message: "hi", user: { email: "a@example.com", name: "Rosa" }, timestamp: TS },
  "chat-complete": { sessionId: "s1", timestamp: TS },
  "chat-task": { sessionId: "s1", task: { phase: "started", taskId: "t1", status: "running", description: "Generate image" } },
  "chat-task-level": { sessionId: "s1", tasks: [{ taskId: "t1", description: "Generate image" }] },
  "chat-features-changed": { sessionId: "s1", features: { theme: "dark" } },
  "schedule-fired": { id: "sch_1", label: "tea", alarm: true, announce: null },
  "chat-history": { sessionId: "s1", entries: [{ uuid: "u1", type: "user", timestamp: TS, content: [{ type: "text", text: "hi" }] }] },
  "chat-session-assigned": { sessionId: "s1" },
  "chat-title-changed": { sessionId: "s1", title: "Weekend plans" },
  "capture-status": { stagingId: "cap_1", sessionId: "s1", status: "preparing", docPath: "captures/cap_1.capture-session.card" },
  "chat-retranscription": { sessionId: "s1", messageId: "msg-1", newText: "corrected text", service: "whisper", diarized: false, recordedAt: TS },
  "chat-audio-consulted": { sessionId: "s1", messageId: "msg-1", command: "ask-about-audio", question: "did I say can or cannot?" },
  "voice-recording-status": { recordingId: "rec-1", sessionId: "s1", hq: { state: "queued" }, handoff: { mode: "open" } },
  "notification": { id: "n1", title: "Call the vet", body: "", target: "chat:new", loudness: "loud", source: "health-alert", url: "/box/chat?new=1&notification=n1" },
};

// ## Every event round-trips through its schema
//
// The sample catalog covers every event, and each parses cleanly against the
// schema the read boundary uses:
void test("The sample catalog covers every event, and each parses cleanly against the sc...", async (t) => {
  t.check(Object.keys(samples).toSorted(), Object.keys(eventSchemas).toSorted());

  const failures = Object.entries(samples).filter(([name, sample]) => !(isBusEventName(name) && eventSchemas[name].safeParse(sample).success)).map(([name]) => name);
  t.check(failures, []);
});

// ## A one-sided answer is valid
//
// An answer carries only `answer` OR `selectedId`; `JSON.stringify` drops the
// undefined one, so the persisted row omits it. Both must stay optional (Zod v4
// treats a bare `z.unknown()` object property as required):
void test("An answer carries only answer OR selectedId; JSON.stringify drops the undefin...", async (t) => {
  t.check(eventSchemas["question-answered"].safeParse({ path: "Q.question.card", selectedId: "opt-1", timestamp: TS }), {
    success: true,
    data: { path: "Q.question.card", selectedId: "opt-1", timestamp: TS },
  });

  t.check(eventSchemas["question-answered"].safeParse({ path: "Q.question.card", answer: "freeform", timestamp: TS }), {
    success: true,
    data: { path: "Q.question.card", answer: "freeform", timestamp: TS },
  });
});

// ## A persisted event reads back byte-identical
//
// Validation gates, it never transforms: a valid row reaches consumers exactly as
// emitted. Persist a card-created (with its optional `audioPath`) and read it back:
void test("Validation gates, it never transforms:", async (t) => {
  t.teardown(async () => {
    try {
      bus.close();
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const bus = createEventBus(box.root);
  bus.emit("card-created", samples["card-created"]);
  const rows = bus.readSince(0);
  t.check(rows, [{ id: 1, event: "card-created", data: samples["card-created"], createdAt }]);
});

// ## readRecent — a bounded tail of one event type
//
// `readSince(afterId)` answers "what have I missed", which needs a cursor the
// caller has been holding. A page load has no cursor: it is asking what the box
// knows right now, and the only bounded honest answer is a recent slice of one
// type. `chat.bootstrap` reads the messages the box accepted this way.
//
// Newest-first is how the bound should bite — the recent end is the end the
// question is about — but every consumer reads a conversation forwards, so the
// result comes back oldest-first:
void test("readSince(afterId) answers \"what have I missed\", which needs a cursor the cal...", async (t) => {
  t.teardown(async () => {
    try {
      bus2.close();
      await box2.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box2 = await makeTmpBox();
  const bus2 = createEventBus(box2.root);
  for (const source of ["a", "b", "c", "d"]) bus2.emit("cards-changed", { source });
  bus2.emit("chat-complete", { sessionId: "s-1", timestamp: TS });

  t.check(bus2.readRecent({ event: "cards-changed", limit: 3 }), [
    { id: 2, event: "cards-changed", data: { source: "b" }, createdAt },
    { id: 3, event: "cards-changed", data: { source: "c" }, createdAt },
    { id: 4, event: "cards-changed", data: { source: "d" }, createdAt },
  ]);

  // It answers about one type only — a busier neighbouring event stream cannot
  // crowd out the answer:

  t.check(bus2.readRecent({ event: "chat-complete", limit: 10 }), [
    { id: 5, event: "chat-complete", data: { sessionId: "s-1", timestamp: TS }, createdAt },
  ]);

  // A type nothing has emitted is empty, not an error:

  t.check(bus2.readRecent({ event: "chat-user-message", limit: 10 }), []);
});

// ## A bad row degrades to a sentinel without breaking its siblings
//
// Emit one valid row, then hand-write three broken ones directly into SQLite: a
// schema violation, malformed JSON, and an unknown event name. All four rows
// dispatch — the three bad ones as `unknown` sentinels, the valid one intact:
void test("Emit one valid row, then hand-write three broken ones directly into SQLite:", async (t) => {
  t.teardown(async () => {
    try {
      bus.close();
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const bus = createEventBus(box.root);
  bus.emit("cards-changed", { source: "gmail" });

  const dbPath = join(box.root, ".beebox/events.db");
  const raw = new DatabaseSync(dbPath);
  const ins = raw.prepare("INSERT INTO events (event, data) VALUES (?, ?)");
  ins.run("card-created", JSON.stringify({ path: 123 }));   // schema mismatch
  ins.run("cards-changed", "{not json");                     // syntax-level failure
  ins.run("mystery-event", JSON.stringify({ x: 1 }));        // unknown event name
  raw.close();

  const rows = bus.readSince(0);
  t.check(rows, [
    { id: 1, event: "cards-changed", data: { source: "gmail" }, createdAt },
    { id: 2, event: "unknown", data: { originalEvent: "card-created", raw: { path: 123 }, error: any(String) }, createdAt },
    { id: 3, event: "unknown", data: { originalEvent: "cards-changed", raw: "{not json", error: any(String).startsWith("JSON parse failed: SyntaxError") }, createdAt },
    { id: 4, event: "unknown", data: { originalEvent: "mystery-event", raw: { x: 1 }, error: 'unknown event name "mystery-event"' }, createdAt },
  ]);

  // The valid sibling keeps its real payload; a sentinel carries the original event
  // name and raw payload for debugging:

});

// ## A generation mismatch truncates persisted rows on open
//
// Persist two rows, then simulate a deploy that bumped the schema generation by
// rewriting the stored generation to an older value. Reopening the bus truncates
// the now-stale rows so nothing gets replayed against the new schemas:
void test("Persist two rows, then simulate a deploy that bumped the schema generation by...", async (t) => {
  t.teardown(async () => {
    try {
      bus2.close();
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const bus1 = createEventBus(box.root);
  bus1.emit("cards-changed", { source: "a" });
  bus1.emit("cards-changed", { source: "b" });
  t.check(bus1.readSince(0), [
    { id: 1, event: "cards-changed", data: { source: "a" }, createdAt },
    { id: 2, event: "cards-changed", data: { source: "b" }, createdAt },
  ]);

  bus1.close();

  const raw = new DatabaseSync(join(box.root, ".beebox/events.db"));
  raw.prepare("UPDATE event_meta SET schema_generation = ? WHERE id = 1").run(EVENT_SCHEMA_GENERATION - 1);
  raw.close();

  const bus2 = createEventBus(box.root);
  t.check(bus2.readSince(0), []);
});

// ## A newer generation on disk refuses to open and keeps its rows
//
// Two engine checkouts can serve one box. When the stored generation is newer
// than this engine's, a newer engine wrote these rows; truncating them would
// wipe that engine's history on every open. The open throws instead, and the
// rows and stored generation are left as they were:
void test("Two engine checkouts can serve one box. When the stored generation is newer...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const dbPath = join(box.root, ".beebox/events.db");
  const bus1 = createEventBus(box.root);
  bus1.emit("cards-changed", { source: "a" });
  bus1.close();

  const raw = new DatabaseSync(dbPath);
  raw.prepare("UPDATE event_meta SET schema_generation = ? WHERE id = 1").run(EVENT_SCHEMA_GENERATION + 1);
  raw.close();

  const expected =
    "NewerEventSchemaError: Refusing to open " + dbPath + ": it was written by a newer beebox engine " +
    "(event-schema generation " + String(EVENT_SCHEMA_GENERATION + 1) + "), and this engine is older " +
    "(generation " + String(EVENT_SCHEMA_GENERATION) + "). Opening it here would delete the newer " +
    "engine's events. Use the newer engine for this box.";
  await t.checkThrows(() => createEventBus(box.root), expected);

  // `bbx serve` runs the read-only check before it stops the box's previous
  // server, so it refuses the same way:
  await t.checkThrows(() => {
    assertEventSchemaNotNewer(box.root);
  }, expected);

  const after = new DatabaseSync(dbPath, { readOnly: true });
  t.check(after.prepare("SELECT schema_generation AS gen FROM event_meta").all(), [{ gen: EVENT_SCHEMA_GENERATION + 1 }]);
  t.check(after.prepare("SELECT id, event, data FROM events").all(), [
    { id: 1, event: "cards-changed", data: JSON.stringify({ source: "a" }) },
  ]);
  after.close();
});

// ## The same generation on disk reopens with its rows intact
//
// The read-only check passes, and a second open replays what the first wrote:
void test("The read-only check passes, and a second open replays what the first wrote", async (t) => {
  t.teardown(async () => {
    try {
      bus2.close();
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  // No events.db yet: nothing to refuse.
  assertEventSchemaNotNewer(box.root);
  const bus1 = createEventBus(box.root);
  bus1.emit("cards-changed", { source: "a" });
  bus1.close();

  assertEventSchemaNotNewer(box.root);
  const bus2 = createEventBus(box.root);
  t.check(bus2.readSince(0), [{ id: 1, event: "cards-changed", data: { source: "a" }, createdAt }]);
});

// ## A legacy DB (no meta row) drops its pre-generation rows on first open
//
// A box upgraded from before generation stamping has an events table full of
// rows of unknown shape and no `event_meta`. Opening the bus for the first time
// under the new code truncates them rather than replaying stale-shaped data:
void test("A box upgraded from before generation stamping has an events table full of ro...", async (t) => {
  t.teardown(async () => {
    try {
      bus.close();
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const legacyPath = join(box.root, ".beebox");
  await box.write(".beebox/.keep", "");
  const legacy = new DatabaseSync(join(legacyPath, "events.db"));
  legacy.exec("CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, event TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))");
  legacy.prepare("INSERT INTO events (event, data) VALUES (?, ?)").run("cards-changed", JSON.stringify({ source: "old" }));
  legacy.close();

  const bus = createEventBus(box.root);
  t.check(bus.readSince(0), []);
});
