// # Pending web sends retain completed content and original destination
//
// Storage is transactional with respect to the live snapshot. A storage failure
// prevents staging, so the caller can preserve its draft. The one exception is
// the browser's quota refusal: a message too large to save still sends, without
// a reload-recovery copy. Reopening a tab never resends a saved message
// automatically.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { createPendingSendsStore, quarantineUnreadablePendingSends, pendingSendRecoveryCopies } from "../../../../../src/components/chat/conversation/use-bound-emission/pending-sends.js";
import { storageScopeFor } from "../../../../../src/lib/storage-scope.js";
import type { Emission } from "../../../../../src/input/emission.js";
import type { SendBinding } from "../../../../../../shared/chat-composer-binding.js";

/** A Map-backed Storage. Set `writeError` to make writes throw; `refuseRemoves` to make removals throw. */
interface MemoryStorage {
  data: Map<string, string>;
  writeError: string | null;
  refuseRemoves: boolean;
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

function memoryStorage(): MemoryStorage {
  const data = new Map<string, string>();
  const storage: MemoryStorage = {
    data,
    writeError: null,
    refuseRemoves: false,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (storage.writeError) throw new Error(storage.writeError);
      data.set(key, value);
    },
    removeItem: (key: string) => {
      if (storage.refuseRemoves) throw new Error("remove refused");
      data.delete(key);
    },
  };
  return storage;
}

/** A store over `storage` for box `test` (the default scope). */
const open = (storage: ReturnType<typeof memoryStorage>, scope?: { boxSlug: string; storageScope: string }) =>
  createPendingSendsStore(storage, scope ?? { boxSlug: "test", storageScope: "test" });

const chatBinding: SendBinding = { boxSlug: "test", target: { kind: "session", sessionId: "chat", contextDir: "" }, attention: { surface: "chat", transcript: "visible" } };
const typed = (id: string, text: string): Emission => ({ id, origin: "typed", text, images: [], files: [], selections: [], diarized: false });
const INTERRUPTED = "Delivery was interrupted. Review before retrying.";
const ACCEPTED_UNCLEARED = "Sent. The saved recovery copy could not be cleared.";
const voice = (id: string): Emission => ({ id, origin: "voice", text: "live words", images: [], files: [], selections: [], diarized: false, spokenStart: 0 });

