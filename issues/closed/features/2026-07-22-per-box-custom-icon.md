---
title: "Per-box custom icon (favicon, PWA install icon, tiles, notifications)"
workstream: tab-identity
area: beebox
filed-by: agent
discovered-in: main session — boxholder wants a distinct icon per box
priority: important
resolution: implemented
---

> **Closed 2026-08-26.** Implemented across two rounds (1373c9316 landing this
> workstream's first round; 2734eef66..55313f2cf this second round). The favicon,
> PWA manifest icons, apple-touch-icon, notification icon, and box-selector tiles
> all now show the box's own mark, rendered server-side from the root landmark
> card's `symbol` (`beebox/src/core/box/box-icon.ts`,
> `beebox/src/webapp/routes/box-identity-assets.ts`) rather than a new
> `config/box.json` field as this issue originally proposed — the design
> question resolved by reusing the *existing* per-directory `symbol` on the
> box's own root landmark, so there is no separate box-icon vocabulary.
>
> Two things this issue asked for are deliberately NOT covered:
> - A box whose symbol is an **image** (`symbol: { src }`) falls back to the
>   app's generic icon on the OS-facing surfaces (favicon PNG, manifest,
>   apple-touch, notifications) — those routes sit partly outside the auth
>   wall (see `box-identity-assets.ts`'s header) and must not turn box files
>   into bytes an unauthenticated caller can fetch. An image symbol still
>   renders correctly in-app (tab title's `mark` slot, selector tiles), just
>   not on those external surfaces.
> - The hub's own landing page (`src/hub/box-picker.ts`) still serves an
>   unstamped document — no per-box icon there since it's fleet-wide, not
>   scoped to one box.

Each box should be able to define its own icon, used wherever a box is
visually identified — favicon first, but also the installed-PWA icon, the
box-selector tiles, the apple-touch icon, and notification badges.

> There should definitely be a way to create a custom icon for each box. Used in
> favicon among others.

Today all of these are **static and global** — every box shows the same icon:

- `src/frontend/index.html:12-13` hardcodes `/icons/icon-192.png` and
  `/icons/apple-touch-icon.png`.
- `src/frontend/public/manifest.webmanifest` — one shared PWA manifest.
- `src/frontend/public/sw.js:40-41` — notification `icon`/`badge` are the same
  static file.

So with several boxes (and the family sharing `box.example.com`), you can't tell
them apart in a tab, on a home screen, or in the selector.

## Precedent already in the box: `symbol`

Landmark cards already carry a per-directory icon — `symbol` in
`src/schemas/landmark.ts` — as either an emoji/short text OR an image
(`{ src: images/portrait.webp }`). A **box-level icon should reuse that shape**:
an emoji or a box-relative image path, defined once for the box (e.g. in
`config/box.json` or a small box config card), so the vocabulary is consistent
with how directories already get symbols.

## Where it needs to reach

- **Favicon** — the browser tab. Needs the per-box icon injected where
  `index.html` currently hardcodes it.
- **PWA install identity** — the installed home-screen icon. This is a **dynamic
  per-box manifest**, which the [web-push work explicitly deferred](../../code-quality/2026-07-04-web-push-followup-testing.md)
  ("Per-box PWA install identity — a dynamic per-box manifest so the installed
  icon opens straight to the box"). This issue subsumes that: a per-box icon and
  a per-box manifest are the same feature.
- **apple-touch-icon** — iOS home screen / the native wrapper.
- **Notifications** — `sw.js` icon/badge should be the targeted box's icon (the
  payload already carries the box via `data.url`).
- **Box-selector tiles / hub** — `components/BoxSelectionTiles.tsx` and the hub
  landing should show each box's icon.

## The serving problem (the real work)

The favicon and manifest are **static files served identically for every box**;
the SPA `index.html` is one document. Making them per-box means the per-box
`bbx serve` (behind the hub's `/<slug>/` prefix) has to serve a **box-scoped
favicon and manifest** — either by templating `index.html`/`manifest.webmanifest`
per box at serve time, or box-scoped routes (`/<slug>/manifest.webmanifest`,
`/<slug>/favicon`) that resolve the box's configured icon. An emoji icon can be
rendered to PNG/SVG server-side; an image icon is served from the box's config.

## Design questions

- **Emoji vs image vs both.** Emoji is zero-asset and matches the landmark
  `symbol` union; an image allows a real logo/photo. Support both, like `symbol`.
- **Where the icon is declared** — `config/box.json` field, a config card, or a
  well-known `config/icon.*` file. Prefer one that `bbx init`/templates understand
  and that survives sync.
- **Sizes** — the PWA manifest wants 192/512; an emoji renders to any size, an
  uploaded image needs resizing (the box already has image handling).
- **Default** — fall back to the current global icon when a box sets none, so
  nothing regresses.

Pairs with the deferred per-box PWA manifest and the general soft-launch polish
(distinct boxes should look distinct).
