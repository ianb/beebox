// # reconcilePending
//
// `reconcilePending` decides which optimistic ("pending") user messages
// should still be displayed after a fresh server-history fetch arrives.
// A pending entry is dropped when the server has caught up to it; the
// rest stay visible. Entries explicitly queued while the agent is busy also
// carry `pending: true`, which gives them the dimmed "queued — waiting" UI.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { reconcilePending, mergeAcceptedIntoPending, holdInjectedMessage } from "../../src/machines/chatMachine/chat-shared.js";
import type { PendingSessionEntry, SessionEntry } from "../../src/api.js";

function userEntry(uuid: string, text: string): SessionEntry {
  return {
    uuid,
    type: "user",
    timestamp: "2026-01-01T00:00:00Z",
    content: [{ type: "text", text }],
  };
}

function pendingEntry(uuid: string, text: string): PendingSessionEntry {
  return { ...userEntry(uuid, text), reconcileKnownUuids: [] };
}

// ## Pending message not yet on the server → re-appended, kept pending
void test("Pending message not yet on the server → re-appended, kept pending", async (t) => {
  const server = [userEntry("s1", "<typed>old</typed>")];
  const pending = [pendingEntry("p1", "<typed>new</typed>")];
  const result = reconcilePending({ serverMessages: server, pendingMessages: pending });
  t.check(result, { messages: [...server, ...pending], pendingMessages: pending });
});

// ## A message the agent moved on without stays where it was sent
//
// A send refused as busy, or a queue dropped by a restart, leaves a user
// message the transcript never gets. Once a later user turn is in the
// transcript, the message goes right after the entries it was sent after (its
// baseline), not at the end below turns that came later
// (`issues/bugs/2026-10-14-busy-rejected-send-recorded-then-orphaned.md`).
function assistantEntry(uuid: string, text: string): SessionEntry {
  return { uuid, type: "assistant", timestamp: "2026-01-01T00:00:00Z", content: [{ type: "text", text }] };
}

void test("A message a later user turn overtook sits after its baseline", async (t) => {
  const server = [
    userEntry("s1", "<typed>first</typed>"), assistantEntry("a1", "reply one"),
    userEntry("s2", "<typed>later</typed>"), assistantEntry("a2", "reply two"),
  ];
  const lost = { ...pendingEntry("p1", "<typed>lost</typed>"), reconcileKnownUuids: ["s1", "a1"] };
  const alsoLost = { ...pendingEntry("p2", "<typed>also lost</typed>"), reconcileKnownUuids: ["s1", "a1"] };
  const result = reconcilePending({ serverMessages: server, pendingMessages: [lost, alsoLost] });
  t.check(result.messages.map((m) => m.uuid), ["s1", "a1", "p1", "p2", "s2", "a2"]);
});

// The issue's own sequence: two sends 14 ms apart. Both were accepted before
// the first one's turn was written, so neither baseline holds that turn. The
// first reconciles against it; the refused second was still sent after it,
// so it goes after that turn's reply and before the next user turn.
void test("A refused send stays after the send that beat it", async (t) => {
  const server = [
    userEntry("s0", "<typed>earlier</typed>"), assistantEntry("a0", "reply zero"),
    userEntry("sA", "<typed>long message</typed>"), assistantEntry("aA", "reply to long"),
    userEntry("sC", "<typed>next day</typed>"), assistantEntry("aC", "reply to next"),
  ];
  const first = { ...pendingEntry("pA", "<typed>long message</typed>"), reconcileKnownUuids: ["s0", "a0"] };
  const refused = { ...pendingEntry("pB", "<typed>short</typed>"), reconcileKnownUuids: ["s0", "a0"] };
  const result = reconcilePending({ serverMessages: server, pendingMessages: [first, refused] });
  t.check(result.messages.map((m) => m.uuid), ["s0", "a0", "sA", "aA", "pB", "sC", "aC"]);

  // On a page left open, the first send reconciles on one refresh and is gone
  // from the pending list on the next; the second keeps its place.
  const firstRefresh = reconcilePending({ serverMessages: server.slice(0, 4), pendingMessages: [first, refused] });
  const nextRefresh = reconcilePending({ serverMessages: server, pendingMessages: firstRefresh.pendingMessages });
  t.check(nextRefresh.messages.map((m) => m.uuid), ["s0", "a0", "sA", "aA", "pB", "sC", "aC"]);
});

