# Authoring themes

Use the [bbx-theme skill](../../.claude/skills/bbx-theme/SKILL.md) for visual
iteration. **Show the theme before running tests. Automated verification and
formal reviews wait for an explicit finish/landing request.** Browser inspection
and screenshots are the feedback loop; do not run the tour as a preview shortcut.

## Edit and capture

The studio renders real card, Markdown and composer components against fixed
fictional content, without creating cards or changing box settings. Navigation
and composer actions are styling specimens. The Properties corner works.

```sh
bin/theme-check                     # the draft; or --system deck --system-stock panels
```

It writes desktop and phone captures of the studio under
`beebox/test/tours/.artifacts/theme-check/` and outlines what a reader would
struggle with, each labelled:

- text below WCAG AA against the pixels actually under it, including artwork,
  gradients and translucent layers (a ratio such as `2.8:1`);
- a material token pair below AA (`ink on sheet 2.7:1`), even when the studio
  does not show that pair;
- text on a panel the theme did not declare that flips the paper's light or
  dark side (`surface #ffffff`), such as a white app panel in a dark card.

It then loads the studio at phone, tablet and desktop screen sizes and lists
artwork that leaves a bare strip in its box, and painted artwork (WebP, PNG,
JPEG) that is stretched or repeats, such as a backdrop shorter than a tall
phone. Cropping is fine; a bare strip or a stretch is worse than a seam. Size
artwork to fill: `cover`, or `auto max(920px, 100%)` to keep a chosen scale.
An SVG pattern may tile.

It prints the same list with colors and selectors, and exits 0: it is the
preview, not a gate. Read the captures before showing the theme.

Edit `beebox/src/frontend/src/pages/dev/theme-studio-draft.css`; Vite refreshes
it. The URL independently selects `system`, `systemStock`, `card`, and `cardStock`.
Unknown names render base styles until CSS matches. Existing studies are
`undertow`, `deck-study`, and `patina-study` in `theme-studio-studies.css`;
`rose-trellis-study` and `gold-thread-study` are in `theme-studio-textiles.css`.
Goldfish and Doodlebit are catalog themes, available in the studio as
`goldfish` / `water` and `doodlebit` / `ink`. Tempest (`tempest` / `water`),
Veil (`veil` / `pigment`), Gilt (`gilt` / `leaf`), Phosphor (`phosphor` /
`terminal`), Overprint (`overprint` / `plate`), and Posy (`posy` / `paisley`)
are also catalog themes.

Scope every draft selector to `.bbx-theme-studio` and its draft attribute: lazy
CSS stays loaded after navigation. Keep draft CSS under `pages/dev/`, out of
`main/app.tsx` and the product catalog. Use the material tokens in
`themes/materials.css` and chrome hooks in `themes/chrome.css` (frontend-relative).
Inspect reading surfaces, controls, card backs and phone layouts, then make a
labeled exhibit with comment controls for feedback. A surface the studio lacks
belongs in `ThemeStudioHarness.tsx`, so every theme's check covers it.

## Promote and land

For an approved choice, move scoped production styles and assets into `themes/`,
import the stylesheet in `main/app.tsx`, and register the theme/stock in
`src/shared/card-theme/catalog.ts` (beebox-relative). See [card themes](box/card-themes.md).
Check the real app visually; the studio does not exercise live navigation,
portaled menus or chat state. On a phone, check composer dictation and disabled
send, nav badges and focus rings. When a scoped selector gains specificity,
emulate print media and confirm the print rules still win. A worktree backend
started before a new system theme's catalog entry refuses to select it;
`bin/workstreams list` shows it `ready (stale)` (see
[router operations](../../bin/docs/router-operations.md)). Keep unrelated
explicit card themes independent.

At landing, run `bin/theme-check --all` (every catalog theme and stock; exits 1
on a miss), the required selected tests and relevant theme tours, typecheck,
lint, review and commit gates. Every tour checkpoint runs the same audit and
lists misses in its summary.
Do not claim a preview is verified for production merely because it looks right.
