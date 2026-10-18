// # History card state

import { test } from "tap";
import "agent-doctest/tap";
import { anything } from "agent-doctest/check";
import { legacyHistoryState, parseHistoryCardState, normalizeHistoryViewRouteTarget } from "../../../src/components/history/card-state.js";
import { historyLookupFailureSearch, historyViewRedirectSearch } from "../../../src/components/history/card-state.js";
import { parseViewUrl } from "../../../src/lib/view-url.js";
import { historySelectionMissing, resolveHistorySelection } from "../../../src/components/history/HistoryViewCard/history-selection.js";

const canonical = "_config/interface/history.card";
// The complete legacy filter vocabulary becomes validated card state.
void test("The complete legacy filter vocabulary becomes validated card state.", async (t) => {
  // doctest:L19
  t.check(parseHistoryCardState(legacyHistoryState({ connector: "github,gmail", trigger: "procedure/docs", touchpoint: "true", feedback: "0", session: "chat-1", path: "notes/a.card" }, { commit: "abc123" })), {
    success: true,
    data: {
      filter: { connectors: ["github", "gmail"], triggers: ["procedure/docs"], touchpoint: true, feedback: false, session: "chat-1", path: "notes/a.card" },
      commit: "abc123",
    },
  });
});

// `workflow=` is the pre-rename spelling of `trigger=`. An old link keeps
// working: its bare run names read as the procedure ids those runs have now, and
// an explicit `trigger=` wins over it.
void test("workflow= is the pre-rename spelling of trigger=.", async (t) => {
  // doctest:L28
  t.check(legacyHistoryState({ workflow: "process-news,process-pages" }), {
    filter: { connectors: [], triggers: ["procedure/process-news", "procedure/process-pages"], touchpoint: false, feedback: false, session: null, path: null },
  });

  // doctest:L31
  t.check(legacyHistoryState({ trigger: "command/bbx wakeup", workflow: "process-news" }), {
    filter: { connectors: [], triggers: ["command/bbx wakeup"], touchpoint: false, feedback: false, session: null, path: null },
  });
});

// Explicit empty and cleared-detail state remains distinct from absent state.
void test("Explicit empty and cleared-detail state remains distinct from absent state.", async (t) => {
  // doctest:L38
  t.check(parseHistoryCardState({ filter: { connectors: [], triggers: [], touchpoint: false, feedback: false, session: null, path: null }, commit: null }), {
    success: true,
    data: { filter: { connectors: [], triggers: [], touchpoint: false, feedback: false, session: null, path: null }, commit: null },
  });
});

// A link saved before the rename carries the old axis inside its serialized
// state. It migrates to the current vocabulary instead of failing the strict
// parse and blanking the card.
void test("A link saved before the rename carries the old axis inside its serialized state.", async (t) => {
  // doctest:L47
  const legacy = parseHistoryCardState({ filter: { connectors: [], workflows: ["process-news"], touchpoint: false, feedback: false, session: null, path: null }, commit: "abc123" });
  t.check(legacy, {
    success: true,
    data: { filter: { connectors: [], triggers: ["procedure/process-news"], touchpoint: false, feedback: false, session: null, path: null }, commit: "abc123" },
  });
});

// Canonical targets normalize without a metadata lookup.
void test("Canonical targets normalize without a metadata lookup.", async (t) => {
  // doctest:L55
  let loads = 0;
  const direct = await normalizeHistoryViewRouteTarget({ path: canonical, viewer: null, params: { session: "filter-chat" }, viewState: { commit: null } }, async () => { loads++; return {}; });
  t.check({ loads, direct }, {
    loads: 0,
    direct: {
      path: "_config/interface/history.card",
      viewer: null,
      params: {},
      viewState: {
        filter: { connectors: [], triggers: [], touchpoint: false, feedback: false, session: "filter-chat", path: null },
        commit: null,
      },
    },
  });
});

// Authored History cards await identity and merge a legacy query per key over
// authored defaults.
void test("Authored History cards await identity and merge a legacy query per key over a...", async (t) => {
  // doctest:L70
  let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const pending = normalizeHistoryViewRouteTarget({ path: "saved.view.card", viewer: null, params: { session: "filter-chat" }, viewState: null }, async () => { await gate; return { type: "view", frontmatter: { view: "history", params: { triggers: ["command/generateDocs"] } } }; });
  let settled = false;
  void pending.then(() => { settled = true; });
  await Promise.resolve();
  t.check(settled, false);

  // doctest:L81
  release();
  const authored = await pending;
  t.check(authored, {
    path: "saved.view.card",
    viewer: null,
    params: {},
    viewState: {
      filter: { connectors: [], triggers: ["command/generateDocs"], touchpoint: false, feedback: false, session: "filter-chat", path: null },
    },
  });
});

// Unrelated authored views keep their query untouched.
void test("Unrelated authored views keep their query untouched.", async (t) => {
  // doctest:L99
  t.check(await normalizeHistoryViewRouteTarget({ path: "questions.view.card", viewer: null, params: { session: "leave-me" }, viewState: null }, async () => ({ type: "view", frontmatter: { view: "questions" } })), null);
});

// Non-card targets never require metadata classification.
void test("Non-card targets never require metadata classification.", async (t) => {
  // doctest:L106
  let nonCardLoads = 0;
  await normalizeHistoryViewRouteTarget({ path: "notes.txt", viewer: null, params: { session: "recipient" }, viewState: null }, async () => { nonCardLoads++; return {}; });
  t.check(nonCardLoads, 0);
});