// Only a later user turn means the agent moved on: a reply still arriving to
// an earlier message does not, and a message with no baseline entry in the
// transcript has nothing to sit after. Both stay at the end.
void test("Without a later user turn, or without a baseline, the message stays last", async (t) => {
  const server = [userEntry("s1", "<typed>first</typed>"), assistantEntry("a1", "reply one"), assistantEntry("a2", "more of the reply")];
  const waiting = { ...pendingEntry("p1", "<typed>next</typed>"), reconcileKnownUuids: ["s1", "a1"] };
  const unanchored = pendingEntry("p2", "<typed>from an empty history</typed>");
  t.check([
    reconcilePending({ serverMessages: server, pendingMessages: [waiting] }).messages.map((m) => m.uuid),
    reconcilePending({ serverMessages: [...server, userEntry("s2", "<typed>later</typed>")], pendingMessages: [unanchored] }).messages.map((m) => m.uuid),
  ], [["s1", "a1", "a2", "p1"], ["s1", "a1", "a2", "s2", "p2"]]);
});

// ## Server-injected user attribution → reconcile MUST still drop the pending entry
//
// When the server stores a user message, it calls `injectUserAttr` to
// add `user="Name" user-email="addr"` into the opening `<typed>` tag.
// The optimistic copy doesn't have those attrs yet. Reconcile must
// treat the two as the same message — otherwise the pending bubble
// sticks around forever after the queued turn completes.
//
// This is the regression behind the "Agent is busy — your message is
// queued" indicator that never clears.
void test("When the server stores a user message, it calls injectUserAttr to add user=\"N...", async (t) => {
  const server = [userEntry(
    "s1",
    '<typed user="Ian" user-email="ian@example.com" local-time="9:00 AM">hello world</typed>',
  )];
  const pending = [pendingEntry(
    "p1",
    '<typed local-time="9:00 AM">hello world</typed>',
  )];
  const result = reconcilePending({ serverMessages: server, pendingMessages: pending });
  t.check(result, { messages: server, pendingMessages: [] });
});

// ## Two queued duplicates of one message → both drop after server has the merged turn
//
// The backend's `drainQueue` joins multiple queued texts with `\n\n` into
// a single send. So if the user typed the same message twice while busy,
// the resulting server entry contains the text twice. Both pending
// entries should drop.
void test("The backend's drainQueue joins multiple queued texts with \\n\\n into a single...", async (t) => {
  const server = [userEntry(
    "s1",
    '<typed local-time="9:00 AM">say hi</typed>\n\n<typed local-time="9:00 AM">say hi</typed>',
  )];
  const pending = [
    pendingEntry("p1", '<typed local-time="9:00 AM">say hi</typed>'),
    pendingEntry("p2", '<typed local-time="9:00 AM">say hi</typed>'),
  ];
  const result = reconcilePending({ serverMessages: server, pendingMessages: pending });
  t.check(result, { messages: server, pendingMessages: [] });
});

// ## An older identical message cannot confirm the new send
//
// Short repeated replies are common. A snapshot containing only the already
// visible older `"yes"` must keep the new optimistic `"yes"`; only a new server
// UUID can confirm it.
void test("Short repeated replies are common.", async (t) => {
  const oldYes = userEntry("s-old", "<typed>yes</typed>");
  const pending = [{ ...pendingEntry("p-new", "<typed>yes</typed>"), reconcileKnownUuids: [oldYes.uuid] }];
  const stale = reconcilePending({
    serverMessages: [oldYes],
    pendingMessages: pending,
  });
  t.check(stale, { messages: [oldYes, ...pending], pendingMessages: pending });

  const durableYes = userEntry("s-new", "<typed>yes</typed>");
  const caughtUp = reconcilePending({
    serverMessages: [oldYes, durableYes],
    pendingMessages: stale.pendingMessages,
  });
  t.check(caughtUp, { messages: [oldYes, durableYes], pendingMessages: [] });
});

// ## One durable occurrence confirms only one identical pending send
//
// Two client sends need two server occurrences. A snapshot containing only the
// first durable `"yes"` keeps the second optimistic copy visible.
void test("Two client sends need two server occurrences.", async (t) => {
  const durable = userEntry("s-one", "<typed>yes</typed>");
  const first = pendingEntry("p-one", "<typed>yes</typed>");
  const second = pendingEntry("p-two", "<typed>yes</typed>");
  const result = reconcilePending({ serverMessages: [durable], pendingMessages: [first, second] });
  // The second keeps the first one's turn as a turn it was sent after (placement only).
  const stillPending = { ...second, sentAfterEchoes: ["s-one"] };
  t.check(result, { messages: [durable, stillPending], pendingMessages: [stillPending] });

  // The next refresh of the same snapshot does not let the first "yes" confirm the second.
  t.check(reconcilePending({ serverMessages: [durable], pendingMessages: result.pendingMessages }),
    { messages: [durable, stillPending], pendingMessages: [stillPending] });
});

