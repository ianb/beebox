# Browse card state

Browse owns its directory and structured detail independently of route splats.

```ts setup
import { parseBrowseState, browseCardTarget, normalizeBrowseTarget, legacyBrowseTarget } from "../../src/frontend/src/lib/browse-card-state.js";
import { serializeViewUrl, parseViewUrl } from "../../src/frontend/src/lib/view-url.js";
```

Root and explicit state take precedence over a directory seed. Invalid paths
and mismatched detail are errors, never root fallbacks.

```ts
parseBrowseState({})
=> {
  "ok": true,
  "state": {
    "directory": ""
  }
}

parseBrowseState({ params: { dir: "/_content/recipes/" } })
=> {
  "ok": true,
  "state": {
    "directory": "_content/recipes"
  }
}

parseBrowseState({ params: { dir: "_content/old" }, viewState: { directory: "_content/new" } })
=> {
  "ok": true,
  "state": {
    "directory": "_content/new"
  }
}

parseBrowseState({ params: { dir: "../../outside" } }).ok
=> false

parseBrowseState({ viewState: { directory: "_content/a", detail: { path: "_content/b/file.card", viewer: null, params: {}, viewState: null } } }).ok
=> false

parseBrowseState({ viewState: { directory: "_content?view=Source" } }).ok
=> false
```

A seed becomes owned state and disappears from params. Bare opens retain the
absence of state so the workspace can preserve a previously open Browse tab.

```ts
const bare = { ...browseCardTarget({ directory: "" }), viewState: null };
normalizeBrowseTarget(bare).viewState
=> null

normalizeBrowseTarget({ ...bare, params: { dir: "_content/recipes", extra: "yes" } })
=> {
  "path": "_config/interface/browse.card",
  "viewer": null,
  "params": {
    "extra": "yes"
  },
  "viewState": {
    "directory": "_content/recipes"
  }
}
```

Legacy conversion uses actual kinds, including extensionless files and dotted
attachment directories. Nested state roundtrips without an embedded URL.

```ts
const file = { path: "_content/README", viewer: "Source", params: { zoom: "2" }, viewState: { selected: [1, 2] } };
const converted = await legacyBrowseTarget(file, async () => "file");
parseBrowseState(parseViewUrl(serializeViewUrl(converted)))
=> {
  "ok": true,
  "state": {
    "directory": "_content",
    "detail": {
      "path": "_content/README",
      "viewer": "Source",
      "params": {
        "zoom": "2"
      },
      "viewState": {
        "selected": [
          1,
          2
        ]
      }
    }
  }
}

(await legacyBrowseTarget({ ...file, path: "_content/Photo.attach" }, async () => "directory")).viewState
=> {
  "directory": "_content/Photo.attach"
}

(await legacyBrowseTarget({ ...file, path: "_content/gone" }, async () => "missing")).viewState
=> {
  "directory": "_content",
  "detail": {
    "path": "_content/gone",
    "viewer": "Source",
    "params": {
      "zoom": "2"
    },
    "viewState": {
      "selected": [
        1,
        2
      ]
    }
  }
}

(await legacyBrowseTarget({ ...file, path: "_content/Old.memo.card" }, async () => "missing")).viewState
=> {
  "directory": "_content",
  "detail": {
    "path": "_content/Old.memo.card",
    "viewer": "Source",
    "params": {
      "zoom": "2"
    },
    "viewState": {
      "selected": [
        1,
        2
      ]
    }
  }
}
```