// ## Staging and recovery
//
// A voice send with an image, a file, a selection and word timings is staged
// under a session binding. A storage failure on staging throws, leaves the
// snapshot empty and notifies no subscriber, so the caller can preserve its
// draft:
void test("A voice send with an image, a file, a selection and word timings is staged un...", async (t) => {
  // doctest:L52
  const storage = memoryStorage();
  const emission: Emission = { id: "voice-1", origin: "voice", text: "Check [image#1]", diarized: true,
    images: [{ id: 1, mimeType: "image/png", dataBase64: "a".repeat(600_000) }],
    files: [{ id: 2, path: "_tmp/report.pdf", originalName: "report.pdf", mimetype: "application/pdf", size: 512 }],
    selections: [{ id: 3, ref: "/_content/house/Report.doc.card", text: "Quoted evidence", position: "p2", anchor: "check", spokenWords: 1 }],
    words: [{ word: "Check", confidence: 0.9 }], spokenStart: 0,
  };
  const binding: SendBinding = { boxSlug: "test", target: { kind: "session", sessionId: "kitchen", contextDir: "_content/kitchen" }, attention: { surface: "card", focusedRef: "_content/house/Report.doc.card", transcript: "hidden" } };
  const store = open(storage);
  let notices = 0;
  const unsubscribe = store.subscribe(() => { notices++; });
  storage.writeError = "quota";
  await t.checkThrows(async () => (store.stage(emission, binding)), "Error: quota");

  // doctest:L67
  t.check({ snapshot: store.getSnapshot(), notices }, { snapshot: [], notices: 0 });

  // Once storage works, the staged send is recovered by a fresh store with its
  // full content (image bytes, words, selections) and its original destination,
  // as `recovered` rather than resent. A store for another box sees nothing:

  // doctest:L76
  storage.writeError = null;
  store.stage(emission, binding);
  t.check(
    { rows: open(storage).getSnapshot(), otherBox: open(storage, { boxSlug: "other", storageScope: "other" }).getSnapshot() },
    { rows: [{ emission, binding, status: "recovered", reason: INTERRUPTED }], otherBox: [] },
  );

  // Same-ID retries must preserve content and binding. Late receipts remove only the
  // original saved message, leaving a later draft or another saved send untouched.

  // doctest:L101
  store.rejected(emission.id, "Offline");
  t.check(store.getSnapshot(), [{ emission, binding, status: "rejected", reason: "Offline" }]);

  // doctest:L105
  await t.checkThrows(async () => (store.stage(emission, { ...binding, target: { kind: "session", sessionId: "garden", contextDir: "_content/garden" } })), "PendingSendChangedError: A saved message cannot change its destination or content");

  // doctest:L108
  store.stage(emission, binding);
  t.check(store.getSnapshot(), [{ emission, binding, status: "pending" }]);

  // doctest:L112
  const { words: _words, ...withoutWords } = emission;
  void _words;
  store.stage({ ...emission, id: "hq-2", hqText: true, hqService: "openai", words: undefined }, binding);
  store.accepted("voice-1");
  t.check(store.getSnapshot(), [{ emission: { ...withoutWords, id: "hq-2", hqText: true, hqService: "openai" }, binding, status: "pending" }]);

  // doctest:L117
  t.check(open(storage).getSnapshot(), [{ emission: { ...withoutWords, id: "hq-2", hqText: true, hqService: "openai" }, binding, status: "recovered", reason: INTERRUPTED }]);

  // doctest:L121
  store.restored("hq-2");
  t.check(store.getSnapshot(), []);

  // doctest:L125
  unsubscribe();

  // Preparing HQ is the only phase allowed to replace content under an existing ID.
  // After final dispatch, that ID's content cannot drift on retry.

  // doctest:L132
  store.prepare({ ...emission, id: "hq-work" }, { binding });
  t.check(store.getSnapshot(), [{ emission: { ...emission, id: "hq-work" }, binding, status: "preparing" }]);

  // doctest:L136
  store.stage({ ...emission, id: "hq-work", text: "Corrected HQ text", hqText: true, hqService: "hq" }, binding);
  t.check(store.getSnapshot(), [{ emission: { ...emission, id: "hq-work", text: "Corrected HQ text", hqText: true, hqService: "hq" }, binding, status: "pending" }]);

  // doctest:L140
  await t.checkThrows(async () => (store.stage({ ...emission, id: "hq-work", text: "different" }, binding)), "PendingSendChangedError: A saved message cannot change its destination or content");

  // doctest:L143
  store.accepted("hq-work");
});

// ## A voice send waiting on HQ survives a reload as a visible, unsent item
//
// `prepare` with a `recordingId` marks a voice send that is waiting for its HQ
// transcript (`docs/plans/resilient-voice-recording.md`, Track 4). A reload
// keeps it as `awaitingHq` rather than `recovered`: the recording and its HQ job
// are on the box, and the user chooses which text to send. Loading never sends
// it. A `preparing` row without a recording keeps the old recovered path.
void test("prepare with a recordingId marks a voice send that is waiting for its HQ tran...", async (t) => {
  // doctest:L155
  const storage = memoryStorage();
  const live = open(storage);
  live.prepare(voice("waiting"), { binding: chatBinding, recordingId: "rec-1" });
  live.prepare(voice("plain"), { binding: chatBinding });
  t.check(open(storage).getSnapshot(), [
    { emission: voice("waiting"), binding: chatBinding, status: "awaitingHq", recordingId: "rec-1", reason: "Waiting for the HQ transcript. Nothing is sent until you choose." },
    { emission: voice("plain"), binding: chatBinding, status: "recovered", reason: INTERRUPTED },
  ]);

  // The user's choice may still replace the realtime snapshot once — here with the
  // HQ text — and the provenance survives storage:

  // doctest:L167
  const reloaded = open(storage);
  reloaded.stage({ ...voice("waiting"), hqText: true, hqService: "whisper" }, chatBinding);
  t.check(open(storage).getSnapshot(), [
    { emission: { ...voice("waiting"), hqText: true, hqService: "whisper" }, binding: chatBinding, status: "recovered", reason: INTERRUPTED },
    { emission: voice("plain"), binding: chatBinding, status: "recovered", reason: INTERRUPTED },
  ]);

  // A row saved before every send got the HQ pass (docs/plans/hq-always.md) may
  // still hold an `hqFallback` marker on disk, `true` or the older
  // `"pending"`/`"failed"`. It loads, and the marker is dropped: a voice emission
  // without `hqText` is live text either way.

  // doctest:L180
  storage.data.set("bbx-pending-web-sends:test", JSON.stringify({
    version: 1,
    rows: [{ emission: { ...voice("legacy"), hqFallback: "pending" }, binding: chatBinding, status: "pending" }],
  }));
  t.check(open(storage).getSnapshot(), [{ emission: voice("legacy"), binding: chatBinding, status: "recovered", reason: INTERRUPTED }]);
});