void test("line 112", async (t) => {
  // doctest:L113
  t.check(await normalizeHistoryViewRouteTarget({ path: canonical, viewer: "Source", params: { session: "leave-me" }, viewState: null }, async () => { throw new Error("must not load"); }), null);
});

// Explicit built-in History renderers still receive legacy normalization, while
// genuinely different renderers keep ownership of their query.
void test("Explicit built-in History renderers still receive legacy normalization, while...", async (t) => {
  // doctest:L121
  const namedCanonical = await normalizeHistoryViewRouteTarget({ path: canonical, viewer: "History", params: { session: "filter-chat" }, viewState: null }, async () => { throw new Error("must not load"); });
  t.check(namedCanonical, {
    path: "_config/interface/history.card",
    viewer: "History",
    params: {},
    viewState: { filter: { connectors: [], triggers: [], touchpoint: false, feedback: false, session: "filter-chat", path: null } },
  });
});

void test("line 126", async (t) => {
  // doctest:L127
  const namedAuthored = await normalizeHistoryViewRouteTarget({ path: "saved.view.card", viewer: "View", params: { session: "filter-chat" }, viewState: null }, async () => ({ type: "view", frontmatter: { view: "history" } }));
  t.check(namedAuthored, {
    path: "saved.view.card",
    viewer: "View",
    params: {},
    viewState: { filter: { connectors: [], triggers: [], touchpoint: false, feedback: false, session: "filter-chat", path: null } },
  });
});

// A failed or moved authored-card lookup nests the original content query under
// `card`. The current conversation can therefore remain selected while FileView
// retries or follows the move and the eventual History renderer retains filters.
void test("A failed or moved authored-card lookup nests the original content query under...", async (t) => {
  // doctest:L137
  const failed = { path: "moved.view.card", viewer: "View", params: { session: "filter-chat", workflow: "docs", nativeComposer: "1", contextDir: "wrong" }, viewState: null };
  let lookupFailed = false;
  try { await normalizeHistoryViewRouteTarget(failed, async () => { throw new Error("moved"); }); } catch (_e) { lookupFailed = true; }
  const failureSearch = historyLookupFailureSearch(failed, { session: "filter-chat", nativeComposer: "1" });
  const retained = parseViewUrl(String(failureSearch.card));
  t.check({ lookupFailed, failureSearch, retained }, {
    lookupFailed: true,
    failureSearch: { nativeComposer: "1", card: "moved.view.card?view=View&session=filter-chat&workflow=docs" },
    retained: { path: "moved.view.card", viewer: "View", params: { session: "filter-chat", workflow: "docs" }, viewState: null },
  });
});

// The final redirect separates renderer filter state from shell state.
void test("The final redirect separates renderer filter state from shell state.", async (t) => {
  // doctest:L149
  t.check(historyViewRedirectSearch({ path: canonical, viewer: null, params: { session: "filter", contextDir: "wrong", extra: "content" }, viewState: { filter: { connectors: [], triggers: [], touchpoint: false, feedback: false, session: "filter", path: null } } }, { session: "recipient", nativeComposer: "1", contextDir: "chat" }), {
    nativeComposer: "1",
    view: undefined,
    extra: "content",
    viewState: { filter: { connectors: [], triggers: [], touchpoint: false, feedback: false, session: "filter", path: null } },
  });
});

// Invalid state is rejected locally, and selection follows same-mounted A to B
// to cleared transitions. An unresolved hash remains pending for paging.
void test("Invalid state is rejected locally, and selection follows same-mounted A to B...", async (t) => {
  // doctest:L170
  // The error text is Zod's own; the contract is that parsing fails.
  t.check(parseHistoryCardState({ filter: { connectors: "wrong" } }), { success: false, error: anything() });
});

void test("line 174", async (t) => {
  // doctest:L175
  const commits = [{ hash: "aaaaaaaa" }, { hash: "bbbbbbbb" }];
  t.check([resolveHistorySelection(commits, "aaaa"), resolveHistorySelection(commits, "bbbb"), resolveHistorySelection(commits, null), resolveHistorySelection(commits, "missing")], [
    {
      kind: "selected",
      commit: {
        hash: "aaaaaaaa",
      },
    },
    {
      kind: "selected",
      commit: {
        hash: "bbbbbbbb",
      },
    },
    {
      kind: "cleared",
    },
    {
      kind: "pending",
    },
  ]);
});

// An exhausted empty result identifies a named hash as missing.
void test("An exhausted empty result identifies a named hash as missing.", async (t) => {
  // doctest:L202
  t.check(historySelectionMissing({ selection: resolveHistorySelection([], "missing"), selectedHash: "missing", loading: false, hasNextPage: false }), true);
});

// Non-History instruments and explicit non-History renderers cannot consume a
// History filter. They skip metadata lookup even if the server is unavailable,
// leaving their ordinary shell recipient handling intact.
void test("Non-History instruments and explicit non-History renderers cannot consume a H...", async (t) => {
  // doctest:L211
  const noHistoryLookup = [
    { path: "_config/interface/dashboard.card", viewer: null },
    { path: "_config/interface/admin.card", viewer: null },
    { path: "saved.view.card", viewer: "Source" },
    { path: "saved.view.card", viewer: "Custom" },
  ];
  t.check(
    await Promise.all(noHistoryLookup.map(target => normalizeHistoryViewRouteTarget(
      { ...target, params: { session: "recipient" }, viewState: null },
      async () => { throw new Error("must not classify this target"); },
    ))),
    [
    null,
    null,
    null,
    null,
  ],
  );
});
