// # The box screen's page state
//
// The web box screen (`pages/box-screen/BoxScreenPage.tsx`) takes a new thought
// and shows what became of each one. Its state is the pure reducer in
// `pages/box-screen/state.ts`; the page only wires it to storage and to the
// `quickChat` procedures. The views below are the shared contract fixtures, so
// the web page reads the same answers the phone does.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { readFileSync } from "node:fs";
import {
  boxScreenReducer, boxScreenRows, boxScreenStorageKey, parseStoredBoxScreen, pendingRetry,
  followUpFor, restoreBoxScreen, rowFace, storedBoxScreen, submission, submitUnsent, unsentStatus,
} from "../../../src/pages/box-screen/state.js";
import assert from "node:assert/strict";
import type { BoxScreenAction, BoxScreenState, QuickChatView } from "../../../src/pages/box-screen/state.js";
import { quickChatViewSchema } from "../../../../core/chat/routing/quick-chat-record.js";
import { quickChatHomeSchema } from "../../../../core/chat/routing/quick-chat-home.js";

const fixtures = new URL("../../../../../test/mobile-contract/fixtures/quick-chat/", import.meta.url);
const fixtureData = (name: string): unknown => JSON.parse(readFileSync(new URL(`${name}.json`, fixtures), "utf8")).result.data;
const fixture = (name: string) => quickChatViewSchema.parse(fixtureData(name));
const homeFixture = () => quickChatHomeSchema.parse(fixtureData("home"));
type Home = NonNullable<Parameters<typeof boxScreenRows>[0]>;
/** The row face's headline, for the faces that have one. */
const title = (view: QuickChatView) => { const face = rowFace(view); return "title" in face ? face.title : undefined; };
/** Where the row face links, for the faces that link. */
const link = (view: QuickChatView) => { const face = rowFace(view); return "link" in face ? face.link : undefined; };
const fresh = () => restoreBoxScreen({ draft: "", unsent: null });
const run = (state: BoxScreenState, actions: BoxScreenAction[]) => actions.reduce(boxScreenReducer, state);
/** A value the example needs to exist; fails the example when it is null. */
function present<T>(value: T | null): T {
  assert.ok(value !== null, "expected a value");
  return value;
}
const ID = "11111111-2222-4333-8444-555555555555";
const OTHER_ID = "99999999-8888-4777-8666-555555555555";

// ## Each row face
//
// A sent thought names its chat and links to it. "Open chat" only navigates; it
// puts nothing in the chat's composer.
void test("A sent thought names its chat and links to it.", async (t) => {
  t.check(rowFace(fixture("view-sent")), {
    kind: "sent",
    title: "Sent to Trip planning",
    link: {
      kind: "chat",
      sessionId: "0b7d4c1e-6a2f-4e8b-9c3d-2f1a5e7b9d40",
    },
  });

  t.check(title(fixture("view-sent-queued")), "Queued in Trip planning");
});

// A new chat on an engine that assigns its id later has no session to open, so
// the row offers the chat list:
void test("A new chat on an engine that assigns its id later has no session to open, so...", async (t) => {
  t.check(link(fixture("view-sent-no-session")), {
    kind: "all-chats",
  });
});

// A thought that needs the person says why in words and offers the choices. No
// percentages reach the page.
void test("A thought that needs the person says why in words and offers the choices.", async (t) => {
  t.check(rowFace(fixture("view-needs-choice-uncertain")), {
    kind: "needs-choice",
    title: "Not sure where this goes",
    choices: [
      {
        candidateId: "c2",
        label: "Trip planning",
        detail: "Travel",
      },
      {
        candidateId: "c9",
        label: "New general chat",
      },
      {
        candidateId: "c0",
        label: "Household",
        detail: "Home",
      },
    ],
  });

  t.check(title(fixture("view-needs-choice-routing-unavailable")), "Could not sort this");

  t.check(title(fixture("view-needs-choice-destination-gone")), "That chat is gone");
});

// A delivery that failed offers Retry and Discard, with the server's sentence:
void test("A delivery that failed offers Retry and Discard, with the server's sentence:", async (t) => {
  t.check(rowFace(fixture("view-sending-not-delivered")), {
    kind: "not-delivered",
    title: "Not delivered",
    detail: "Chat is not running on the box. Retry in a moment.",
  });
});

