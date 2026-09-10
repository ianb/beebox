# Canonical card navigation

A routed card retains its query and nested view state when adopted into the
workspace. Shell flags do not become instrument parameters. Canonical tools
resolve their semantic place on cold entry, while warm selection wins.

```ts setup
import { workspaceRouteTarget, systemCardEntryContext, systemCardAttentionRef, withoutShellParams, workspaceProjectionSearch } from "../../src/frontend/src/lib/system-card-navigation.js";
import { routeConversationRequest } from "../../src/frontend/src/components/chat/everywhere/conversation-intent.js";
import { SYSTEM_CARD_PATHS } from "../../src/shared/system-card-paths.js";
import { serializeViewUrl } from "../../src/frontend/src/lib/view-url.js";
const browse = { path: SYSTEM_CARD_PATHS.browse, viewer: null, params: {}, viewState: { directory: "_content/recipes", detail: { path: "_content/recipes/a.memo.card", viewer: "Source", params: {}, viewState: null } } };
```

```ts
const query = serializeViewUrl(browse).split("?")[1];
const target = workspaceRouteTarget({ pathname: "/test/views/" + browse.path, splat: browse.path, searchStr: "?" + query + "&nativeComposer=1", search: {} });
JSON.stringify(target)
=> {"path":"_config/interface/browse.card","viewer":null,"params":{},"viewState":{"directory":"_content/recipes","detail":{"path":"_content/recipes/a.memo.card","viewer":"Source","params":{},"viewState":null}}}

JSON.stringify(systemCardEntryContext(target))
=> {"cardPath":null,"browseDir":"_content/recipes"}

JSON.stringify(systemCardEntryContext({ ...browse, path: SYSTEM_CARD_PATHS.dashboard }))
=> {"cardPath":null,"browseDir":""}
```

```ts
const input = { first: true, chatPage: false, search: {}, selection: { kind: "resolving", contextDir: "", requestId: "cold" }, remembered: null, ...systemCardEntryContext(browse) };
JSON.stringify(routeConversationRequest(input))
=> {"kind":"landmark","contextDir":"_content/recipes"}

const chosen = { kind: "ready", target: { kind: "session", sessionId: "chosen", contextDir: "_content/work" }, label: "Work" };
routeConversationRequest({ ...input, first: false, selection: chosen })
=> null
```

Settings state is never implicit conversation context, even if a link supplied it.

```ts
systemCardAttentionRef({ ...browse, path: SYSTEM_CARD_PATHS.settings, params: { password: "sentinel" }, viewState: { password: "sentinel" } })
=> _config/interface/settings.card
```

## Shell providers do not receive the leaf route splat

Settings opened from the profile menu must be derived from its pathname even
when the ancestor match's params have no `_splat`. URL escaping matches the
leaf router's decoded parameter, including spaces in ordinary card names.

```ts
workspaceRouteTarget({ pathname: "/test/views/_config/interface/settings.card", searchStr: "", search: {} })?.path
=> _config/interface/settings.card

workspaceRouteTarget({ pathname: "/test/views/_content/Meeting%20Notes.memo.card", searchStr: "?view=Source", search: {} })?.path
=> _content/Meeting Notes.memo.card

JSON.stringify(withoutShellParams({ path: "_content/notes.memo.card", viewer: "Source", params: { nativeComposer: "1", session: "private-session", contextDir: "_content/work", zoom: "2" }, viewState: { page: 3 } }))
=> {"path":"_content/notes.memo.card","viewer":"Source","params":{"zoom":"2"},"viewState":{"page":3}}
```

## Projection consumes canonical renderer parameters exactly once

A Browse card's directory and detail state is serialized inside `card` after
entry. The original renderer search is not copied alongside it on `/chat`.
Opaque Settings parameters likewise never become chat query parameters.

```ts
const projected = workspaceProjectionSearch({ pathname: "/test/views/" + browse.path, search: { viewState: { directory: "_content/old" }, dir: "_content/old", view: "Browse", session: "chosen", nativeComposer: "1" }, target: browse });
Object.keys(projected).sort().join(",")
=> card,nativeComposer,session

workspaceRouteTarget({ pathname: "/test/chat", searchStr: "", search: projected })?.viewState?.detail
=> {
  "path": "_content/recipes/a.memo.card",
  "viewer": "Source",
  "params": {},
  "viewState": null
}

JSON.stringify(workspaceProjectionSearch({ pathname: "/test/views/" + SYSTEM_CARD_PATHS.settings, search: { opaque: "sentinel", viewState: { unrelated: "sentinel" }, nativeComposer: "1", capture: "1" }, target: { path: SYSTEM_CARD_PATHS.settings, viewer: null, params: {}, viewState: null } }))
=> {"nativeComposer":"1","capture":"1","card":"_config/interface/settings.card"}

JSON.stringify(workspaceProjectionSearch({ pathname: "/test/chat", search: { session: "chosen", capture: "1", companion: "old" }, target: null }))
=> {"session":"chosen","capture":"1"}
```