// Dismissing an `awaitingHq` item removes it; its recording stays on the box:
void test("Dismissing an awaitingHq item removes it; its recording stays on the box:", async (t) => {
  // doctest:L192
  const storage = memoryStorage();
  open(storage).prepare(voice("gone"), { binding: chatBinding, recordingId: "rec-2" });
  const reloaded = open(storage);
  reloaded.dismissed("gone");
  t.check(reloaded.getSnapshot(), []);
});

// ## Pending recovery is isolated by API base when worktrees share a box slug
//
// The dev router serves every worktree from one origin. Recovery for `test1` in
// one worktree must not load completed sends saved by another worktree, while the
// production API base retains the historical `test1` key.
void test("The dev router serves every worktree from one origin.", async (t) => {
  // doctest:L207
  const storage = memoryStorage();
  const paperScope = storageScopeFor("/paper-cards/test1/api");
  const chatScope = storageScopeFor("/chat-everywhere/test1/api");
  const scoped = (storageScope: string) => open(storage, { boxSlug: "test1", storageScope });
  const test1Binding: SendBinding = { ...chatBinding, boxSlug: "test1" };
  scoped(paperScope).stage(typed("paper", "Paper message"), test1Binding);
  scoped(chatScope).stage(typed("chat", "Chat message"), test1Binding);
  t.check(
    {
      scopes: [paperScope, chatScope, storageScopeFor("/test1/api")],
      paper: scoped(paperScope).getSnapshot(),
      chat: scoped(chatScope).getSnapshot(),
    },
    {
      scopes: ["paper-cards/test1", "chat-everywhere/test1", "test1"],
      paper: [{ emission: typed("paper", "Paper message"), binding: test1Binding, status: "recovered", reason: INTERRUPTED }],
      chat: [{ emission: typed("chat", "Chat message"), binding: test1Binding, status: "recovered", reason: INTERRUPTED }],
    },
  );
});

// An acceptance remains authoritative when storage cleanup fails. The UI receives
// an accepted row, with neither Retry nor Restore; if writes still work, that
// marker also survives reload. Even a later rejected callback cannot reverse it.
void test("An acceptance remains authoritative when storage cleanup fails.", async (t) => {
  // doctest:L227
  const storage = memoryStorage();
  storage.refuseRemoves = true;
  const emission = typed("accepted", "Sent");
  const store = open(storage);
  store.stage(emission, chatBinding);
  store.accepted(emission.id);
  t.check(store.getSnapshot(), [{ emission, binding: chatBinding, status: "accepted", reason: ACCEPTED_UNCLEARED }]);

  // doctest:L236
  t.check(open(storage).getSnapshot(), [{ emission, binding: chatBinding, status: "accepted", reason: ACCEPTED_UNCLEARED }]);

  // doctest:L239
  storage.writeError = "storage disabled";
  store.rejected(emission.id, "late error");
  t.check(store.getSnapshot(), [{ emission, binding: chatBinding, status: "accepted", reason: ACCEPTED_UNCLEARED }]);

  // doctest:L244
  await t.checkThrows(async () => (store.stage(emission, chatBinding)), "PendingSendChangedError: A saved message cannot change its destination or content");
});