// ## Chronological matching respects each send's baseline
//
// When the second identical send was created after the first durable UUID was
// already known, the first pending entry must consume the first echo. Matching
// newest-first would consume the second echo incorrectly and strand the newer
// pending entry behind its baseline.
void test("When the second identical send was created after the first durable UUID was a...", async (t) => {
  const firstEcho = userEntry("s-first", "<typed>yes</typed>");
  const secondEcho = userEntry("s-second", "<typed>yes</typed>");
  const pending = [
    pendingEntry("p-first", "<typed>yes</typed>"),
    { ...pendingEntry("p-second", "<typed>yes</typed>"), reconcileKnownUuids: [firstEcho.uuid] },
  ];
  const result = reconcilePending({
    serverMessages: [firstEcho, secondEcho],
    pendingMessages: pending,
  });
  t.check(result, { messages: [firstEcho, secondEcho], pendingMessages: [] });
});

// ## A turn whose images were stripped still retires its pending copy
//
// The client's optimistic entry keeps the user's photos as image blocks, which
// contribute nothing to the entry's text. The server's copy of the same turn, read
// back from a session log whose inline media was stripped for size, has each image
// block replaced by placeholder *text*.
//
// Comparing the two verbatim fails: the server's text carries characters the
// client's never had. The pending entry is then never retired and the user sees
// their own message twice — once with their photos, once with grey placeholders.
// A journey walker hit exactly that on 2026-08-24 and reported the app as
// duplicating their message.
void test("The client's optimistic entry keeps the user's photos as image blocks, which...", async (t) => {
  const optimistic: PendingSessionEntry = {
    uuid: "m1", type: "user", timestamp: "2026-01-01T00:00:00Z", pending: true,
    reconcileKnownUuids: [],
    content: [
      { type: "image", mediaType: "image/jpeg", dataBase64: "AAAA" },
      { type: "text", text: " " },
      { type: "image", mediaType: "image/jpeg", dataBase64: "BBBB" },
      { type: "text", text: " workroom tray 1" },
    ],
  };
  const stripped: SessionEntry = {
    uuid: "s1", type: "user", timestamp: "2026-01-01T00:00:01Z",
    content: [
      { type: "text", text: "[image not displayed]" },
      { type: "text", text: " " },
      { type: "text", text: "[image not displayed]" },
      { type: "text", text: " workroom tray 1" },
    ],
  };
  const out = reconcilePending({ serverMessages: [stripped], pendingMessages: [optimistic] });
  t.check(out, { messages: [stripped], pendingMessages: [] });

  // A turn that genuinely has not reached the server yet is still kept, placeholders
  // or not — the fix must not retire an entry the server has never seen.

  const unsent = reconcilePending({ serverMessages: [], pendingMessages: [optimistic] });
  t.check(unsent, { messages: [optimistic], pendingMessages: [optimistic] });
});

