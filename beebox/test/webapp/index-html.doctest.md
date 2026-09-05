# Stamping a box's identity into the served document

`stampBoxIdentity` (`webapp/index-html.ts`) rewrites the built `index.html` so
a tab — and an installed app — is identifiable before React boots. The box
server does this on the read it was already performing per request.

```ts setup
import { stampBoxIdentity, documentBoxSlug } from "../../src/webapp/index-html.js";

const DOC = [
  "<!doctype html>",
  "<html><head>",
  '<meta name="theme-color" content="#9B6BA6" />',
  '<link rel="manifest" href="/manifest.webmanifest" />',
  "<title>Bee Box</title>",
  '<link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192.png" />',
  '<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />',
  "</head><body><div id=\"root\"></div></body></html>",
].join("\n");

const stamp = (identity, slug = "kitchen") => stampBoxIdentity(DOC, { slug, ...identity });
const titleOf = (html: string) => /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? "(none)";
const iconsOf = (html: string) => [...html.matchAll(/<link rel="icon"[^>]*href="([^"]*)"/g)].map((m) => m[1]);
const tagOf = (html: string, rel: string) =>
  new RegExp(`<link rel="${rel}"[^>]*>`).exec(html)?.[0] ?? "(none)";
```

## The title is the box name alone

The document is served before a route is resolved, so the page half genuinely
isn't known yet — the client composes `<page> — <box>` once it boots.

```ts
titleOf(stamp({ name: "Kitchen", symbol: "", symbolSrc: null }))
=> Kitchen
```

## A text symbol gets both an SVG and a PNG icon

The colour `data:` SVG is what a browser draws when it can. Safari gained
SVG-favicon support only in version 26, so the box's own PNG is declared
alongside it and `type=` lets each browser take the one it renders.

```ts
const stamped = stamp({ name: "Kitchen", symbol: "🍳", symbolSrc: null });
const icons = iconsOf(stamped);
[icons[0].startsWith("data:image/svg+xml,"), decodeURIComponent(icons[0]).includes("🍳"), icons[1]].join(" | ")
=> true | true | /kitchen/icon-192.png
```

## An image symbol uses the PNG route alone

`symbol: { src }` has no `data:` form, so there is one icon link and it points
at the box's own route, which resizes the box's file.

```ts
JSON.stringify(iconsOf(stamp({ name: "Kitchen", symbol: "", symbolSrc: "art/pan.png" })))
=> ["/kitchen/icon-192.png"]
```

## The installed-app tags are pointed at the box too

These were previously left alone, which is why every box's installed app and
every notification wore the same generic mark and the name "Bee Box". The
manifest link carries `crossorigin="use-credentials"` because a manifest is
otherwise fetched with no cookies, and every route under `/<slug>` is behind
the box's auth wall.

```ts
const stamped = stamp({ name: "Kitchen", symbol: "🍳", symbolSrc: null });
[tagOf(stamped, "apple-touch-icon"), tagOf(stamped, "manifest")].join("\n")
=>
<link rel="apple-touch-icon" href="/kitchen/icon-180.png" />
<link rel="manifest" href="/kitchen/manifest.webmanifest" crossorigin="use-credentials" />
```

## Names are escaped

A box's name comes from a card the boxholder edits, and lands in HTML.

```ts
titleOf(stamp({ name: "Fish & <chips>", symbol: "", symbolSrc: null }))
=> Fish &amp; &lt;chips&gt;
```

An emoji field carrying markup can't break out of the SVG either — the icon
stays a well-formed data URI with the markup escaped inside it.

```ts
const nasty = iconsOf(stamp({ name: "x", symbol: '"><script>', symbolSrc: null }))[0];
[nasty.startsWith("data:image/svg+xml,"), nasty.includes("<script>"), decodeURIComponent(nasty).includes("&lt;script&gt;")].join(" ")
=> true false true
```

A slug is a path segment in three hrefs, so it is encoded rather than trusted.

```ts
iconsOf(stamp({ name: "x", symbol: "", symbolSrc: null }, 'a"b'))[0]
=> /a%22b/icon-192.png
```

## Which box a document request is for

The slug is the URL's first segment in every layout that serves the SPA: a
standalone `bbx serve` mounts each box at `/<slug>`, and a hub child is proxied
the same `/<slug>/...`.

```ts
const served = ["kitchen", "workshop"];
JSON.stringify([
  documentBoxSlug("/kitchen/settings", served),
  documentBoxSlug("/kitchen", served),
  documentBoxSlug("/kitchen/browse/_content/recipes?view=sheet", served),
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
