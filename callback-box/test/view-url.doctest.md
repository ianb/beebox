# view-url helpers

Parse, classify, and resolve the `view:`-style URLs that markdown links use to reference files inside the box.

```ts setup
import {
  parseViewUrl,
  serializeViewUrl,
  resolveRelativePath,
  classifyMarkdownHref,
  resolveImageSrc,
} from "../src/frontend/src/lib/view-url.js";
```

## parseViewUrl

Pulls a file path, viewer override, zoom flag, and other params out of a `view:` URL:

```
JSON.stringify(parseViewUrl("view:store/docs/report.md"))
=> {"path":"store/docs/report.md","viewer":null,"params":{},"zoom":false}

JSON.stringify(parseViewUrl("view:store/docs/report.md?view=source&zoom"))
=> {"path":"store/docs/report.md","viewer":"source","params":{},"zoom":true}
```

`serializeViewUrl` is the round-trip inverse (without the `view:` prefix):

```
serializeViewUrl({ path: "a/b.md", viewer: "source", params: {}, zoom: true })
=> a/b.md?view=source&zoom
```

## resolveRelativePath

Resolves `href` values from a document at `basePath`, just like a filesystem:

```
resolveRelativePath("store/docs/tax/2023/return-status.md", "1040.pdf")
=> store/docs/tax/2023/1040.pdf

resolveRelativePath("store/docs/tax/2023/return-status.md", "../2022/summary.md")
=> store/docs/tax/2022/summary.md

resolveRelativePath("store/docs/tax/2023/return-status.md", "./notes.md")
=> store/docs/tax/2023/notes.md
```

Leading `/` is stripped and treated as box-root-relative:

```
resolveRelativePath("store/docs/a.md", "/other/file.md")
=> other/file.md
```

When `basePath` is missing, the relative path is already box-root-relative:

```
resolveRelativePath(undefined, "notes.md")
=> notes.md
```

## classifyMarkdownHref

Splits an href into the three cases the Markdown renderer cares about:

```
JSON.stringify(classifyMarkdownHref("view:store/a.md"))
=> {"kind":"view","raw":"view:store/a.md"}

JSON.stringify(classifyMarkdownHref("notes.md"))
=> {"kind":"relative","path":"notes.md"}

JSON.stringify(classifyMarkdownHref("../sibling.md"))
=> {"kind":"relative","path":"../sibling.md"}

JSON.stringify(classifyMarkdownHref("https://example.com"))
=> {"kind":"external"}

JSON.stringify(classifyMarkdownHref("mailto:a@b.com"))
=> {"kind":"external"}

JSON.stringify(classifyMarkdownHref("#anchor"))
=> {"kind":"external"}
```

## resolveImageSrc

Rewrites a markdown image `src` into a URL that doesn't depend on the page URL — so an image written into `dossiers/annika.md` renders the same whether it's opened in chat or browsed at a deep URL.

A leading `/` means box-root-relative:

```
resolveImageSrc("/store/images/front.png", { boxSlug: "test1", basePath: "store/dossiers/annika.md" })
=> /test1/api/files/store/images/front.png
```

A bare path is document-relative — resolved against `basePath`:

```
resolveImageSrc("images/front.png", { boxSlug: "test1", basePath: "store/dossiers/annika.md" })
=> /test1/api/files/store/dossiers/images/front.png

resolveImageSrc("../shared/logo.png", { boxSlug: "test1", basePath: "store/dossiers/annika.md" })
=> /test1/api/files/store/shared/logo.png
```

The legacy `api/files/<path>` form is accepted as a hint that the path is already box-root-relative:

```
resolveImageSrc("api/files/store/images/front.png", { boxSlug: "test1", basePath: "store/dossiers/annika.md" })
=> /test1/api/files/store/images/front.png
```

External URLs pass through untouched:

```
resolveImageSrc("https://example.com/x.png", { boxSlug: "test1", basePath: "store/a.md" })
=> https://example.com/x.png

resolveImageSrc("data:image/png;base64,AAAA", { boxSlug: "test1", basePath: "store/a.md" })
=> data:image/png;base64,AAAA
```
