# PdfFrame — a PDF stays reachable even where it can't be displayed

`PdfFrame` (`components/PdfFrame.tsx`) is the one way a PDF is shown: the `.pdf`
file renderer and the "Original" view of an extracted document card both go
through it.

It renders an `<object>` rather than an `<iframe>` on purpose. When a browser
can't display a PDF inline — iOS/WKWebView shows a blank rectangle for an
embedded PDF — it renders the element's *children* instead, so the fallback
below repeats the Open/Download affordances rather than leaving a dead grey box.
Those children are always in the markup; only the browser decides whether to
show them.

```ts setup
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PdfFrame } from "../../../src/frontend/src/components/PdfFrame.js";
import "../../../src/frontend/src/renderers/pdf.js";
import "../../../src/frontend/src/renderers/binary.js";
import { isWorkspacePdf } from "../../../src/frontend/src/components/chat/workspace/pdf-pane-view.js";

globalThis.React = React;

function render(props) {
  return renderToStaticMarkup(React.createElement(PdfFrame, props));
}

const base = { src: "/test/api/files/inbox/Handbook.attach/source.pdf", title: "Handbook", downloadName: "source.pdf" };
```

## The frame, the fallback, and the download link

```ts
const html = render({ ...base, mode: "page" });

html.includes('<object data="/test/api/files/inbox/Handbook.attach/source.pdf" type="application/pdf"')
=> true

// The fallback prose is inside the object element, where the browser shows it.
html.includes("This PDF can’t be displayed here.")
=> true

// A real download attribute carrying the suggested filename — not a plain link
// the browser would navigate to.
html.includes('download="source.pdf"')
=> true

// Open-in-new-tab is a labelled icon link (icon-only controls need a name).
html.includes('aria-label="Open source.pdf in a new tab"')
=> true
```

Both affordances appear twice — once in the toolbar, once in the fallback — so a
viewer who only ever sees the fallback still gets them:

```ts
const html = render({ ...base, mode: "page" });
html.split('download="source.pdf"').length - 1
=> 2
```

## Height comes from the surface

`page` owns the viewport, so it takes a viewport-relative height. `chat` must
fit inside FileView's `max-h-96` wrapper. `companion` and `embed` fill whatever
their container gives them — a column flex whose object takes the leftover
space, which is why FileView's companion wrapper is itself a column.

```ts
render({ ...base, mode: "page" }).includes("h-[80vh]")
=> true

render({ ...base, mode: "chat" }).includes("h-80")
=> true

// The companion frame claims the remainder of a column that has a height —
// and falls back to a viewport floor when its ancestors are content-sized,
// which is what the browse detail panel and the chat sidebar actually give it.
const companion = render({ ...base, mode: "companion" });
[companion.includes("h-full min-h-0"), companion.includes("flex-1 min-h-[70vh]"), companion.includes("h-[80vh]")].join(" ")
=> true true false
```

An omitted `mode` behaves like `page`, the surface a bare PDF path lands on:

```ts
render(base) === render({ ...base, mode: "page" })
=> true
```

## Workspace supplies the file actions

The tab already names the file and its menu supplies Open/Download. The frame
uses the pane's available height without adding another toolbar or a viewport
height floor. Unsupported viewers still receive the fallback links.

```ts
const pane = render({ ...base, mode: "companion", workspacePdf: true });
const beforeObject = pane.split("<object")[0];
beforeObject.includes("Handbook")
=> false

pane.split('download="source.pdf"').length - 1
=> 1

pane.includes("min-h-[70vh]")
=> false

pane.includes("w-full h-full flex-1 min-h-0")
=> true

pane.includes("This PDF can’t be displayed here.") && pane.includes('aria-label="Open source.pdf in a new tab"')
=> true
```

Old view names fall back to the preferred renderer, just as in FileView. An
explicit Download view retains its selector so the PDF remains reachable.

```ts
JSON.stringify([null, "PDF", "pdf", "retired-view", "Download"].map((viewer) => isWorkspacePdf("_content/guide.pdf", viewer)))
=> [true,true,true,true,false]

isWorkspacePdf("_content/guide.pdf.card", null)
=> false
```
