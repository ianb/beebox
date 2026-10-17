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
bin/browse open '/dev/theme-studio?system=draft&card=draft'
bin/browse set viewport 1280 900
bin/browse screenshot
bin/browse set viewport 375 800
bin/browse screenshot
```

Edit `beebox/src/frontend/src/pages/dev/theme-studio-draft.css`; Vite refreshes
it. The URL independently selects `system`, `systemStock`, `card`, and `cardStock`.
Unknown names render base styles until CSS matches. Existing studies are
`undertow`, `deck-study`, and `patina-study` in `theme-studio-studies.css`;
`rose-trellis-study` and `gold-thread-study` are in `theme-studio-textiles.css`.
Goldfish and Doodlebit are catalog themes, available in the studio as
`goldfish` / `water` and `doodlebit` / `ink`. Tempest (`tempest` / `water`),
Veil (`veil` / `pigment`), and Gilt (`gilt` / `leaf`) are also catalog themes.

Scope every draft selector to `.bbx-theme-studio` and its draft attribute: lazy
CSS stays loaded after navigation. Keep draft CSS under `pages/dev/`, out of
`main/app.tsx` and the product catalog. Use the material tokens in
`themes/materials.css` and chrome hooks in `themes/chrome.css` (frontend-relative).
Inspect reading surfaces, controls, card backs and phone layouts, then make a
labeled exhibit with comment controls for feedback.

## Promote and land

For an approved choice, move scoped production styles and assets into `themes/`,
import the stylesheet in `main/app.tsx`, and register the theme/stock in
`src/shared/card-theme/catalog.ts` (beebox-relative). See [card themes](box/card-themes.md).
Check the real app visually; the studio does not exercise live navigation,
portaled menus or chat state. On a phone, check composer dictation and disabled
send, nav badges and focus rings. Screen and print rules live in separate files:
when a scoped selector gains specificity, emulate print media and confirm the
print reset still wins. A worktree backend started before the catalog entry
rejects the new theme; `bin/workstreams status` shows it `ready (stale)` (see
[router operations](../../bin/docs/router-operations.md)). Keep unrelated
explicit card themes independent.

At landing, run the required selected tests and relevant theme tours, typecheck,
lint, review and commit gates. Tours omit color contrast, so check it separately.
Do not claim a preview is verified for production merely because it looks right.
