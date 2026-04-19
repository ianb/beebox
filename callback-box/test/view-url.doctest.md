# view-url helpers

Parse, classify, and resolve the `view:`-style URLs that markdown links use to reference files inside the box.

```ts setup
import {
  parseViewUrl,
  serializeViewUrl,
  resolveRelativePath,
  classifyMarkdownHref,
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