// ## mergeAcceptedIntoPending — the box's record and this page's, without doubling
//
// `chat.bootstrap` reports what the box has **accepted** but not yet written into
// the transcript. On a fresh page load that list is the only thing standing
// between a reload mid-turn and a conversation missing the question the box
// already promised to have — the optimistic copies died with the previous page.
void test("chat.bootstrap reports what the box has accepted but not yet written into the...", async (t) => {
  const accepted = [pendingEntry("accepted-7", "<typed>where is the drawer key?</typed>")];
  t.check(mergeAcceptedIntoPending({ pendingMessages: [], accepted }), accepted);

  // The two lists describe the same events from different sides, so in the window
  // where a send lands while the initial fetch is still in flight they overlap. The
  // server injects `user=`/`user-email=` attributes the optimistic copy never
  // carried, so the comparison runs through the same normalizer reconciliation uses
  // — otherwise the message renders twice, once from each side:

  const mine = pendingEntry("local-1", "<typed>where is the drawer key?</typed>");
  const server = pendingEntry("accepted-7", "<typed user=\"Sam Rivera\" user-email=\"sam@example.com\">where is the drawer key?</typed>");
  t.check(mergeAcceptedIntoPending({ pendingMessages: [mine], accepted: [server] }), [mine]);

  // A match is consumed, so a person who really did send the same words twice keeps
  // both — one optimistic copy cannot answer for two acceptances:

  const acceptedFirst = pendingEntry("accepted-8", "<typed>yes</typed>");
  const acceptedSecond = pendingEntry("accepted-9", "<typed>yes</typed>");
  const local = pendingEntry("local-2", "<typed>yes</typed>");
  t.check(mergeAcceptedIntoPending({ pendingMessages: [local], accepted: [acceptedFirst, acceptedSecond] }), [local, acceptedSecond]);

  // An image send is the asymmetric case. The transcript and the optimistic copy
  // both consume `[image#N]` into image blocks, so their text no longer holds the
  // token; the box's acceptance record carries the raw text, because the bytes never
  // reached the bus. Compared naively those are different messages and the send
  // renders twice:

  const withImage = pendingEntry("local-3", "<typed>here is the drawer</typed>");
  const acceptedImage = pendingEntry("accepted-11", "<typed>[image#1]here is the drawer</typed>");
  t.check(mergeAcceptedIntoPending({ pendingMessages: [withImage], accepted: [acceptedImage] }), [withImage]);

  // The token form is not necessarily the same on both sides — the three copies of
  // one message can come from different eras — so the pre-2026-08-25 spelling has
  // to normalize away too. A reader that knew only one form would strip the token
  // on one side and keep it on the other, which is exactly the mismatch this guards
  // against:

  const withImage2 = pendingEntry("local-4", "<typed>here is the drawer</typed>");
  const acceptedLegacy = pendingEntry("accepted-12", "<typed>[image1]here is the drawer</typed>");
  t.check(mergeAcceptedIntoPending({ pendingMessages: [withImage2], accepted: [acceptedLegacy] }), [withImage2]);

  // And a repeated load cannot stack copies of one bus row, because the uuid it is
  // minted from is stable:

  const once = mergeAcceptedIntoPending({ pendingMessages: [], accepted });
  t.check(mergeAcceptedIntoPending({ pendingMessages: once, accepted }), accepted);

  // Once the transcript catches up, reconciliation retires an accepted entry exactly
  // as it does a locally-minted one — the point of carrying them in this shape:

  const echo = userEntry("real-1", "<typed user=\"Sam Rivera\">where is the drawer key?</typed>");
  const echoed = reconcilePending({
    serverMessages: [echo],
    pendingMessages: once,
  });
  t.check(echoed, { messages: [echo], pendingMessages: [] });
});

// ## A message the box injected stays on screen until the transcript has it
//
// A delivered capture is announced before the agent writes it to the
// transcript. A refresh in that gap must keep it, and the refresh after the
// write must retire it without a duplicate.
void test("A delivered capture is announced before the agent writes it to the transcript.", async (t) => {
  const capture = '<capture doc="captures/a.md">2 photos</capture>';
  const shown = [userEntry("s1", "<typed>hi</typed>")];
  const held = holdInjectedMessage({ messages: shown, pendingMessages: [], message: capture, timestamp: "2026-10-16T12:00:00Z" });
  const early = reconcilePending({ serverMessages: shown, pendingMessages: held.pendingMessages });
  const late = reconcilePending({ serverMessages: [...shown, userEntry("s2", capture)], pendingMessages: early.pendingMessages });
  const again = holdInjectedMessage({ messages: held.messages, pendingMessages: held.pendingMessages, message: capture, timestamp: "2026-10-16T12:00:00Z" });
  const already = holdInjectedMessage({ messages: late.messages, pendingMessages: [], message: capture, timestamp: "2026-10-16T12:00:00Z" });
  const injected = {
    uuid: "injected-2026-10-16T12:00:00Z",
    type: "user" as const,
    timestamp: "2026-10-16T12:00:00Z",
    content: [{ type: "text" as const, text: capture }],
    reconcileKnownUuids: ["s1"],
  };
  const written = userEntry("s2", capture);
  t.check(held, { messages: [...shown, injected], pendingMessages: [injected] });
  t.check(early, { messages: [...shown, injected], pendingMessages: [injected] });
  t.check(late, { messages: [...shown, written], pendingMessages: [] });
  t.check(again, { messages: [...shown, injected], pendingMessages: [injected] });
  t.check(already, { messages: [...shown, written], pendingMessages: [] });
});
