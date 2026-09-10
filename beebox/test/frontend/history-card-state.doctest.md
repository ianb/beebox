# History card state

```ts setup
import { legacyHistoryState, parseHistoryCardState, normalizeHistoryViewRouteTarget } from "../../src/frontend/src/components/history/history-card-state.js";
import { historyViewRedirectSearch } from "../../src/frontend/src/components/history/history-card-state.js";
import { resolveHistorySelection } from "../../src/frontend/src/components/history/history-selection.js";
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

```ts
await normalizeHistoryViewRouteTarget({ path: canonical, viewer: "Source", params: { session: "leave-me" }, viewState: null }, async () => { throw new Error("must not load"); })
=> null
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
