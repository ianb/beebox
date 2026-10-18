// # Workspace history navigation decisions
//
// History snapshots restore only for the active development scope and logical
// conversation. Without one, a card URL is a fresh open intent.

import { test } from "tap";
import "agent-doctest/tap";
import {
  decideWorkspaceNavigation,
  parseScopedWorkspaceHistory,
  shouldRestoreMobileWithBack,
  workspaceDisplayReady,
  workspaceRouteBound,
  workspaceOpenShouldReplace,
  explicitConversationHistoryState, legacyOverlayActions,
  revealConversationActions,
  workspaceHistoryTarget,
} from "../../../../src/components/chat/workspace/history.js";
import { createEmptyWorkspaceState, projectWorkspace } from "../../../../src/components/chat/workspace/state-model.js";
import { reduceWorkspace } from "../../../../src/components/chat/workspace/state-reducer.js";
import { serializeWorkspaceState } from "../../../../src/components/chat/workspace/storage.js";

const snapshot = serializeWorkspaceState(createEmptyWorkspaceState());
const entry = { scope: "paper-cards/test1", identity: "session-1", snapshot, revision: 8 };

// Legacy overlay conversion opens the incoming card before revealing chat. It
// does not invent return metadata, so Show cards restores in place.
void test("Legacy overlay conversion opens the incoming card before revealing chat.", async (t) => {
  // doctest:L30
  const legacyCard = { path: "_content/legacy.doc.card", viewer: "Source", params: { page: "2" }, viewState: { cursor: 4 } };
  const legacyActions = legacyOverlayActions({ state: createEmptyWorkspaceState(), incoming: legacyCard, viewport: "mobile", at: 9 });
  t.check(legacyActions.map(action => action.type), [
    "openCard",
    "showChat",
  ]);
});

// ## Explicit chat-about intent reveals the conversation once
//
// The router state preserves unrelated history metadata. The workspace then uses
// ordinary pane actions to reveal chat after the selected card has opened.
void test("The router state preserves unrelated history metadata.", async (t) => {
  // doctest:L45
  await t.checkText(JSON.stringify(explicitConversationHistoryState({ inherited: "sentinel", bbxConversation: { kind: "old" } })), "{\"inherited\":\"sentinel\",\"bbxWorkspaceRevealConversation\":true}");

  // doctest:L48
  const detailed = { path: "dashboard.card", viewer: "Source", params: { page: "2" }, viewState: { cursor: 4 } };
  let focused = reduceWorkspace(createEmptyWorkspaceState(), {
    type: "openCard", target: detailed, label: "Dashboard", at: 1, viewport: "desktop",
  }).state;
  focused = reduceWorkspace(focused, { type: "focusPane", pane: focused.lastCardPane }).state;
  const focusActions = revealConversationActions({ state: focused, cardPath: detailed.path, viewport: "desktop" });
  t.check(focusActions.map((action) => action.type).join(","), "backToSplit");

  // doctest:L57
  const revealed = focusActions.reduce((state, action) => reduceWorkspace(state, action).state, focused);
  t.check(projectWorkspace(revealed, "desktop").transcript, "right");

  // doctest:L61
  t.check(revealed.tabs[detailed.path]?.target, {
    path: "dashboard.card",
    viewer: "Source",
    params: {
      page: "2",
    },
    viewState: {
      cursor: 4,
    },
  });

  // When both desktop panes contain cards, the selected card stays visible and the
  // other pane becomes chat. Mobile retains the selected card as the return target.

  // doctest:L69
  let twoCards = reduceWorkspace(createEmptyWorkspaceState(), {
    type: "openCard", target: detailed, label: "Dashboard", at: 1, viewport: "desktop",
  }).state;
  twoCards = reduceWorkspace(twoCards, {
    type: "openCard", target: { ...detailed, path: "notes.card" }, label: "Notes", at: 2, viewport: "desktop",
  }).state;
  twoCards = reduceWorkspace(twoCards, { type: "moveActive", pane: "left" }).state;
  const desktopActions = revealConversationActions({ state: twoCards, cardPath: "notes.card", viewport: "desktop" });
  t.check(desktopActions, [
    {
      type: "showChat",
      pane: "left",
      viewport: "desktop",
    },
  ]);

  // doctest:L80
  const desktopRevealed = desktopActions.reduce((state, action) => reduceWorkspace(state, action).state, twoCards);
  t.check(projectWorkspace(desktopRevealed, "desktop"), {
    visiblePanes: [
      {
        pane: "right",
        path: "notes.card",
      },
    ],
    visiblePaths: {
      right: "notes.card",
    },
    transcript: "left",
    foregroundPath: "notes.card",
    restorePane: "left",
  });

  // doctest:L84
  const mobileCard = reduceWorkspace(twoCards, {
    type: "openCard", target: { ...detailed, path: "notes.card" }, label: "Notes", at: 3, viewport: "mobile",
  }).state;
  const mobileActions = revealConversationActions({ state: mobileCard, cardPath: "notes.card", viewport: "mobile" });
  const mobileRevealed = mobileActions.reduce((state, action) => reduceWorkspace(state, action).state, mobileCard);
  t.check(projectWorkspace(mobileRevealed, "mobile"), {
    visiblePanes: [],
    visiblePaths: {},
    transcript: "full",
    foregroundPath: null,
    restorePane: "left",
  });

  // doctest:L92
  t.check(mobileRevealed.mobileView, {
    kind: "chat",
    returnPath: "notes.card",
  });

  // doctest:L95
  t.check(workspaceHistoryTarget({ state: mobileRevealed, viewport: "mobile", retainedTarget: { ...detailed, path: "notes.card" } }), {
    path: "notes.card",
    viewer: "Source",
    params: {
      page: "2",
    },
    viewState: {
      cursor: 4,
    },
  });
});

