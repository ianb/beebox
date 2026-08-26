# A box's web-app manifest

`boxManifest` (`webapp/routes/box-identity-assets.ts`) is what the browser
reads when someone installs a box as an app. The fleet shares one built
manifest at the root, so before this every installed box was called
"Callback Box" and opened on the box picker.

```ts setup
import { boxManifest } from "../../src/webapp/routes/box-identity-assets.js";

const identity = { slug: "kitchen", name: "Kitchen", symbol: "🍳", symbolSrc: null };
```

## An installed app is named after the box, and opens into it

`start_url` and `scope` are the box's own root — that is most of why a per-box
manifest is worth serving. `scope` also keeps the installed window from
wandering into another box.

```ts
const m = boxManifest(identity);
[m["name"], m["short_name"], m["start_url"], m["scope"]].join(" | ")
=> Kitchen | Kitchen | /kitchen/ | /kitchen/
```

## Icons point at the box's own render route

PNG rather than the SVG a Chromium browser would also accept: these are the
sizes an OS draws for an installed app, and an install captures them once, so
the format with no support question attached is the right one.

```ts
JSON.stringify(boxManifest(identity)["icons"])
=> [{"src":"/kitchen/icon-192.png","sizes":"192x192","type":"image/png","purpose":"any"},{"src":"/kitchen/icon-512.png","sizes":"512x512","type":"image/png","purpose":"any"}]
```

## A box with no name of its own still installs sensibly

`readBoxIdentity` falls back to the slug, so the manifest is never nameless —
an unnamed installed app is indistinguishable from every other one.

```ts
const bare = boxManifest({ slug: "workshop", name: "workshop", symbol: "", symbolSrc: null });
[bare["name"], bare["start_url"]].join(" | ")
=> workshop | /workshop/
```
