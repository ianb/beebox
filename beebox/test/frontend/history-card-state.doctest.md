# History card state

```ts setup
import { legacyHistoryState, parseHistoryCardState, normalizeHistoryViewRouteTarget } from "../../src/frontend/src/components/history/history-card-state.js";
import { historyLookupFailureSearch, historyViewRedirectSearch } from "../../src/frontend/src/components/history/history-card-state.js";
import { parseViewUrl } from "../../src/frontend/src/lib/view-url.js";
import { historySelectionMissing, resolveHistorySelection } from "../../src/frontend/src/components/history/history-selection.js";
const canonical = "_config/interface/history.card";
```

The complete legacy filter vocabulary becomes validated card state.

```ts
parseHistoryCardState(legacyHistoryState({ connector: "github,gmail", workflow: "docs", touchpoint: "true", feedback: "0", session: "chat-1", path: "notes/a.card" }, { commit: "abc123" })).success
=> true
```

Explicit empty and cleared-detail state remains distinct from absent state.

```ts
parseHistoryCardState({ filter: { connectors: [], workflows: [], touchpoint: false, feedback: false, session: null, path: null }, commit: null }).success
=> true
```

Canonical targets normalize without a metadata lookup.

```ts
let loads = 0;
const direct = await normalizeHistoryViewRouteTarget({ path: canonical, viewer: null, params: { session: "filter-chat" }, viewState: { commit: null } }, async () => { loads++; return {}; });
[loads, direct?.params, direct?.viewState?.commit, direct?.viewState?.filter?.session]
=> [
  0,
  {},
  null,
  "filter-chat"
]
```

Authored History cards await identity and merge a legacy query per key over
authored defaults.

```ts
let release;
const gate = new Promise(resolve => { release = resolve; });
const pending = normalizeHistoryViewRouteTarget({ path: "saved.view.card", viewer: null, params: { session: "filter-chat" }, viewState: null }, async () => { await gate; return { type: "view", frontmatter: { view: "history", params: { workflows: ["generateDocs"] } } }; });
let settled = false;
void pending.then(() => { settled = true; });
await Promise.resolve();
settled
=> false
```

```ts continue
release();
const authored = await pending;
authored?.viewState?.filter
=> {
  "connectors": [],
  "workflows": [
    "generateDocs"
  ],
  "touchpoint": false,
  "feedback": false,
  "session": "filter-chat",
  "path": null
}
```

Unrelated authored views keep their query untouched.

```ts
await normalizeHistoryViewRouteTarget({ path: "questions.view.card", viewer: null, params: { session: "leave-me" }, viewState: null }, async () => ({ type: "view", frontmatter: { view: "questions" } }))
=> null
```

Non-card targets never require metadata classification.

```ts
let nonCardLoads = 0;
await normalizeHistoryViewRouteTarget({ path: "notes.txt", viewer: null, params: { session: "recipient" }, viewState: null }, async () => { nonCardLoads++; return {}; });
nonCardLoads
=> 0
```

```ts
await normalizeHistoryViewRouteTarget({ path: canonical, viewer: "Source", params: { session: "leave-me" }, viewState: null }, async () => { throw new Error("must not load"); })
=> null
```

Explicit built-in History renderers still receive legacy normalization, while
genuinely different renderers keep ownership of their query.

```ts
const namedCanonical = await normalizeHistoryViewRouteTarget({ path: canonical, viewer: "History", params: { session: "filter-chat" }, viewState: null }, async () => { throw new Error("must not load"); });
namedCanonical?.viewState?.filter?.session
=> filter-chat
```

```ts
const namedAuthored = await normalizeHistoryViewRouteTarget({ path: "saved.view.card", viewer: "View", params: { session: "filter-chat" }, viewState: null }, async () => ({ type: "view", frontmatter: { view: "history" } }));
namedAuthored?.viewState?.filter?.session
=> filter-chat
```

A failed or moved authored-card lookup nests the original content query under
`card`. The current conversation can therefore remain selected while FileView
retries or follows the move and the eventual History renderer retains filters.

```ts
const failed = { path: "moved.view.card", viewer: "View", params: { session: "filter-chat", workflow: "docs", nativeComposer: "1", contextDir: "wrong" }, viewState: null };
let lookupFailed = false;
try { await normalizeHistoryViewRouteTarget(failed, async () => { throw new Error("moved"); }); } catch { lookupFailed = true; }
const failureSearch = historyLookupFailureSearch(failed, { session: "filter-chat", nativeComposer: "1" });
const retained = parseViewUrl(String(failureSearch.card));
JSON.stringify({ lookupFailed, hasOuterSession: "session" in failureSearch, nativeComposer: failureSearch.nativeComposer, path: retained.path, session: retained.params.session, workflow: retained.params.workflow, hasContextDir: "contextDir" in retained.params })
=> {"lookupFailed":true,"hasOuterSession":false,"nativeComposer":"1","path":"moved.view.card","session":"filter-chat","workflow":"docs","hasContextDir":false}
```

The final redirect separates renderer filter state from shell state.

```ts
historyViewRedirectSearch({ path: canonical, viewer: null, params: { session: "filter", contextDir: "wrong", extra: "content" }, viewState: { filter: { connectors: [], workflows: [], touchpoint: false, feedback: false, session: "filter", path: null } } }, { session: "recipient", nativeComposer: "1", contextDir: "chat" })
=> {
  "nativeComposer": "1",
  "extra": "content",
  "viewState": {
    "filter": {
      "connectors": [],
      "workflows": [],
      "touchpoint": false,
      "feedback": false,
      "session": "filter",
      "path": null
    }
  }
}
```

Invalid state is rejected locally, and selection follows same-mounted A to B
to cleared transitions. An unresolved hash remains pending for paging.

```ts
parseHistoryCardState({ filter: { connectors: "wrong" } }).success
=> false
```

```ts
const commits = [{ hash: "aaaaaaaa" }, { hash: "bbbbbbbb" }];
[resolveHistorySelection(commits, "aaaa"), resolveHistorySelection(commits, "bbbb"), resolveHistorySelection(commits, null), resolveHistorySelection(commits, "missing")]
=> [
  {
    "kind": "selected",
    "commit": {
      "hash": "aaaaaaaa"
    }
  },
  {
    "kind": "selected",
    "commit": {
      "hash": "bbbbbbbb"
    }
  },
  {
    "kind": "cleared"
  },
  {
    "kind": "pending"
  }
]
```

An exhausted empty result identifies a named hash as missing.

```ts
historySelectionMissing({ selection: resolveHistorySelection([], "missing"), selectedHash: "missing", loading: false, hasNextPage: false })
=> true
```

Non-History instruments and explicit non-History renderers cannot consume a
History filter. They skip metadata lookup even if the server is unavailable,
leaving their ordinary shell recipient handling intact.

```ts
const noHistoryLookup = [
  { path: "_config/interface/dashboard.card", viewer: null },
  { path: "_config/interface/admin.card", viewer: null },
  { path: "saved.view.card", viewer: "Source" },
  { path: "saved.view.card", viewer: "Custom" },
];
await Promise.all(noHistoryLookup.map(target => normalizeHistoryViewRouteTarget(
  { ...target, params: { session: "recipient" }, viewState: null },
  async () => { throw new Error("must not classify this target"); },
)))
=> [
  null,
  null,
  null,
  null
]
```
