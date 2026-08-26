# Stamping a box's identity into the served document

`stampBoxIdentity` (`webapp/index-html.ts`) rewrites the built `index.html`
so a tab is identifiable before React boots. The box server does this on the
read it was already performing per request.

```ts setup
import { stampBoxIdentity, documentBoxSlug } from "../../src/webapp/index-html.js";

const DOC = [
  "<!doctype html>",
  "<html><head>",
  '<meta name="theme-color" content="#9B6BA6" />',
  "<title>Callback Box</title>",
  '<link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192.png" />',
  '<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />',
  "</head><body><div id=\"root\"></div></body></html>",
].join("\n");

const titleOf = (html: string) => /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? "(none)";
const iconOf = (html: string) => /<link rel="icon"[^>]*href="([^"]*)"/.exec(html)?.[1] ?? "(none)";
```

## The title is the box name alone

The document is served before a route is resolved, so the page half genuinely
isn't known yet — the client composes `<page> — <box>` once it boots.

```ts
titleOf(stampBoxIdentity(DOC, { name: "Kitchen", symbol: "", symbolSrc: null }))
=> Kitchen
```

## A text symbol becomes a self-contained icon

No file to serve and no box-scoped URL to spell — which matters because this
runs in the one place that cannot reliably build a box-relative path.

```ts
const stamped = stampBoxIdentity(DOC, { name: "Kitchen", symbol: "🍳", symbolSrc: null });
iconOf(stamped).startsWith("data:image/svg+xml,") && decodeURIComponent(iconOf(stamped)).includes("🍳")
=> true
```

The apple-touch-icon link is left alone — only the `rel="icon"` link is the
tab's.

```ts continue
stamped.includes('<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />')
=> true
```

## An image symbol leaves the built icon in place

`symbol: { src }` is a box-relative path, and the served document is the one
place with no reliable way to make it absolute. The client swaps it in after
boot, where the box base is known.

```ts
iconOf(stampBoxIdentity(DOC, { name: "Kitchen", symbol: "", symbolSrc: "art/pan.png" }))
=> /icons/icon-192.png
```

## Names are escaped

A box's name comes from a card the boxholder edits, and lands in HTML.

```ts
titleOf(stampBoxIdentity(DOC, { name: "Fish & <chips>", symbol: "", symbolSrc: null }))
=> Fish &amp; &lt;chips&gt;
```

An emoji field carrying markup can't break out of the SVG either — the icon
stays a well-formed data URI with the markup escaped inside it.

```ts
const nasty = iconOf(stampBoxIdentity(DOC, { name: "x", symbol: '"><script>', symbolSrc: null }));
[nasty.startsWith("data:image/svg+xml,"), nasty.includes("<script>"), decodeURIComponent(nasty).includes("&lt;script&gt;")].join(" ")
=> true false true
```

## Which box a document request is for

The slug is the URL's first segment in every layout that serves the SPA: a
standalone `cb serve` mounts each box at `/<slug>`, and a hub child is proxied
the same `/<slug>/...`.

```ts
const served = ["kitchen", "workshop"];
JSON.stringify([
  documentBoxSlug("/kitchen/settings", served),
  documentBoxSlug("/kitchen", served),
  documentBoxSlug("/kitchen/browse/store/recipes?view=sheet", served),
])
=> ["kitchen","kitchen","kitchen"]
```

A segment is a box exactly when a box answers to it — so the root listing,
`/auth/*`, Vite's `/@…` requests, and a slug this server doesn't serve all get
the built document unchanged, with no list of non-box paths to keep in sync.

```ts continue
JSON.stringify([
  documentBoxSlug("/", served),
  documentBoxSlug("/auth/login?returnTo=%2Fkitchen", served),
  documentBoxSlug("/@vite/client", served),
  documentBoxSlug("/garage/settings", served),
])
=> [null,null,null,null]
```

A query string carrying slashes doesn't move the segment boundary.

```ts continue
documentBoxSlug("/kitchen?returnTo=/other/box", served)
=> kitchen
```
