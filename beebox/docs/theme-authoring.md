# Authoring themes

Use the [bbx-theme skill](../../.claude/skills/bbx-theme/SKILL.md) for visual
iteration. **Show the theme before running tests. Automated verification and
formal reviews wait for an explicit finish/landing request.** Browser inspection
and screenshots are the feedback loop; do not run the tour as a preview shortcut.

## Edit and capture

The studio (`/dev/theme-studio`) renders the app's own components on fixed
fictional content, without creating cards or changing box settings: the app
bar, user messages, a reply with tool activity, cards with fields, quotes and
a properties back, tab strips on desks, the Settings panels, and the composer
in its states. Menus and buttons are styling specimens. The presentation fills
the window and the samples scroll inside it, as in the app, so artwork paints
at the scale a screen shows.

The **Studio** button (bottom right) opens the controls: system and card
theme and stock (each with "Other…" for a name only the URL knows), "Card
follows system", and a screen size, which previews the studio in a frame at
that size. A theme change resets its stock to the theme's default; the panel
says when a theme lacks the stock in the URL. The URL holds `system`,
`systemStock`, `card`, `cardStock`, `screen`; `controls=0` hides the panel.

```sh
bin/theme-check                     # the draft; or --system deck (its default stock)
```

It audits the studio at a laptop and a phone screen, one screen of scroll at a
time, and writes a capture per step under
`beebox/test/tours/.artifacts/theme-check/` (`<case>.<screen>.<n>.png`),
outlining what a reader would struggle with, each labelled:

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

At the same screens it lists every rule of the theme's CSS (scoped by
`data-chrome-theme` or `data-card-theme`) that matches nothing in the studio,
and each `bbx-` member of an `:is()` list that matches nothing in its place:
a surface the studio lacks, or dead CSS. Render the surface in
`pages/dev/components/ThemeStudioHarness/` with the real component, delete a
rule no component can match, or exempt it in `test/tours/theme-check.ts` with
a reason. Hover, focus and pseudo-elements count as their element; print rules
are skipped.

It prints the same list with colors and selectors, and exits 0: it is the
preview, not a gate. Read the captures before showing the theme.

Edit `beebox/src/frontend/src/pages/dev/theme-studio-draft.css`; Vite refreshes
it. Unknown names render base styles until CSS matches. Existing studies are
`undertow`, `deck-study`, and `patina-study` in `theme-studio-studies.css`;
`rose-trellis-study` and `gold-thread-study` are in `theme-studio-textiles.css`.
Every catalog theme is in the studio's theme picker.

Scope every draft selector to `.bbx-theme-studio` and its draft attribute: lazy
CSS stays loaded after navigation. Keep draft CSS under `pages/dev/`, out of
`main/app.tsx` and the product catalog. Use the material tokens in
`themes/materials.css` and chrome hooks in `themes/chrome.css` (frontend-relative).
Chat text reads the same tokens: set `--bbx-ink`, `--bbx-ink-soft` and `--bbx-pen`
on the chat material hooks (reply, pending, meta), never a rule keyed on a
utility class such as `.text-warm-700`.
Inspect reading surfaces, controls, card backs and phone layouts, then make a
labeled exhibit with comment controls for feedback.

## Promote and land

For an approved choice, move scoped production styles and assets into `themes/`,
import the stylesheet in `main/app.tsx`, and register the theme/stock in
`src/shared/card-theme/catalog.ts` (beebox-relative). See [card themes](box/card-themes.md).
Check the real app visually; the studio does not exercise live navigation or
chat state. On a phone, check composer dictation and disabled
send, nav badges and focus rings. When a scoped selector gains specificity,
emulate print media and confirm the print rules still win. A worktree backend
started before a new system theme's catalog entry refuses to select it;
`bin/workstreams list` shows it `ready (stale)` (see
[router operations](../../bin/docs/router-operations.md)). Keep unrelated
explicit card themes independent.

At landing, run `bin/theme-check --all` (every catalog theme and stock; exits 1
on a miss; `--jobs` sets the browser sessions, default 3), the required selected tests and relevant theme tours, typecheck,
lint, review and commit gates. Every tour checkpoint runs the same audit and
lists misses in its summary.
Do not claim a preview is verified for production merely because it looks right.