// ## Workspace effects wait for the route's authoritative conversation
//
// During first load the rendered conversation may still belong to the previous
// URL. An absent or mismatched route selection cannot write that workspace over
// the incoming conversation. Both a resolved start and assigned session bind by
// their actual identity.
void test("During first load the rendered conversation may still belong to the previous...", async (t) => {
  // doctest:L107
  t.check(workspaceRouteBound(undefined, "new-client"), false);

  // doctest:L110
  t.check(workspaceRouteBound({ kind: "ready", target: { kind: "session", sessionId: "old-session", contextDir: "" }, label: "Old" }, "new-client"), false);

  // doctest:L113
  t.check(workspaceRouteBound({ kind: "ready", target: { kind: "start", clientConversationId: "new-client", contextDir: "", engine: "claude" }, label: "New" }, "new-client"), true);

  // doctest:L116
  t.check(workspaceRouteBound({ kind: "ready", target: { kind: "session", sessionId: "session-1", contextDir: "" }, label: "Current" }, "session-1"), true);

  // doctest:L119
  t.check(workspaceRouteBound({ kind: "resolving", requestId: "request-1", contextDir: "" }, "session-1"), false);
});

// Assignment keeps the workspace visible through exactly the announced identity
// handoff. A store identity from any unrelated conversation remains hidden.
void test("Assignment keeps the workspace visible through exactly the announced identity...", async (t) => {
  // doctest:L127
  t.check(workspaceDisplayReady({ renderedIdentity: "client-1", storedIdentity: "client-1", adoption: null }), true);

  // doctest:L130
  const adoption = { from: "client-1", to: "session-1" };
  t.check(workspaceDisplayReady({ renderedIdentity: "client-1", storedIdentity: "session-1", adoption }), true);

  // doctest:L134
  t.check(workspaceDisplayReady({ renderedIdentity: "session-1", storedIdentity: "client-1", adoption }), true);

  // doctest:L137
  t.check(workspaceDisplayReady({ renderedIdentity: "session-1", storedIdentity: "session-1", adoption }), true);

  // doctest:L140
  t.check(workspaceDisplayReady({ renderedIdentity: "other-client", storedIdentity: "session-1", adoption }), false);

  // doctest:L143
  t.check(workspaceDisplayReady({ renderedIdentity: "client-1", storedIdentity: "other-session", adoption }), false);
});

// ## An unchanged foreground open replaces history
//
// Reducer bookkeeping such as activation time does not create a new Back stop.
// Changing an explicit viewer remains a new visible target and pushes.
void test("Reducer bookkeeping such as activation time does not create a new Back stop.", async (t) => {
  // doctest:L153
  const target = (viewer: string | null) => ({ path: "a", viewer, params: {}, viewState: null });
  const first = reduceWorkspace(createEmptyWorkspaceState(), {
    type: "openCard", target: target(null), label: "a", at: 1, viewport: "desktop",
  }).state;
  const reopened = reduceWorkspace(first, {
    type: "openCard", target: target(null), label: "renamed a", at: 2, viewport: "desktop",
  }).state;
  t.check(workspaceOpenShouldReplace({ before: first, after: reopened, viewport: "desktop" }), true);

  // doctest:L163
  const changedViewer = reduceWorkspace(first, {
    type: "openCard", target: target("markdown"), label: "a markdown", at: 3, viewport: "desktop",
  }).state;
  t.check(workspaceOpenShouldReplace({ before: first, after: changedViewer, viewport: "desktop" }), false);

  // doctest:L169
  const secondCard = reduceWorkspace(first, {
    type: "openCard", target: { ...target(null), path: "b" }, label: "b", at: 4, viewport: "desktop",
  }).state;
  t.check(workspaceOpenShouldReplace({ before: first, after: secondCard, viewport: "desktop" }), false);
});

