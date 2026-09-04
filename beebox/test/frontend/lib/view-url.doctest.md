# view-url helpers

Parse, classify, and resolve the box-path URLs that markdown links/images use to reference files inside the box. Markdown authors plain paths (`_content/x.card`, `/_content/x.card?view=source`); the retired `view:` scheme survives only as an internal serialization marker (companion-pane URL persistence), which `parseViewUrl` still tolerates.

```ts setup
import {
  parseViewUrl,
  serializeViewUrl,
  resolveRelativePath,
  resolveContentTarget,
  classifyMarkdownHref,
  isExternalUrl,
  resolveImageSrc,
  externalImageProxyUrl,
  apiFileUrl,
  apiImageUrl,
  validateViewState,
} from "../../../src/frontend/src/lib/view-url.js";
import { apiRawFileUrl } from "../../../src/frontend/src/api-core.js";
import { decideViewHistoryUpdate } from "../../../src/shared/view-state.js";

class CustomState { value = "x"; }
```

## parseViewUrl

Pulls a file path, viewer override (`?view=`), and other params out of a serialized target (the `view:` prefix is optional and tolerated for internal callers). There is no `zoom` flag — a plain link opening the companion pane replaced it.

```ts
JSON.stringify(parseViewUrl("view:_content/docs/report.md"))
=> {"path":"_content/docs/report.md","viewer":null,"params":{},"viewState":null}

JSON.stringify(parseViewUrl("_content/docs/report.md?view=source&k=v"))
=> {"path":"_content/docs/report.md","viewer":"source","params":{"k":"v"},"viewState":null}

JSON.stringify(parseViewUrl('_content/docs/report.md?k=v&viewState=%7B%22page%22%3A%22gallery%22%2C%22index%22%3A2%7D&view=source'))
=> {"path":"_content/docs/report.md","viewer":"source","params":{"k":"v"},"viewState":{"page":"gallery","index":2}}
```

A leading `/` is stripped — `ViewTarget.path` is box-root-relative, and consumers compare it for exact equality against the file watcher's relative paths (which have no leading slash). Card refs are conventionally written `/_content/…`, so the slash is normalized away here:

```ts
JSON.stringify(parseViewUrl("view:/_bookkeeping/archive/Foo.memo.card"))
=> {"path":"_bookkeeping/archive/Foo.memo.card","viewer":null,"params":{},"viewState":null}
```

`serializeViewUrl` is the round-trip inverse (without the `view:` prefix):

```ts
serializeViewUrl({ path: "a/b.md", viewer: "source", params: { k: "v" }, viewState: { page: "gallery" } })
=> a/b.md?view=source&viewState=%7B%22page%22%3A%22gallery%22%7D&k=v

serializeViewUrl({ path: "a/b.md", viewer: null, params: {}, viewState: {} })
=> a/b.md

validateViewState({ page: "gallery", filters: ["open", null], count: 2 })
=> true

validateViewState({ count: Number.NaN })
=> false

validateViewState({ when: new Date("2026-01-01") })
=> false

validateViewState({ filters: new Map([["status", "open"]]) })
=> false

validateViewState({ custom: new CustomState() })
=> false

const cyclic: Record<string, unknown> = {};
cyclic.self = cyclic;
validateViewState(cyclic)
=> false

// Deliberately violate the static contract to exercise the runtime boundary
// protecting authored JavaScript callers.
serializeViewUrl({ path: "a/b.md", viewer: null, params: {}, viewState: cyclic as never })
=> throws InvalidViewStateError: Authored view state must be a JSON-safe object

serializeViewUrl({ path: "a/b.md", viewer: "source", params: { k: "v" }, viewState: null })
=> a/b.md?view=source&k=v

decideViewHistoryUpdate({ state: { page: "gallery" }, requested: "push", canPush: true })
=> push

decideViewHistoryUpdate({ state: { page: "gallery" }, requested: "push", canPush: false })
=> replace

decideViewHistoryUpdate({ state: { count: Number.POSITIVE_INFINITY }, requested: "replace", canPush: true })
=> rejected
```

## resolveRelativePath

Resolves `href` values from a document at `basePath`, just like a filesystem:

```ts
resolveRelativePath("_content/docs/tax/2023/return-status.md", "1040.pdf")
=> _content/docs/tax/2023/1040.pdf

resolveRelativePath("_content/docs/tax/2023/return-status.md", "../2022/summary.md")
=> _content/docs/tax/2022/summary.md

resolveRelativePath("_content/docs/tax/2023/return-status.md", "./notes.md")
=> _content/docs/tax/2023/notes.md
```

Leading `/` is stripped and treated as box-root-relative:

```ts
resolveRelativePath("_content/docs/a.md", "/other/file.md")
=> other/file.md
```

When `basePath` is missing, the relative path is already box-root-relative:

```ts
resolveRelativePath(undefined, "notes.md")
=> notes.md
```

The rules themselves live in `src/shared/ref-path.ts` (shared with the backend's
ref checking), including its fail-closed containment: a path that climbs above
the box root is `null`, never clamped back to the root. Callers degrade visibly
— a link renders as a broken marker, an image gets an empty (broken) src.

```ts
JSON.stringify(resolveRelativePath("_content/docs/a.md", "../../../etc/passwd"))
=> null

JSON.stringify(resolveContentTarget("_content/docs/report.md", "../../../etc/passwd?view=source"))
=> null
```

## resolveContentTarget

Turns a markdown link/image href into a `ViewTarget`, splitting the `?view=`/params query off **before** resolving so a leading slash stays meaningful (absolute vs document-relative). This is what the renderers hand to `onNavigate`.

A relative path resolves against the document's dir; the query becomes viewer + params:

```ts
JSON.stringify(resolveContentTarget("_content/docs/report.md", "chart.figure.card?size=300"))
=> {"path":"_content/docs/chart.figure.card","viewer":null,"params":{"size":"300"},"viewState":null}
```

A leading `/` is box-root-absolute and ignores `basePath` — and `?view=` selects a card-attached viewer:

```ts
JSON.stringify(resolveContentTarget("_content/docs/report.md", "/_content/x.bill.card?view=ledger"))
=> {"path":"_content/x.bill.card","viewer":"ledger","params":{},"viewState":null}
```

`basePath` is treated like a containing *file* (its last segment is stripped). A
directory base must carry a trailing slash so the strip is a no-op and the
relative path resolves *inside* it, not its parent:

```ts
JSON.stringify([
  resolveContentTarget("_content/foo/x.md", "bar.card").path,
  resolveContentTarget("_content/foo/", "bar.card").path,
])
=> ["_content/foo/bar.card","_content/foo/bar.card"]
```

### Chat messages pass no base

Chat message markdown (`chat/markdown-rendering.tsx`) renders with
`basePath: undefined` for links, embeds, and images alike — a chat has no
"current document," and a directory-bound chat's context directory is the
agent's *working directory* for its file tools, not a link base. So in a chat
bound to `notes`, a bare `sibling.card` link and a bare `Foo.doc.card` embed
both name the box-root file, identically to the leading-`/` form (this is the
resolution seam; the wiring itself is React rendering, which has no doctest
tier):

```ts
JSON.stringify([
  resolveContentTarget(undefined, "sibling.card").path,
  resolveContentTarget(undefined, "/sibling.card").path,
  resolveContentTarget(undefined, "Foo.doc.card").path,
])
=> ["sibling.card","sibling.card","Foo.doc.card"]
```

An image in that same chat message resolves the same way — `basePath: undefined`
sends a bare `photo.png` to the box root, not to `notes/photo.png`:

```ts
resolveImageSrc("photo.png", { boxSlug: "test1", basePath: undefined })
=> /test1/api/image/photo.png
```

## classifyMarkdownHref

Splits an href into the cases the Markdown renderer cares about. A plain relative/absolute path is a box reference; anything with a scheme or anchor is external; the retired `view:` scheme is `legacy-view` so renderers can draw a visibly-broken marker:

```ts
JSON.stringify(classifyMarkdownHref("view:_content/a.md"))
=> {"kind":"legacy-view","raw":"view:_content/a.md"}

JSON.stringify(classifyMarkdownHref("notes.md"))
=> {"kind":"relative","path":"notes.md"}

JSON.stringify(classifyMarkdownHref("/_content/a.card?view=ledger"))
=> {"kind":"relative","path":"/_content/a.card?view=ledger"}

JSON.stringify(classifyMarkdownHref("../sibling.md"))
=> {"kind":"relative","path":"../sibling.md"}

JSON.stringify(classifyMarkdownHref("https://example.com"))
=> {"kind":"external"}

JSON.stringify(classifyMarkdownHref("//cdn.example.com/a.png"))
=> {"kind":"external"}

JSON.stringify(classifyMarkdownHref("mailto:a@b.com"))
=> {"kind":"external"}

JSON.stringify(classifyMarkdownHref("#anchor"))
=> {"kind":"external"}
```

### control: pointers

`control:` points at a control in the running interface rather than at content, so it is recognised before the generic scheme test that would otherwise make it `external`. The address is a `bbx-` DOM id; `action` and `description` ride in a query string parsed with `URLSearchParams`.

```ts
JSON.stringify(classifyMarkdownHref("control:bbx-composer-mic"))
=> {"kind":"control","id":"bbx-composer-mic","action":"point","description":null,"unknownAction":null}

JSON.stringify(classifyMarkdownHref("control:bbx-composer-mic?action=point&description=Tap%20and%20talk"))
=> {"kind":"control","id":"bbx-composer-mic","action":"point","description":"Tap and talk","unknownAction":null}

JSON.stringify(classifyMarkdownHref("control:bbx-composer-add?action=reveal"))
=> {"kind":"control","id":"bbx-composer-add","action":"reveal","description":null,"unknownAction":null}

JSON.stringify(classifyMarkdownHref("control:bbx-composer-input?action=focus"))
=> {"kind":"control","id":"bbx-composer-input","action":"focus","description":null,"unknownAction":null}
```

An action the app does not know degrades to `point` and reports the word it did not understand, so the pointer still works — and says so in its tooltip — rather than the whole link dying over a typo:

```ts
JSON.stringify(classifyMarkdownHref("control:bbx-composer-send?action=jump"))
=> {"kind":"control","id":"bbx-composer-send","action":"point","description":null,"unknownAction":"jump"}
```

An empty id names nothing to point at, so it falls through to the malformed-input path — `external`, exactly like an empty href:

```ts
JSON.stringify([
  classifyMarkdownHref("control:"),
  classifyMarkdownHref("control:?action=reveal"),
])
=> [{"kind":"external"},{"kind":"external"}]
```

An ill-formed id is *not* rejected here. Classification does not touch the document, and whether an address resolves is live state — `resolveControl` rejects a non-`bbx-` id at the point of use and the pointer renders broken with the reason in its tooltip:

```ts
JSON.stringify(classifyMarkdownHref("control:composer-mic"))
=> {"kind":"control","id":"composer-mic","action":"point","description":null,"unknownAction":null}
```

## isExternalUrl

True for anything with a URL scheme or a protocol-relative `//host` — used to tell an image/external link from an in-box embed path:

```ts
JSON.stringify([
  isExternalUrl("https://example.com/x.png"),
  isExternalUrl("//cdn.example.com/y.jpg"),
  isExternalUrl("_content/x.figure.card"),
  isExternalUrl("/_content/x.card"),
])
=> [true,true,false,false]
```

## resolveImageSrc

Rewrites a markdown image `src` into a URL that doesn't depend on the page URL — so an image written into `dossiers/annika.md` renders the same whether it's opened in chat or browsed at a deep URL. Output goes through the canonical `/api/image/` route, which serves a raw image file directly and dereferences an `.image.card` to its attached binary.

A leading `/` means box-root-relative:

```ts
resolveImageSrc("/_content/images/front.png", { boxSlug: "test1", basePath: "_content/dossiers/annika.md" })
=> /test1/api/image/_content/images/front.png
```

A bare path is document-relative — resolved against `basePath`:

```ts
resolveImageSrc("images/front.png", { boxSlug: "test1", basePath: "_content/dossiers/annika.md" })
=> /test1/api/image/_content/dossiers/images/front.png

resolveImageSrc("../shared/logo.png", { boxSlug: "test1", basePath: "_content/dossiers/annika.md" })
=> /test1/api/image/_content/shared/logo.png
```