// Past six days a retry could post twice, so the row sends the person to the
// chat to check, and offers no Retry:
void test("Past six days a retry could post twice, so the row sends the person to the ch...", async (t) => {
  t.check(rowFace(fixture("view-sending-expired")), {
    kind: "expired",
    title: "This may already be in Trip planning. Open the chat to check.",
    link: {
      kind: "chat",
      sessionId: "0b7d4c1e-6a2f-4e8b-9c3d-2f1a5e7b9d40",
    },
  });

  t.check(rowFace(fixture("view-discarded")), {
    kind: "discarded",
  });
});

// ## Sending a thought
//
// Send keeps the id and text as `unsent` until `submit` answers. The input
// clears on the answer, and the answer becomes a row.
void test("Send keeps the id and text as unsent until submit answers.", async (t) => {
  let state = run(fresh(), [{ type: "edit", text: "  Call the plumber  " }]);
  const unsent = present(submission(state, ID));
  t.check(unsent, {
    id: "11111111-2222-4333-8444-555555555555",
    message: "Call the plumber",
  });

  state = run(state, [{ type: "submit-started", unsent, origin: "send" }]);
  t.check([unsentStatus(state), storedBoxScreen(state)], [
    "Sending…",
    {
      draft: "  Call the plumber  ",
      unsent: {
        id: "11111111-2222-4333-8444-555555555555",
        message: "Call the plumber",
      },
    },
  ]);

  const answer: QuickChatView = { id: ID, message: "Call the plumber", createdAt: "2026-10-06T15:00:00.000Z", state: "needs-choice", reason: "routing-unavailable", choices: [{ candidateId: "general", label: "New general chat" }] };
  state = run(state, [{ type: "submit-answered", view: answer }]);
  t.check([state.draft, state.unsent, unsentStatus(state)], [
    "",
    null,
    null,
  ]);

  t.check(boxScreenRows(undefined, state).needsYou.map((view) => title(view)), [
    "Could not sort this",
  ]);
});

// A failed request keeps the thought. Sending the same text again reuses its id;
// edited text is a new thought.
void test("A failed request keeps the thought.", async (t) => {
  let state = run(fresh(), [{ type: "edit", text: "Call the plumber" }]);
  state = run(state, [{ type: "submit-started", unsent: present(submission(state, ID)), origin: "send" }, { type: "submit-failed", error: "Failed to fetch" }]);
  t.check(unsentStatus(state), "Not sent: Failed to fetch");

  t.check(submission(state, OTHER_ID), { id: "11111111-2222-4333-8444-555555555555", message: "Call the plumber" });

  t.check(submission(run(state, [{ type: "edit", text: "Call the electrician" }]), OTHER_ID), {
    id: "99999999-8888-4777-8666-555555555555",
    message: "Call the electrician",
  });
});

// ## The stored record comes before the request
//
// `submitUnsent` writes `{id, message}` to storage before it starts the request.
// If the tab dies after the server has the thought and before the answer comes
// back, the reload finds the same id and the server answers with the record it
// already has. A record written only after the request started (for example
// from a React effect) leaves a window where a reload sends the text under a
// new id.
void test("submitUnsent writes {id, message} to storage before it starts the request.", async (t) => {
  const calls: unknown[][] = [];
  const unsent = { id: ID, message: "Book the vet" };
  const answer: QuickChatView = { id: ID, message: "Book the vet", createdAt: "2026-10-06T15:00:00.000Z", state: "needs-choice", reason: "uncertain", choices: [] };
  await submitUnsent({ unsent, origin: "send" }, {
    store: (stored) => calls.push(["store", stored]),
    request: async (input) => { calls.push(["request", input.id]); return answer; },
    dispatch: (action) => calls.push(["dispatch", action.type]),
  });
  t.check(calls, [
    [
      "store",
      {
        draft: "Book the vet",
        unsent: {
          id: "11111111-2222-4333-8444-555555555555",
          message: "Book the vet",
        },
      },
    ],
    [
      "dispatch",
      "submit-started",
    ],
    [
      "request",
      "11111111-2222-4333-8444-555555555555",
    ],
    [
      "dispatch",
      "submit-answered",
    ],
  ]);

  // What the store call wrote is what a reload restores, and a failed request
  // leaves that record in place for the retry:

  const reloaded = restoreBoxScreen(parseStoredBoxScreen(JSON.stringify(calls[0]?.[1])));
  t.check(pendingRetry(reloaded), {
    id: "11111111-2222-4333-8444-555555555555",
    message: "Book the vet",
  });

  const failed: unknown[][] = [];
  const originalConsoleError = console.error;
  console.error = (message) => failed.push(["logged", message]);
  await submitUnsent({ unsent, origin: "send" }, {
    store: (stored) => failed.push(["store", stored.unsent?.id]),
    request: async () => { failed.push(["request"]); throw new Error("Failed to fetch"); },
    dispatch: (action) => failed.push(["dispatch", action.type]),
  });
  console.error = originalConsoleError;
  t.check(failed, [
    [
      "store",
      "11111111-2222-4333-8444-555555555555",
    ],
    [
      "dispatch",
      "submit-started",
    ],
    [
      "request",
    ],
    [
      "logged",
      "[box-screen] quickChat.submit failed",
    ],
    [
      "dispatch",
      "submit-failed",
    ],
  ]);
});

