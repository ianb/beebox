# Authoring themes

Use the development studio to edit CSS against fixed fictional content. It renders
real card, Markdown, controls, and composer components without creating cards or
changing box settings. The navigation sample shows styling hooks; it does not
exercise live navigation or chat behavior.

## Edit and capture

From the monorepo root, open the studio in the current worktree's test box:

```sh
bin/browse open '/dev/theme-studio?system=draft&card=draft'
bin/tour theme-studio
```

Edit `src/frontend/src/pages/dev/theme-studio-draft.css` (relative to `beebox/`).
Vite refreshes the preview. Run the tour again for desktop and mobile screenshots,
accessibility trees, and axe reports under `test/tours/.artifacts/theme-studio/`.
Read `summary.md` and inspect both PNGs. The tour runner currently suppresses
color-contrast checks, so inspect readability separately.

For a quick capture of another combination:

```sh
bin/browse open '/dev/theme-studio?system=paper&systemStock=blue&card=paper&cardStock=manila'
bin/browse set viewport 1280 800
bin/browse screenshot
bin/browse set viewport 375 800
bin/browse screenshot
```

The four controls persist in the URL. `system`/`systemStock` select the surrounding
chrome; `card`/`cardStock` select the card material independently. Defaults are
`plain`/`neutral`. Names absent from the catalog are allowed: they render base
styles until CSS matches them. Start with `draft` to use the capture tour unchanged.

## Keep exploration contained

Every draft selector must include `.bbx-theme-studio` and the relevant draft theme
attribute. Lazy CSS remains in the document after navigation, so the selector
scope is required. Keep this file under `pages/dev/`; never import it from
`main/app.tsx`. Do not add a draft to product settings just to preview it.

The material contract is in `src/frontend/src/themes/materials.css`; chrome hooks
are in `src/frontend/src/themes/chrome.css`. Use their tokens for paper, ink,
links, edges, selection, and composer surfaces. The studio's Properties button
flips the real card, so check both faces. Check long text, quotes, code, tables,
focus and selection as well as the broad palette.

## Promote a chosen theme

Move approved styles into the appropriate production theme stylesheet, remove
the studio scope, and register the theme/stocks in `src/shared/card-theme/catalog.ts`.
Follow [card themes](box/card-themes.md) for the product contract. Then install the
fixed theme-tour cards using the instructions in [frontend.md](../frontend.md)
and run `bin/tour card-themes`, `bin/tour card-theme-previews`, and
`bin/tour card-theme-interface` against real product surfaces. The studio does not
cover portaled menus, overlay contexts, navigation behavior, or live chat state.