// ## Scope, identity, and snapshot shape are all boundaries
void test("Scope, identity, and snapshot shape are all boundaries", async (t) => {
  // doctest:L179
  t.check(parseScopedWorkspaceHistory(entry, { scope: "paper-cards/test1", identity: "session-1" }).kind, "snapshot");

  // doctest:L182
  t.check(parseScopedWorkspaceHistory(entry, { scope: "main/test1", identity: "session-1" }).kind, "none");

  // doctest:L185
  t.check(parseScopedWorkspaceHistory(entry, { scope: "paper-cards/test1", identity: "session-2" }).kind, "none");

  // doctest:L188
  t.check(parseScopedWorkspaceHistory({ ...entry, revision: "8" }, { scope: entry.scope, identity: entry.identity }).kind, "none");

  // doctest:L191
  t.check(parseScopedWorkspaceHistory({ ...entry, snapshot: "not json" }, { scope: entry.scope, identity: entry.identity }).kind, "none");

  // doctest:L194
  t.check(parseScopedWorkspaceHistory({ ...entry, returnRevision: 7 }, { scope: entry.scope, identity: entry.identity }).kind, "none");
});

// ## Restored history takes precedence over its projected card URL
//
// The URL on a restored entry reflects the snapshot; replaying it as an open
// would run opposite-pane routing a second time.
void test("The URL on a restored entry reflects the snapshot; replaying it as an open wo...", async (t) => {
  // doctest:L204
  t.check(decideWorkspaceNavigation({ history: entry, scope: entry.scope, identity: entry.identity, freshCard: "a.card" }).kind, "restore-snapshot");

  // doctest:L207
  t.check(decideWorkspaceNavigation({ history: entry, scope: entry.scope, identity: entry.identity, freshCard: "nested.card?view=Source", cardEntry: true }), {
    kind: "open-url",
    card: "nested.card?view=Source",
  });

  // doctest:L210
  t.check(decideWorkspaceNavigation({ history: undefined, scope: entry.scope, identity: entry.identity, freshCard: "a.card" }), {
    kind: "open-url",
    card: "a.card",
  });

  // doctest:L213
  t.check(decideWorkspaceNavigation({ history: undefined, scope: entry.scope, identity: entry.identity, freshCard: null }).kind, "keep-current");
});

// ## Mobile Back requires the exact adjacent return entry
//
// The show-conversation push records both the card entry's history index and its
// workspace revision. A stale entry matching only one coordinate restores cards
// in place instead of navigating somewhere unrelated.
void test("The show-conversation push records both the card entry's history index and it...", async (t) => {
  // doctest:L224
  const returnEntry = { ...entry, revision: 9, returnRevision: 8, returnIndex: 12 };
  t.check(shouldRestoreMobileWithBack(returnEntry, 13), true);

  // doctest:L228
  t.check(shouldRestoreMobileWithBack({ ...returnEntry, returnIndex: 11 }, 13), false);

  // doctest:L231
  t.check(shouldRestoreMobileWithBack({ ...returnEntry, returnRevision: 7 }, 13), false);

  // doctest:L234
  t.check(shouldRestoreMobileWithBack(returnEntry, 14), false);

  // doctest:L237
  t.check(shouldRestoreMobileWithBack(entry, 13), false);
});

// ## Canonical card entry beats an inherited arrangement
//
// A compatibility redirect can preserve the previous Dashboard snapshot while
// its URL asks to open Settings. Only projected chat entries restore snapshots;
// a canonical card entry must execute its new open intent. Back to a projected
// entry continues restoring the exact arrangement.
void test("A compatibility redirect can preserve the previous Dashboard snapshot while i...", async (t) => {
  // doctest:L249
  t.check(decideWorkspaceNavigation({ history: entry, scope: entry.scope, identity: entry.identity, freshCard: "_config/interface/settings.card", cardEntry: true }), {
    kind: "open-url",
    card: "_config/interface/settings.card",
  });

  // doctest:L252
  t.check(decideWorkspaceNavigation({ history: entry, scope: entry.scope, identity: entry.identity, freshCard: "_config/interface/settings.card", cardEntry: false }).kind, "restore-snapshot");
});