// ## Reload with a stored unsent thought
//
// The page stored the thought and closed before `submit` answered. On reload the
// text is back in the input and the page submits it again on its own, with the
// same id, so the server answers with the record it may already have.
void test("The page stored the thought and closed before submit answered.", async (t) => {
  const raw = JSON.stringify({ draft: "", unsent: { id: ID, message: "Book the vet" } });
  const state = restoreBoxScreen(parseStoredBoxScreen(raw));
  t.check([state.draft, unsentStatus(state), pendingRetry(state)], [
    "Book the vet",
    "Waiting to send",
    {
      id: "11111111-2222-4333-8444-555555555555",
      message: "Book the vet",
    },
  ]);

  t.check(pendingRetry(run(state, [{ type: "submit-started", unsent: present(pendingRetry(state)), origin: "reload" }])), null);

  // If `home` already lists that record (the answer was lost, not the request), the
  // row stays out of "Needs you" until the retry answers, so the thought shows once:

  const home: Home = { open: [{ id: ID, message: "Book the vet", createdAt: "2026-10-06T15:00:00.000Z", state: "needs-choice", reason: "uncertain", choices: [] }], recentlySent: [] };
  t.check(boxScreenRows(home, state).needsYou, []);
});

// A malformed stored value is dropped with a warning rather than breaking the
// page, and the key is the box screen's own, never the chat composer's:
void test("A malformed stored value is dropped with a warning rather than breaking the p...", async (t) => {
  t.check(parseStoredBoxScreen("{not json"), {
    draft: "",
    unsent: null,
  });

  t.check([boxScreenStorageKey({ boxSlug: "test1", scope: "" }), boxScreenStorageKey({ boxSlug: "test1", scope: "main/test1" })], [
    "bbx-box-screen:test1",
    "bbx-box-screen:main/test1",
  ]);
});

// ## Rows merge `home` with this page's answers
//
// An answer replaces `home`'s copy of the same record. A discarded record leaves
// the screen, and a chosen one moves from "Needs you" to sent.
void test("An answer replaces home's copy of the same record.", async (t) => {
  const home = homeFixture();
  const [uncertain, notDelivered] = home.open;
  assert.ok(uncertain && notDelivered, "home lists two open records");
  const state = run(fresh(), [
    { type: "row-started", id: uncertain.id, request: "choose" },
    { type: "row-answered", view: { ...uncertain, state: "sent", reason: undefined, choices: undefined, destination: { label: "Trip planning" } } },
    { type: "row-answered", view: { ...notDelivered, state: "discarded", destination: undefined, lastError: undefined } },
  ]);
  const rows = boxScreenRows(home, state);
  t.check([rows.needsYou, rows.sent.map((view) => title(view)), state.busy], [
    [],
    [
      "Sent to Trip planning",
      "Queued in Household",
    ],
    [],
  ]);
});

// A failed choose or discard leaves the row and says what went wrong:
void test("A failed choose or discard leaves the row and says what went wrong:", async (t) => {
  const state = run(fresh(), [{ type: "row-started", id: ID, request: "choose" }, { type: "row-failed", id: ID, error: "Chat is not running" }]);
  t.check([state.busy, state.rowErrors], [
    [],
    {
      "11111111-2222-4333-8444-555555555555": "Chat is not running",
    },
  ]);
});

