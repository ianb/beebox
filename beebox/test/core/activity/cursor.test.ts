// # The activity cursor and window
//
// At a person's send the session's cursor moves: `previous` becomes the old
// `hinted`, `hinted` becomes the log's highest `seq`. The hint counts entries
// in (previous, hinted]; the window the agent reads is everything above
// `previous`, so an entry that lands after the send falls in the next window.
// A new chat's entries carry the page's own key until the first send binds it
// to the session id.

import { test } from "tap";
import { setTimeout as sleep } from "node:timers/promises";
import "@ianbicking/tap-check/tap";
import { isoDate } from "@ianbicking/tap-check/check";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import { advanceForSend, activityWindow, bindPendingChat, readCursor, renderActivityHint } from "../../../src/core/activity/cursor.js";
import { recordActivity } from "../../../src/core/activity/log.js";
import { combineQueuedInputs } from "../../../src/core/chat/session/state.js";

async function act(root: string, entry: { card: string; detail: string; chat?: string; pendingChat?: string }): Promise<void> {
  await recordActivity(root, { user: null, entries: [{ kind: "explored", ...entry }] });
}

function details(window: { entries: { detail?: string | undefined }[] }): (string | undefined)[] {
  return window.entries.map((e) => e.detail);
}

// ## A late entry lands in the next window
void test("A late entry lands in the next window.", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  await act(box.root, { card: "Lab.figure.card", detail: "add C", chat: "s1" });
  await act(box.root, { card: "Other.figure.card", detail: "someone else's chat", chat: "s2" });
  await act(box.root, { card: "Lab.figure.card", detail: "add H", chat: "s1" });

  t.check(await advanceForSend(box.root, { sessionId: "s1" }), { entries: 2, cards: 1 });
  t.check(await readCursor(box.root, "s1"), { hinted: 3, previous: 0, pendingKeys: [], sentAt: isoDate() });

  await act(box.root, { card: "Lab.figure.card", detail: "remove H", chat: "s1" });
  t.check(details(await activityWindow(box.root, { sessionId: "s1" })), ["add C", "add H", "remove H"]);

  t.check(await advanceForSend(box.root, { sessionId: "s1" }), { entries: 1, cards: 1 });
  t.check(details(await activityWindow(box.root, { sessionId: "s1" })), ["remove H"]);
  t.check(details(await activityWindow(box.root, { sessionId: "s1", card: "Other.figure.card" })), []);
  t.check(await advanceForSend(box.root, { sessionId: "s1" }), { entries: 0, cards: 0 });
  t.check(renderActivityHint({ entries: 0, cards: 0 }), "");
  t.check(renderActivityHint({ entries: 7, cards: 2 }), "<activity entries=\"7\" cards=\"2\"/>");
});

// ## Merged queued sends advance the cursor once
//
// Sends that arrive during a busy turn are combined into one turn; the
// combined input carries one marker, so the turn advances the cursor once.
void test("Merged queued sends advance the cursor once.", (t) => {
  t.check(combineQueuedInputs([{ text: "a", activityTurn: {} }, { text: "b", activityTurn: { pendingChat: "p1" } }, { text: "c", activityTurn: {} }]).activityTurn, { pendingChat: "p1" });
  t.check(combineQueuedInputs([{ text: "a", activityTurn: {} }, { text: "n", clientComposed: true }]).activityTurn, {});
  t.check(combineQueuedInputs([{ text: "n", clientComposed: true }]).activityTurn, undefined);
  t.end();
});

// ## A new chat's key binds to its session
void test("A new chat's key binds to its session.", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  await act(box.root, { card: "Lab.figure.card", detail: "before first send", pendingChat: "p1" });
  await act(box.root, { card: "Lab.figure.card", detail: "another new chat", pendingChat: "p2" });

  // First turn: no session id yet, so the count comes from the key alone.
  t.check(await advanceForSend(box.root, { sessionId: null, pendingChat: "p1" }), { entries: 1, cards: 1 });
  await bindPendingChat(box.root, { sessionId: "s9", pendingChat: "p1" });
  t.check(await readCursor(box.root, "s9"), { hinted: 2, previous: 0, pendingKeys: ["p1"], sentAt: isoDate() });

  // The page keeps tagging with its key until it learns the id.
  await act(box.root, { card: "Lab.figure.card", detail: "after first send", pendingChat: "p1" });
  await act(box.root, { card: "Lab.figure.card", detail: "tagged with the id", chat: "s9" });
  t.check(details(await activityWindow(box.root, { sessionId: "s9" })), ["before first send", "after first send", "tagged with the id"]);
  t.check(await advanceForSend(box.root, { sessionId: "s9" }), { entries: 2, cards: 1 });
  // The window now starts after the first send's entries.
  t.check(details(await activityWindow(box.root, { sessionId: "s9" })), ["after first send", "tagged with the id"]);
});

// ## A session id that is not a plain id is refused
void test("A session id that is not a plain id is refused.", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  await t.checkThrows(() => readCursor(box.root, "../escape"), "ActivitySessionIdError: The activity cursor needs a plain chat session id");
});

// ## The first turn of a new chat: the command lists what the hint counted
//
// The agent can run `bbx chat activity` as soon as it has its session id,
// which can be before `bindPendingChat` has stored the cursor. The reader
// waits for the binding rather than reporting an empty window.
void test("First turn of a new chat: the command lists the entries the hint counted.", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  await act(box.root, { card: "Lab.figure.card", detail: "add C", pendingChat: "p1" });
  await act(box.root, { card: "Notes.view.card", detail: "Intro", pendingChat: "p1" });

  t.check(await advanceForSend(box.root, { sessionId: null, pendingChat: "p1" }), { entries: 2, cards: 2 });
  // The agent reads at once; the binding lands 200 ms later.
  const early = activityWindow(box.root, { sessionId: "s7", bindWaitMs: 2000 });
  await sleep(200);
  await bindPendingChat(box.root, { sessionId: "s7", pendingChat: "p1" });
  const window = await early;
  t.check(details(window), ["add C", "Intro"]);
  t.check(window.cursor?.sentAt, isoDate());

  // Without a binding the wait ends and the window is empty.
  t.check(details(await activityWindow(box.root, { sessionId: "s8", bindWaitMs: 150 })), []);
});