An `.image.card` embed resolves through the same route — the backend reads `filename.ref` and serves the attached binary, so `![](…/foo.image.card)` renders instead of 404ing on the card file:

```ts
resolveImageSrc("images/aya-intake.image.card", { boxSlug: "test1", basePath: "_content/dossiers/annika.md" })
=> /test1/api/image/_content/dossiers/images/aya-intake.image.card
```

The legacy `api/files/<path>` form (and the `api/image/<path>` form) is accepted as a hint that the path is already box-root-relative; both re-emit through `/api/image/`:

```ts
resolveImageSrc("api/files/_content/images/front.png", { boxSlug: "test1", basePath: "_content/dossiers/annika.md" })
=> /test1/api/image/_content/images/front.png
```

A src that escapes the box root names no servable file, so it resolves to an
empty src — the browser draws its broken-image affordance and the alt text
instead of the clamped-to-root image the old resolver would have shown:

```ts
JSON.stringify(resolveImageSrc("../../../etc/passwd", { boxSlug: "test1", basePath: "_content/dossiers/annika.md" }))
=> ""
```

External URLs pass through untouched:

```ts
resolveImageSrc("https://example.com/x.png", { boxSlug: "test1", basePath: "_content/a.md" })
=> https://example.com/x.png

resolveImageSrc("data:image/png;base64,AAAA", { boxSlug: "test1", basePath: "_content/a.md" })
=> data:image/png;base64,AAAA
```

## externalImageProxyUrl

External http(s) images get a box `/api/proxy-image` fallback URL (the original is URL-encoded into `?url=`). Under the Node test runner Vite's `BASE_URL` is unset, so the base prefix is empty.

```ts
externalImageProxyUrl("https://example.com/x.png", "test1")
=> /test1/api/proxy-image?url=https%3A%2F%2Fexample.com%2Fx.png
```

Protocol-relative URLs are assumed https (the proxy needs an absolute scheme):

```ts
externalImageProxyUrl("//cdn.example.com/y.jpg", "test1")
=> /test1/api/proxy-image?url=https%3A%2F%2Fcdn.example.com%2Fy.jpg
```

In-box and data URLs have no proxy — they return undefined:

```ts
externalImageProxyUrl("/test1/api/files/_content/a.png", "test1")
=> undefined

externalImageProxyUrl("data:image/png;base64,AAAA", "test1")
=> undefined
```

## apiFileUrl / apiImageUrl / apiRawFileUrl

These build the URLs the file/image renderers embed a box-relative path into — `apiFileUrl`/`apiImageUrl` prefix the Vite base and box slug themselves (for an `<img src>` or link target built without an already box-scoped API base in hand); `apiRawFileUrl` takes an already-computed `apiBase` (as returned by `getApiBase()`) and builds the raw `/files/<path>` download/fetch URL. All three route every path segment through `encodePathForUrl`, so a filename containing `#`, `?`, `%`, or a space survives — a URL built by plain concatenation would otherwise get truncated at `#`/`?` or have a literal `%` reinterpreted as a percent-escape.

```ts
apiFileUrl("test1", "_content/notes/plan.md")
=> /test1/api/files/_content/notes/plan.md

apiImageUrl("test1", "_content/photos/front.png")
=> /test1/api/image/_content/photos/front.png

apiRawFileUrl("/test1/api", "_content/notes/plan.md")
=> /test1/api/files/_content/notes/plan.md
```

A path segment with `#`, `?`, `%`, or a space is percent-encoded — but the `/` separators between segments are preserved, not escaped into `%2F`:

```ts
apiFileUrl("test1", "_content/Q&A #3 100% done?.md")
=> /test1/api/files/_content/Q%26A%20%233%20100%25%20done%3F.md

apiImageUrl("test1", "_content/Q&A #3 100% done?.png")
=> /test1/api/image/_content/Q%26A%20%233%20100%25%20done%3F.png

apiRawFileUrl("/test1/api", "_content/Q&A #3 100% done?.md")
=> /test1/api/files/_content/Q%26A%20%233%20100%25%20done%3F.md
```