// ## After the person's own send or choose
//
// A send the person just made that comes back `sent` with a chat opens that
// chat. The thought is already stored and posted, so a slow chat loses nothing.
// The fixtures share one record id, so the sent answer is the same thought.
void test("A send the person just made that comes back sent with a chat opens that chat.", async (t) => {
  const sent = fixture("view-sent");
  const sendIt = (view: QuickChatView) => run(fresh(), [
    { type: "edit", text: view.message },
    { type: "submit-started", unsent: { id: view.id, message: view.message }, origin: "send" },
    { type: "submit-answered", view },
  ]);
  let state = sendIt(sent);
  t.check([state.followUp, state.awaiting], [
    {
      kind: "open-chat",
      sessionId: "0b7d4c1e-6a2f-4e8b-9c3d-2f1a5e7b9d40",
    },
    [],
  ]);

  t.check(run(state, [{ type: "follow-up-done" }]).followUp, null);

  // A choose the person made opens the chat it posted to, the same way:

  const open = fixture("view-needs-choice-uncertain");
  t.check(
    run(fresh(), [
      { type: "row-started", id: open.id, request: "choose" },
      { type: "row-answered", view: sent },
    ]).followUp,
    {
    kind: "open-chat",
    sessionId: "0b7d4c1e-6a2f-4e8b-9c3d-2f1a5e7b9d40",
  },
  );

  // When there is no chat to open, the page stays and brings the row into view:
  // sent without a session id, a thought that needs a choice, and one that was not
  // delivered. The row's status line is a live region, so the answer is also
  // announced.

  t.check(
    [
      sendIt(fixture("view-sent-no-session")).followUp,
      sendIt(open).followUp,
      sendIt(fixture("view-sending-not-delivered")).followUp,
    ],
    [
    {
      kind: "reveal",
      id: "5f0c2a9e-3b1d-4c7a-9e2f-8d6b1a4c3e70",
    },
    {
      kind: "reveal",
      id: "5f0c2a9e-3b1d-4c7a-9e2f-8d6b1a4c3e70",
    },
    {
      kind: "reveal",
      id: "5f0c2a9e-3b1d-4c7a-9e2f-8d6b1a4c3e70",
    },
  ],
  );

  t.check(followUpFor(fixture("view-discarded")), null);

  // A send that fails stays in the input, and the pinned status line under it
  // says "Not sent", so nothing needs scrolling. The thought is no longer awaited:
  // only pressing Send again makes its answer follow up.

  state = run(fresh(), [
    { type: "edit", text: sent.message },
    { type: "submit-started", unsent: { id: sent.id, message: sent.message }, origin: "send" },
    { type: "submit-failed", error: "Failed to fetch" },
  ]);
  t.check([unsentStatus(state), state.awaiting, state.followUp], [
    "Not sent: Failed to fetch",
    [],
    null,
  ]);

  // ## Answers nobody on the page asked for
  //
  // The reload's own retry of a stored thought only updates the list, even when
  // the answer is `sent` with a chat:

  const reloaded = restoreBoxScreen({ draft: "", unsent: { id: sent.id, message: sent.message } });
  state = run(reloaded, [
    { type: "submit-started", unsent: present(pendingRetry(reloaded)), origin: "reload" },
    { type: "submit-answered", view: sent },
  ]);
  t.check([state.followUp, boxScreenRows(undefined, state).sent], [
    null,
    [sent],
  ]);

  // A discard is the person's action, but it has no chat and no row to show:

  t.check(
    run(fresh(), [
      { type: "row-started", id: open.id, request: "discard" },
      { type: "row-answered", view: fixture("view-discarded") },
    ]).followUp,
    null,
  );

  // The page state belongs to the mounted page for one box (`BoxScreenPage` keys
  // it by box). When the person leaves the box screen or switches boxes, the old
  // page and its reducer are gone, and a late answer has nowhere to land. The new
  // page starts awaiting nothing, so an answer for a thought it did not send
  // follows up nothing:

  t.check([restoreBoxScreen({ draft: "", unsent: null }).awaiting, run(fresh(), [{ type: "submit-answered", view: sent }]).followUp], [
    [],
    null,
  ]);

  // A later answer that nobody awaits keeps a follow-up the page has not acted on
  // yet:

  state = run(sendIt(sent), [{ type: "row-answered", view: fixture("view-sent-queued") }]);
  t.check(state.followUp, {
    kind: "open-chat",
    sessionId: "0b7d4c1e-6a2f-4e8b-9c3d-2f1a5e7b9d40",
  });
});
