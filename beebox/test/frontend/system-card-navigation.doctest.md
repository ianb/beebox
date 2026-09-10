# Canonical card navigation

A routed card retains its query and nested view state when adopted into the
workspace. Shell flags do not become instrument parameters. Canonical tools
resolve their semantic place on cold entry, while warm selection wins.

```ts setup
import { cardChatSearch, legacyAdminRedirect, legacyCaptureRedirect, legacyCardRedirect, legacySystemCardRedirect, workspaceRouteTarget, systemCardEntryContext, systemCardAttentionRef, withoutShellParams, workspaceProjectionSearch } from "../../src/frontend/src/lib/system-card-navigation.js";
import { routeConversationRequest } from "../../src/frontend/src/components/chat/everywhere/conversation-intent.js";
import { SYSTEM_CARD_PATHS } from "../../src/shared/system-card-paths.js";
import { serializeViewUrl } from "../../src/frontend/src/lib/view-url.js";
const browse = { path: SYSTEM_CARD_PATHS.browse, viewer: null, params: {}, viewState: { directory: "_content/recipes", detail: { path: "_content/recipes/a.memo.card", viewer: "Source", params: {}, viewState: null } } };
```

## Legacy card entry preserves the complete target and shell state

The compatibility route changes only the pathname. Renderer choice, opaque
renderer parameters, authored view state, shell parameters, and router history
state all continue into the canonical workspace entry.

```ts
const legacyState = { bbxWorkspace: { revision: 7 }, inherited: "sentinel" };
JSON.stringify(legacyCardRedirect({ boxSlug: "test", cardPath: "_content/Meeting Notes.memo.card", search: { view: "Source", page: "2", viewState: { cursor: 4 }, nativeComposer: "1", session: "chosen" }, state: legacyState }))
=> {"to":"/test/views/_content/Meeting Notes.memo.card","search":{"view":"Source","page":"2","viewState":{"cursor":4},"nativeComposer":"1","session":"chosen"},"state":{"bbxWorkspace":{"revision":7},"inherited":"sentinel"},"replace":true}
```

Questions, Landmarks, and the Chats alias use the same pure redirect adapter.
It preserves only shell search and router history state; renderer state does not
leak out of the canonical card target.

```ts
const redirectState = { bbxWorkspace: { revision: 7 }, inherited: "sentinel" };
JSON.stringify([
  legacySystemCardRedirect({ boxSlug: "test", type: "questions", search: { session: "chosen", nativeComposer: "1", viewState: { leak: true } }, state: redirectState }),
  legacySystemCardRedirect({ boxSlug: "test", type: "landmarks", search: { contextDir: "garden", opaque: "drop" }, state: redirectState }),
  legacySystemCardRedirect({ boxSlug: "test", type: "landmarks", search: { capture: "1" }, state: redirectState }),
])
=> [{"to":"/test/views/_config/interface/questions.card","search":{"nativeComposer":"1","session":"chosen"},"state":{"bbxWorkspace":{"revision":7},"inherited":"sentinel"},"replace":true},{"to":"/test/views/_config/interface/landmarks.card","search":{"contextDir":"garden"},"state":{"bbxWorkspace":{"revision":7},"inherited":"sentinel"},"replace":true},{"to":"/test/views/_config/interface/landmarks.card","search":{"capture":"1"},"state":{"bbxWorkspace":{"revision":7},"inherited":"sentinel"},"replace":true}]
```

Admin projects only validated one-shot arrival fields into card state. Capture
keeps shell and history state while forcing capture intent.

```ts
const redirectState = { bbxWorkspace: { revision: 7 }, inherited: "sentinel" };
JSON.stringify(legacyAdminRedirect({ boxSlug: "test", search: { google: "error", message: "Denied", reconnect: "google", code: "secret", session: "chosen", nativeComposer: "1" }, state: redirectState }))
=> {"to":"/test/views/_config/interface/admin.card","search":{"nativeComposer":"1","session":"chosen","viewState":{"google":"error","message":"Denied","reconnect":"google"}},"state":{"bbxWorkspace":{"revision":7},"inherited":"sentinel"},"replace":true}

JSON.stringify(legacyCaptureRedirect({ boxSlug: "test", search: { session: "chosen", nativeComposer: "1", capture: "0", opaque: "drop" }, state: redirectState }))
=> {"to":"/test/chat","search":{"nativeComposer":"1","session":"chosen","capture":"1"},"state":{"bbxWorkspace":{"revision":7},"inherited":"sentinel"},"replace":true}
```

## Chat-about actions preserve the selected card target

Only the explicit action supplies a recipient. Recent chat resumes the resolved
session when one exists; New always requests a fresh conversation in the
resolved landmark directory. Both carry renderer parameters and view state in
the serialized card target.

```ts
const selectedCard = { path: "_content/Meeting Notes.memo.card", viewer: "Source", params: { page: "2" }, viewState: { cursor: 4 } };
JSON.stringify(cardChatSearch({ mode: "recent", target: selectedCard, contextDir: "_content", sessionId: "session-7", nativeComposer: "1" }))
=> {"session":"session-7","card":"_content/Meeting Notes.memo.card?view=Source&viewState=%7B%22cursor%22%3A4%7D&page=2","nativeComposer":"1"}

JSON.stringify(cardChatSearch({ mode: "recent", target: selectedCard, contextDir: "_content", sessionId: null }))
=> {"session":"new","contextDir":"_content","card":"_content/Meeting Notes.memo.card?view=Source&viewState=%7B%22cursor%22%3A4%7D&page=2"}

JSON.stringify(cardChatSearch({ mode: "new", target: selectedCard, contextDir: "_content", sessionId: "session-7" }))
=> {"session":"new","contextDir":"_content","card":"_content/Meeting Notes.memo.card?view=Source&viewState=%7B%22cursor%22%3A4%7D&page=2"}
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

JSON.stringify([SYSTEM_CARD_PATHS.dashboard, SYSTEM_CARD_PATHS.settings, SYSTEM_CARD_PATHS.questions, SYSTEM_CARD_PATHS.landmarks, SYSTEM_CARD_PATHS.history, SYSTEM_CARD_PATHS.inventory, SYSTEM_CARD_PATHS.admin].map((path) => systemCardEntryContext({ ...browse, path })))
=> [{"cardPath":null,"browseDir":""},{"cardPath":null,"browseDir":""},{"cardPath":null,"browseDir":""},{"cardPath":null,"browseDir":""},{"cardPath":null,"browseDir":""},{"cardPath":null,"browseDir":""},{"cardPath":null,"browseDir":""}]
```

```ts
const input = { first: true, chatPage: false, search: {}, selection: { kind: "resolving", contextDir: "", requestId: "cold" }, remembered: null, ...systemCardEntryContext(browse) };
JSON.stringify(routeConversationRequest(input))
=> {"kind":"landmark","contextDir":"_content/recipes"}

const chosen = { kind: "ready", target: { kind: "session", sessionId: "chosen", contextDir: "_content/work" }, label: "Work" };
routeConversationRequest({ ...input, first: false, selection: chosen })
=> null

JSON.stringify(routeConversationRequest({ ...input, first: true, selection: { kind: "resolving", contextDir: "", requestId: "questions-cold" }, ...systemCardEntryContext({ ...browse, path: SYSTEM_CARD_PATHS.questions }) }))
=> {"kind":"landmark","contextDir":""}

routeConversationRequest({ ...input, first: false, selection: chosen, ...systemCardEntryContext({ ...browse, path: SYSTEM_CARD_PATHS.landmarks }) })
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
