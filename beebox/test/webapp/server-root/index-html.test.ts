// # Stamping a box's identity into the served document
//
// `stampBoxIdentity` (`webapp/index-html.ts`) rewrites the built `index.html` so
// a tab — and an installed app — is identifiable before React boots. The box
// server does this on the read it was already performing per request.

import { test } from "tap";
import "agent-doctest/tap";
import type { BoxIdentity } from "../../../src/core/landmark/box-identity.js";
import { stampBoxIdentity, documentBoxSlug } from "../../../src/webapp/server-root/index-html.js";

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

const stamp = (identity: Omit<BoxIdentity, "slug">, slug?: string) => stampBoxIdentity(DOC, { slug: slug ?? "kitchen", ...identity });
const titleOf = (html: string) => /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? "(none)";
const iconsOf = (html: string) => [...html.matchAll(/<link rel="icon"[^>]*href="([^"]*)"/g)].map((m) => m[1]);
const tagOf = (html: string, rel: string) =>
  [...html.matchAll(/<link [^>]*>/g)].map((m) => m[0]).find((tag) => tag.startsWith(`<link rel="${rel}"`)) ?? "(none)";

// ## The title is the box name alone
//
// The document is served before a route is resolved, so the page half genuinely
// isn't known yet — the client composes `<page> — <box>` once it boots.
void test("The document is served before a route is resolved, so the page half genuinely...", async (t) => {
  // doctest:L35
  t.check(titleOf(stamp({ name: "Kitchen", symbol: null })), "Kitchen");
});

// ## A text symbol gets both an SVG and a PNG icon
//
// The colour `data:` SVG is what a browser draws when it can. Safari gained
// SVG-favicon support only in version 26, so the box's own PNG is declared
// alongside it and `type=` lets each browser take the one it renders.
void test("The colour data: SVG is what a browser draws when it can.", async (t) => {
  // doctest:L46
  const stamped = stamp({ name: "Kitchen", symbol: { glyph: "🍳" } });
  const icons = iconsOf(stamped);
  t.check([icons[0]?.startsWith("data:image/svg+xml,"), decodeURIComponent(icons[0] ?? "").includes("🍳"), icons[1]].join(" | "), "true | true | /kitchen/icon-192.png");
});

// ## An image symbol uses the PNG route alone
//
// `symbol: { src }` has no `data:` form, so there is one icon link and it points
// at the box's own route, which resizes the box's file.
void test("symbol:", async (t) => {
  // doctest:L58
  t.check(iconsOf(stamp({ name: "Kitchen", symbol: { src: "art/pan.png" } })), [
    "/kitchen/icon-192.png",
  ]);
});

// ## The installed-app tags are pointed at the box too
//
// These were previously left alone, which is why every box's installed app and
// every notification wore the same generic mark and the name "Bee Box". The
// manifest link carries `crossorigin="use-credentials"` because a manifest is
// otherwise fetched with no cookies, and every route under `/<slug>` is behind
// the box's auth wall.
void test("These were previously left alone, which is why every box's installed app and...", async (t) => {
  // doctest:L71
  const stamped = stamp({ name: "Kitchen", symbol: { glyph: "🍳" } });
  await t.checkText([tagOf(stamped, "apple-touch-icon"), tagOf(stamped, "manifest")].join("\n"), `<link rel="apple-touch-icon" href="/kitchen/icon-180.png" />
<link rel="manifest" href="/kitchen/manifest.webmanifest" crossorigin="use-credentials" />`);
});

// ## Names are escaped
//
// A box's name comes from a card the boxholder edits, and lands in HTML.
void test("A box's name comes from a card the boxholder edits, and lands in HTML.", async (t) => {
  // doctest:L83
  t.check(titleOf(stamp({ name: "Fish & <chips>", symbol: null })), "Fish &amp; &lt;chips&gt;");
});

// An emoji field carrying markup can't break out of the SVG either — the icon
// stays a well-formed data URI with the markup escaped inside it.
void test("An emoji field carrying markup can't break out of the SVG either — the icon s...", async (t) => {
  // doctest:L91
  const nasty = iconsOf(stamp({ name: "x", symbol: { glyph: '"><script>' } }))[0] ?? "";
  t.check([nasty.startsWith("data:image/svg+xml,"), nasty.includes("<script>"), decodeURIComponent(nasty).includes("&lt;script&gt;")].join(" "), "true false true");
});

// A slug is a path segment in three hrefs, so it is encoded rather than trusted.
void test("A slug is a path segment in three hrefs, so it is encoded rather than trusted.", async (t) => {
  // doctest:L99
  t.check(iconsOf(stamp({ name: "x", symbol: null }, 'a"b'))[0], "/a%22b/icon-192.png");
});

// ## Which box a document request is for
//
// The slug is the URL's first segment in every layout that serves the SPA: a
// standalone `bbx serve` mounts each box at `/<slug>`, and a hub child is proxied
// the same `/<slug>/...`.
void test("The slug is the URL's first segment in every layout that serves the SPA:", async (t) => {
  // doctest:L110
  const served = ["kitchen", "workshop"];
  t.check(
    [
      documentBoxSlug("/kitchen/settings", served),
      documentBoxSlug("/kitchen", served),
      documentBoxSlug("/kitchen/browse/_content/recipes?view=sheet", served),
    ],
    [
    "kitchen",
    "kitchen",
    "kitchen",
  ],
  );

  // A segment is a box exactly when a box answers to it — so the root listing,
  // `/auth/*`, Vite's `/@…` requests, and a slug this server doesn't serve all get
  // the built document unchanged, with no list of non-box paths to keep in sync.

  // doctest:L124
  t.check(
    [
      documentBoxSlug("/", served),
      documentBoxSlug("/auth/login?returnTo=%2Fkitchen", served),
      documentBoxSlug("/@vite/client", served),
      documentBoxSlug("/garage/settings", served),
    ],
    [
    null,
    null,
    null,
    null,
  ],
  );

  // A query string carrying slashes doesn't move the segment boundary.

  // doctest:L136
  t.check(documentBoxSlug("/kitchen?returnTo=/other/box", served), "kitchen");
});
