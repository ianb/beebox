# view-url helpers

Parse, classify, and resolve the box-path URLs that markdown links/images use to reference files inside the box. Markdown authors plain paths (`store/x.card`, `/store/x.card?view=source`); the retired `view:` scheme survives only as an internal serialization marker (companion-pane URL persistence), which `parseViewUrl` still tolerates.

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
} from "../../../src/frontend/src/lib/view-url.js";
```

## parseViewUrl

Pulls a file path, viewer override (`?view=`), and other params out of a serialized target (the `view:` prefix is optional and tolerated for internal callers). There is no `zoom` flag — a plain link opening the companion pane replaced it.

```ts
JSON.stringify(parseViewUrl("view:store/docs/report.md"))
=> {"path":"store/docs/report.md","viewer":null,"params":{}}

JSON.stringify(parseViewUrl("store/docs/report.md?view=source&k=v"))
=> {"path":"store/docs/report.md","viewer":"source","params":{"k":"v"}}
```

A leading `/` is stripped — `ViewTarget.path` is box-root-relative, and consumers compare it for exact equality against the file watcher's relative paths (which have no leading slash). Card refs are conventionally written `/store/…`, so the slash is normalized away here:

```ts
JSON.stringify(parseViewUrl("view:/store/archive/Foo.memo.card"))
=> {"path":"store/archive/Foo.memo.card","viewer":null,"params":{}}
```

`serializeViewUrl` is the round-trip inverse (without the `view:` prefix):

```ts
serializeViewUrl({ path: "a/b.md", viewer: "source", params: { k: "v" } })
=> a/b.md?view=source&k=v
```

## resolveRelativePath

Resolves `href` values from a document at `basePath`, just like a filesystem:

```ts
resolveRelativePath("store/docs/tax/2023/return-status.md", "1040.pdf")
=> store/docs/tax/2023/1040.pdf

resolveRelativePath("store/docs/tax/2023/return-status.md", "../2022/summary.md")
=> store/docs/tax/2022/summary.md

resolveRelativePath("store/docs/tax/2023/return-status.md", "./notes.md")
=> store/docs/tax/2023/notes.md
```

Leading `/` is stripped and treated as box-root-relative:

```ts
resolveRelativePath("store/docs/a.md", "/other/file.md")
=> other/file.md
```

When `basePath` is missing, the relative path is already box-root-relative:

```ts
resolveRelativePath(undefined, "notes.md")
=> notes.md
```

## resolveContentTarget

Turns a markdown link/image href into a `ViewTarget`, splitting the `?view=`/params query off **before** resolving so a leading slash stays meaningful (absolute vs document-relative). This is what the renderers hand to `onNavigate`.

A relative path resolves against the document's dir; the query becomes viewer + params:

```ts
JSON.stringify(resolveContentTarget("store/docs/report.md", "chart.figure.card?size=300"))
=> {"path":"store/docs/chart.figure.card","viewer":null,"params":{"size":"300"}}
```

A leading `/` is box-root-absolute and ignores `basePath` — and `?view=` selects a card-attached viewer:

```ts
JSON.stringify(resolveContentTarget("store/docs/report.md", "/store/x.bill.card?view=ledger"))
=> {"path":"store/x.bill.card","viewer":"ledger","params":{}}
```

`basePath` is treated like a containing *file* (its last segment is stripped). A
directory base (e.g. a chat's cwd) must carry a trailing slash so the strip is a
no-op and the relative path resolves *inside* it, not its parent:

```ts
JSON.stringify([
  resolveContentTarget("store/foo/x.md", "bar.card").path,
  resolveContentTarget("store/foo/", "bar.card").path,
])
=> ["store/foo/bar.card","store/foo/bar.card"]
```

## classifyMarkdownHref

Splits an href into the cases the Markdown renderer cares about. A plain relative/absolute path is a box reference; anything with a scheme or anchor is external; the retired `view:` scheme is `legacy-view` so renderers can draw a visibly-broken marker:

```ts
JSON.stringify(classifyMarkdownHref("view:store/a.md"))
=> {"kind":"legacy-view","raw":"view:store/a.md"}

JSON.stringify(classifyMarkdownHref("notes.md"))
=> {"kind":"relative","path":"notes.md"}

JSON.stringify(classifyMarkdownHref("/store/a.card?view=ledger"))
=> {"kind":"relative","path":"/store/a.card?view=ledger"}

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

## isExternalUrl

True for anything with a URL scheme or a protocol-relative `//host` — used to tell an image/external link from an in-box embed path:

```ts
JSON.stringify([
  isExternalUrl("https://example.com/x.png"),
  isExternalUrl("//cdn.example.com/y.jpg"),
  isExternalUrl("store/x.figure.card"),
  isExternalUrl("/store/x.card"),
])
=> [true,true,false,false]
```

## resolveImageSrc

Rewrites a markdown image `src` into a URL that doesn't depend on the page URL — so an image written into `dossiers/annika.md` renders the same whether it's opened in chat or browsed at a deep URL.

A leading `/` means box-root-relative:

```ts
resolveImageSrc("/store/images/front.png", { boxSlug: "test1", basePath: "store/dossiers/annika.md" })
=> /test1/api/files/store/images/front.png
```

A bare path is document-relative — resolved against `basePath`:

```ts
resolveImageSrc("images/front.png", { boxSlug: "test1", basePath: "store/dossiers/annika.md" })
=> /test1/api/files/store/dossiers/images/front.png

resolveImageSrc("../shared/logo.png", { boxSlug: "test1", basePath: "store/dossiers/annika.md" })
=> /test1/api/files/store/shared/logo.png
```

The legacy `api/files/<path>` form is accepted as a hint that the path is already box-root-relative:

```ts
resolveImageSrc("api/files/store/images/front.png", { boxSlug: "test1", basePath: "store/dossiers/annika.md" })
=> /test1/api/files/store/images/front.png
```

External URLs pass through untouched:

```ts
resolveImageSrc("https://example.com/x.png", { boxSlug: "test1", basePath: "store/a.md" })
=> https://example.com/x.png

resolveImageSrc("data:image/png;base64,AAAA", { boxSlug: "test1", basePath: "store/a.md" })
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
externalImageProxyUrl("/test1/api/files/store/a.png", "test1")
=> undefined

externalImageProxyUrl("data:image/png;base64,AAAA", "test1")
=> undefined
```