// Unreadable state has an explicit escape: preserve the original bytes, verify
// that copy, then reset. A failed preservation write leaves the original alone.
// The action never removes a valid saved message and never submits anything.
void test("Unreadable state has an explicit escape:", async (t) => {
  // doctest:L253
  const storage = memoryStorage();
  const key = "bbx-pending-web-sends:test";
  const raw = '{"version":1,"rows":[broken but potentially recoverable';
  storage.data.set(key, raw);
  storage.writeError = "quota";
  await t.checkThrows(async () => (quarantineUnreadablePendingSends(storage, { boxSlug: "test", storageScope: "test" })), "Error: quota");

  // doctest:L261
  t.check(storage.getItem(key), raw);

  // doctest:L264
  storage.writeError = null;
  const fresh = quarantineUnreadablePendingSends(storage, { boxSlug: "test", storageScope: "test" });
  t.check(
    { snapshot: fresh.getSnapshot(), original: storage.getItem(key), copies: pendingSendRecoveryCopies(storage, "test") },
    { snapshot: [], original: null, copies: [{ key: "bbx-pending-web-sends-quarantine:test:0", raw }] },
  );

  // doctest:L269
  const emission = typed("new", "A new message");
  fresh.stage(emission, chatBinding);
  t.check(quarantineUnreadablePendingSends(storage, { boxSlug: "test", storageScope: "test" }).getSnapshot(), [{ emission, binding: chatBinding, status: "recovered", reason: INTERRUPTED }]);

  // doctest:L274
  t.check(pendingSendRecoveryCopies(storage, "test"), [{ key: "bbx-pending-web-sends-quarantine:test:0", raw }]);

  // doctest:L277
  // Wrong-box envelopes are also preserved intact, never routed to this box.
  const wrongBox = JSON.stringify({ version: 1, rows: [{ emission, binding: { ...chatBinding, boxSlug: "other" }, status: "pending" }] });
  storage.data.set(key, wrongBox);
  t.check(quarantineUnreadablePendingSends(storage, { boxSlug: "test", storageScope: "test" }).getSnapshot(), []);

  // doctest:L282
  t.check(pendingSendRecoveryCopies(storage, "test"), [
    { key: "bbx-pending-web-sends-quarantine:test:0", raw },
    { key: "bbx-pending-web-sends-quarantine:test:1", raw: wrongBox },
  ]);
});

// A storage backend silently refusing the preservation write cannot trick recovery
// into deleting the only surviving copy.
void test("A storage backend silently refusing the preservation write cannot trick recov...", async (t) => {
  // doctest:L290
  const raw = "damaged";
  let removed = false;
  const storage = {
    getItem: (key: string) => key === "bbx-pending-web-sends:test" ? raw : null,
    setItem: (_key: string, _value: string) => {},
    removeItem: (_key: string) => { removed = true; },
  };
  await t.checkThrows(async () => (quarantineUnreadablePendingSends(storage, { boxSlug: "test", storageScope: "test" })), "PendingSendPreservationError");

  // doctest:L300
  t.check(removed, false);
});

// ## A message too large to save still sends
//
// The session-storage quota is about 5 MB, so two large photos can exceed it.
// A quota refusal does not block the send: the row is kept in this page's
// memory (so delivery and its receipt still work) but nothing is written, and
// a reload would not recover it.
void test("The session-storage quota is about 5 MB, so two large photos can exceed it.", async (t) => {
  // doctest:L312
  const storage = memoryStorage();
  storage.setItem = () => { throw new DOMException("The quota has been exceeded.", "QuotaExceededError"); };
  const store = open(storage);
  store.stage(typed("big-1", "two large photos"), chatBinding);
  t.check({ live: store.getSnapshot(), saved: [...storage.data.keys()] }, { live: [{ emission: typed("big-1", "two large photos"), binding: chatBinding, status: "pending" }], saved: [] });

  // Its acceptance then clears it like any other send:

  // doctest:L323
  store.accepted("big-1");
  t.check(store.getSnapshot(), []);
});

// ## An image's original path survives the recovery copy
//
// The recovery envelope is what a rejected send is retried from, so it has to
// carry the uploaded original's `path` or the retry silently goes out with the
// pixels and no file line (the storage schema strips keys it does not name).
void test("The recovery envelope is what a rejected send is retried from, so it has to c...", async (t) => {
  // doctest:L335
  const storage = memoryStorage();
  const withPath: Emission = { ...typed("img-1", "receipt [image#1]"),
    images: [{ id: 1, mimeType: "image/jpeg", dataBase64: "AA", path: "_tmp/2026-09-16T10-00-00.000Z_IMG_0001.jpg" }] };
  open(storage).stage(withPath, chatBinding);
  t.check(open(storage).getSnapshot(), [{ emission: withPath, binding: chatBinding, status: "recovered", reason: INTERRUPTED }]);
});
