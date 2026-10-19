// # Chat history dropdown: the landmark you're in comes first
//
// `layoutSessionList` decides what the history dropdown renders. The rule is
// **prominence, not scoping**: the chats bound to the landmark you're chatting in
// lead under its name, and everything else follows under "Other chats". Nothing is
// filtered out — a chat in another landmark is always still reachable.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import type { ChatSessionInfo } from "../../../../../src/api.js";
import { layoutSessionList, sessionIdHint, type SessionListLayout } from "../../../../../src/components/chat/everywhere/InteractiveChat/session-list-grouping.js";

function session({ sessionId, contextDir, landmarkLabel, done }: { sessionId: string; contextDir: string; landmarkLabel: string; done?: boolean }): ChatSessionInfo {
  return {
    sessionId,
    source: "chat",
    label: `chat ${sessionId}`,
    lastUsedAt: "2026-07-30T12:00:00Z",
    isActive: false,
    contextDir,
    landmarkLabel,
    done: done ?? false,
  };
}

const SESSIONS = [
  session({ sessionId: "r1", contextDir: "_content/recipes", landmarkLabel: "Recipes" }),
  session({ sessionId: "n1", contextDir: "_content/notes", landmarkLabel: "Notes" }),
  session({ sessionId: "r2", contextDir: "_content/recipes", landmarkLabel: "Recipes" }),
  session({ sessionId: "root1", contextDir: "", landmarkLabel: "Root" }),
];

// Compact rendering of a layout, so the expectations read like the menu does.
function show(layout: SessionListLayout): string {
  const done = layout.done.length === 0 ? [] : [`Done: ${layout.done.map((s: ChatSessionInfo) => s.sessionId).join(" ")}`];
  if (layout.kind === "flat") {
    return [`flat${layout.showLandmark ? " (tagged)" : ""}: ${layout.sessions.map((s) => s.sessionId).join(" ")}`, ...done].join("\n");
  }
  return [
    `${layout.hereLabel}: ${layout.here.map((s) => s.sessionId).join(" ")}`,
    `Other chats: ${layout.elsewhere.map((s) => s.sessionId).join(" ")}`,
    ...done,
  ].join("\n");
}

// ## Chatting inside a landmark
//
// Its chats lead, under the landmark's own name. Everything else — including the
// root chats — stays below, in the order it came in (most recent first).
void test("Its chats lead, under the landmark's own name.", async (t) => {
  // doctest:L52
  await t.checkText(show(layoutSessionList({ sessions: SESSIONS, contextDir: "_content/recipes" })), `Recipes: r1 r2
Other chats: n1 root1`);
});

// Root is not a special case — it's a landmark like any other, so a root-bound
// chat promotes root's chats and pushes the rest down.
void test("Root is not a special case — it's a landmark like any other, so a root-bound...", async (t) => {
  // doctest:L62
  await t.checkText(show(layoutSessionList({ sessions: SESSIONS, contextDir: "" })), `Root: root1
Other chats: r1 n1 r2`);
});

// ## When grouping would say nothing, it doesn't group
//
// A landmark with no chats of its own yet gets no empty heading — one flat list,
// tagged with each row's landmark since they differ.
void test("A landmark with no chats of its own yet gets no empty heading — one flat list...", async (t) => {
  // doctest:L74
  t.check(show(layoutSessionList({ sessions: SESSIONS, contextDir: "_content/empty" })), "flat (tagged): r1 n1 r2 root1");
});

// Same for a brand-new chat whose binding hasn't resolved yet (`contextDir` is
// null until the session id lands).
void test("Same for a brand-new chat whose binding hasn't resolved yet (contextDir is nu...", async (t) => {
  // doctest:L82
  t.check(show(layoutSessionList({ sessions: SESSIONS, contextDir: null })), "flat (tagged): r1 n1 r2 root1");
});

// And when every chat is in the landmark you're in, a lone "Recipes" heading over
// the whole list would be pure chrome — so it stays flat, and the rows carry no
// tag because there's only one landmark to name.
void test("And when every chat is in the landmark you're in, a lone \"Recipes\" heading ov...", async (t) => {
  // doctest:L91
  const onlyRecipes = SESSIONS.filter((s) => s.contextDir === "_content/recipes");
  t.check(show(layoutSessionList({ sessions: onlyRecipes, contextDir: "_content/recipes" })), "flat: r1 r2");
});

// ## Done chats trail the list, out of the prominence contest
//
// A chat the boxholder marked done no longer counts toward any group: it leaves
// "Recipes" and trails under "Done", still listed and still resumable. Here the
// only other Recipes chat is done, so the one live Recipes chat would sit under a
// heading of one — and the grouping rule still applies to the live chats alone.
void test("A chat the boxholder marked done no longer counts toward any group:", async (t) => {
  // doctest:L104
  const withDone = [
    session({ sessionId: "r1", contextDir: "_content/recipes", landmarkLabel: "Recipes" }),
    session({ sessionId: "r2", contextDir: "_content/recipes", landmarkLabel: "Recipes", done: true }),
    session({ sessionId: "n1", contextDir: "_content/notes", landmarkLabel: "Notes" }),
    session({ sessionId: "n2", contextDir: "_content/notes", landmarkLabel: "Notes", done: true }),
  ];
  await t.checkText(show(layoutSessionList({ sessions: withDone, contextDir: "_content/recipes" })), `Recipes: r1
Other chats: n1
Done: r2 n2`);
});

// When every chat in the landmark you're in is done, the landmark has no live
// chats to promote, so the live list stays flat and the done chats still trail.
void test("When every chat in the landmark you're in is done, the landmark has no live c...", async (t) => {
  // doctest:L121
  const recipesAllDone = [
    session({ sessionId: "r1", contextDir: "_content/recipes", landmarkLabel: "Recipes", done: true }),
    session({ sessionId: "n1", contextDir: "_content/notes", landmarkLabel: "Notes" }),
    session({ sessionId: "root1", contextDir: "", landmarkLabel: "Root" }),
  ];
  await t.checkText(show(layoutSessionList({ sessions: recipesAllDone, contextDir: "_content/recipes" })), `flat (tagged): n1 root1
Done: r1`);
});

// ## The short session id shows only where labels collide
//
// Rows used to show the first eight characters of the session id beside every
// title. Chats now get generated titles, so the id only tells rows apart when two
// read the same. A row whose label already is the id prefix (an untitled, empty
// chat) does not repeat it. Every row keeps its full id in a tooltip.
void test("Rows used to show the first eight characters of the session id beside every t...", async (t) => {
  // doctest:L140
  const rows = [
    { sessionId: "aaaa1111-x", label: "Lending the drill" },
    { sessionId: "bbbb2222-x", label: "Groceries" },
    { sessionId: "cccc3333-x", label: "Groceries" },
    { sessionId: "dddd4444-x", label: "dddd4444" },
  ];
  t.check(rows.map((row) => sessionIdHint(row, rows)), [
    null,
    "bbbb2222",
    "cccc3333",
    null,
  ]);
});
