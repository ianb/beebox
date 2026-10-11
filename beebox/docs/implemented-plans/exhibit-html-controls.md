---
title: "Comment and reply controls on raw index.html exhibits"
status: implemented
workstream: exhibits-rethink
issues: []
---
# Comment and reply controls on raw `index.html` exhibits

A raw `index.html` exhibit is served as-is and gets no container, so it has no
Comment control and no Reply button. This plan gives the page author one line
to add that mounts a fixed control bar with both, style-isolated from the page.

**Issues addressed:** none. Grepped `issues/` for `exhibit` and `comment`:
nothing about raw pages. Direct request from the boxholder, 2026-10-10: raw
pages should get commenting; prefer a convention over injection, and a fixed
control panel the page author can account for.

## Design

No design section: this is dev tooling on the boxholder's machine, not a box
surface (same reason as `../implemented-plans/exhibit-comments.md`).

## Smallest fix and budget

Smallest fix: the server injects `<script type="module" src="/boot/controls.ts">`
before `</body>` of every served `index.html`. Declined: the boxholder asked for
a convention the author accounts for, and an injected bar lands on pages that
never planned for it (full-bleed canvases, pages with their own bottom bar).

Chosen: one subproject, `workstreams-app`. Estimated source 120 lines across
three new files under `src/frontend/exhibits/boot/`, test 40 lines, docs 30
lines. No server change: `/boot/*` already reaches Vite through `delegate`
(`src/server/exhibits/app/handler.ts:103`), which is how the shell loads
`/boot/mount.tsx` (`pages.ts:167`).

## Stated preferences this plan trades against

- Memory: prefer platform primitives over invented concepts. The convention is
  a `<script>` tag and an optional element id; isolation is a shadow root. No
  manifest flag, no registry.
- `exhibit-comments.md` precedent: "The control appears on the default and
  `index.tsx` tiers ... A raw `index.html` page shows no control" — this plan
  revises that sentence rather than adding a parallel mechanism.
- AGENTS.md "no features beyond the task": the bar carries exactly the two
  controls the container has (Reply, Comment); nothing new is designed.

## What already exists

- `CommentPanel({ scope, contentRef })`, `boot/CommentPanel.tsx:166` (now `exhibits/CommentPanel.tsx`) — reuse
  unchanged; `contentRef` becomes `document.body`.
- `ReplyInSessionButton({ scope })`, `boot/Container.tsx:65` (now `exhibits/Container.tsx`) — reuse unchanged.
- `captureSelection(root)`, `lib/selection-anchor.ts:76` — works on any
  element; the body is the root for a raw page.
- The shell's boot, `boot/mount.tsx` — the model for a second entry module.
- `styles.css` with `@tailwind` and `corePlugins.preflight: false`
  (`vite-assets.ts:52`): no reset leaks, but its `:root` colour/background and
  `body { margin: 0 }` would restyle the author's page if imported globally.
  Hence the shadow root with the stylesheet imported `?inline`. Inside the
  shadow tree the sheet's `:root` and `body` rules match nothing, so the bar
  would inherit the page's font, colour, and colour scheme; the mount adds a
  `:host` rule for those three.
- The comment route and the focus route accept any origin-checked page; a raw
  page "may call the routes directly" (`docs/exhibits.md`, Comments). The bar is
  that call, written once.

## Prior art (external)

- Vite backend integration: a page not processed by `transformIndexHtml` must
  install the React refresh preamble itself before importing a module that
  defines components, or plugin-react throws "can't detect preamble".
  Verified in `node_modules/@vitejs/plugin-react/dist/index.js:12-36` (4.7.0):
  the preamble imports `/@react-refresh`, calls `injectIntoGlobalHook(window)`,
  and sets `$RefreshReg$`/`$RefreshSig$`. Adopted as the loader's first lines:
  the pinned plugin's own `preambleCode`, plus the
  `__vite_plugin_react_preamble_installed__` marker the Vite guide shows
  (https://vite.dev/guide/backend-integration). Five lines the plugin requires;
  no ACKNOWLEDGEMENTS entry.
- Vite `?inline` CSS import returns the processed stylesheet as a string
  (https://vite.dev/guide/features#disabling-css-injection-into-the-page).
  Evaluated-only.

## Ontology

- **Control bar**: the `div` the loader appends to `body`, fixed to the
  bottom of the viewport, holding Reply and Comment. Its idle height is fixed
  at 48px, which is the number the author accounts for. Not a container: the
  page keeps its own title, styles, and layout, and nothing on the page is
  edited.
- **Scope**: `<workstream>/<exhibit>`, the first two path segments of the page
  URL (same string `ExhibitBoot.scope` carries, `shared/exhibits.ts`). A page
  under `/apps/<name>/` has scope `apps/<name>` and gets no bar, as the
  container shows no controls for it (`Container.tsx:112`).
- No new nouns elsewhere; the comment store and routes are unchanged.

## Tracks / scope

One track.

**What.** Three files in `src/frontend/exhibits/boot/`:

- `controls.ts` — the loader the author references. Plain TypeScript, no
  components (so plugin-react does not wrap it). Installs the refresh preamble,
  then `await import("./controls-mount.tsx")`.
- `controls-scope.ts` — `scopeFromPath(pathname): string | null` (two
  non-empty segments, else null) and `isStoreScope(scope)` (`!apps/`). Pure;
  doctested.
- `controls-mount.tsx` — appends the bar (`position: fixed; inset: auto 0 0
  0; min-height: 48px`), attaches `shadowRoot`, adds a `<style>` with the
  `:host` baseline (font, colour, `color-scheme: light`) and `styles.css?inline`,
  renders `<ExhibitControls scope />` (a row: `ReplyInSessionButton` then
  `CommentPanel` with `contentRef = { current: document.body }`). The composer
  grows the bar upward over the page; the page is never edited. A native
  `mouseup` listener on the host stops propagation so a click inside the bar
  is never read as a selection on the page.
- `ControlBar.tsx` holds the strip component apart from the mount, so a
  doctest renders it without the mount's stylesheet import. (A file named
  `Controls.tsx` resolved to `controls.ts` on the case-insensitive filesystem;
  hence the distinct name.)
- `controls.ts` catches a failed mount import and writes one plain sentence
  into a `div` at the bottom of the page, because a raw page has no Vite
  error overlay and a missing bar would otherwise look like a missing tag.

**Why.** The container is the only thing that mounts the controls, and raw
pages skip it by design (`handler.ts:148-152`).

**Direction.** Author convention, documented in `docs/exhibits.md`:

```html
<script type="module" src="/controls.ts"></script>
```

and `padding-bottom: 48px` (or more) on the page's scrolling element so the
bar does not cover the last line.

**Vocabulary lock-ins.** The script path `/controls.ts` and the 48px
idle height. Both are in the doc, and in the logo bake-off page as the first
user.

**First implementation chunk.** All three files, the doctest, the doc, the
line added to `~/src/workstream-exhibits/logo-bakeoff/.../index.html` (outside
git) as the hand check.

## Could this be simpler?

Simplest: the author adds the script tag and the bar is rendered without a
shadow root, importing `styles.css` globally. Fails on any page that sets its
own colour scheme: `:root { color; background }` and `body { margin: 0 }` from
`styles.css` restyle the author's page, which is the injection the boxholder
declined by another route. The shadow root is one line and keeps the contract
"served as-is" true for the page's own DOM.

A first draft also offered a `#exhibit-controls` placeholder for in-flow
placement and set `body.style.paddingBottom` from the loader. Plan review cut
both: the request was a fixed panel the author accounts for, so one placement
and a documented height is the whole contract, and a loader that edits the
page's body is injection by another name.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Author omits the script tag | no (convention) | doc states it | silent by design: the page is as-is |
| Page URL has fewer than two segments or is `apps/` | doctest for `scopeFromPath`/`isStoreScope` | no bar, one `console.info` naming why | clear in console |
| Preamble missing (loader imported a component module first) | no DOM tier | plugin throws at module eval | clear: console error; verified by hand |
| `styles.css?inline` fails to transform, or any mount import fails | no | the loader catches the dynamic import and writes the message at the bottom of the page | visible |
| Page's own `mouseup` handlers | no | the bar stops propagation only for events inside it | n/a |
| Fixed bar covers the page's last content | no | author convention: 48px bottom padding | visible |
| Dark-scheme page | no | bar carries its own light background | visible, acceptable |

No critical gap: every silent case is the author's own choice (no tag), and the
runtime cases print to the console or show on the page.

## Agent-flow / user-flow edge cases

- Wrong path (`/controls.tsx`): Vite 404s the module and the console says
  so. ADDRESSED by the doc naming the exact path.
- Page served under the dashboard's proxy or another origin: not a case; the
  exhibits origin is the only server of `/boot/`.
- Transition: pages without the line keep behaving as before. ADDRESSED.

## NOT in scope

- Injecting the tag server-side: declined by the boxholder.
- Reading comments back on the page: unchanged from `exhibit-comments.md`.
- A `bin/exhibits add` HTML scaffold that includes the line: agents write
  HTML by hand today; the doc's "writing a raw page" bullet carries the line.
- Dark-scheme styling for the bar.

## Open design questions

none. Lean recorded above: fixed bottom by default, placeholder opt-in.

## Knowledge audits

Skipped: dev-dashboard tooling, no box-facing concept.

## What will hold this after it ships

- `boot.controls-scope.doctest.md`: `scopeFromPath` on `/ws/ex/`, `/ws/ex`,
  `/ws/`, `/apps/x/`, `/`; `isStoreScope`. The helper exists to be tested; it
  is the one decision the mount makes.
- `boot.container.doctest.md` gains `ExhibitControls` rendered statically:
  Reply then Comment present for a store scope.
- The mount itself (shadow root, preamble, fixed bar) has no test tier in this
  package; it is verified by hand in the Playwright browser and recorded in the
  exhibit.

## Implementation order

1. `controls-scope.ts` + doctest.
2. `controls-mount.tsx`, `controls.ts`, `ExhibitControls` doctest.
3. Doc; the line in the logo bake-off page; hand check; exhibit.

## Rollout shape

Done when the two doctests pass, typecheck and lint pass, and the hand check
shows a comment left from the logo bake-off page in
`bin/comments list --workstream logo-bakeoff` with the selected words and the
nearest heading. No migration; no audit.

## Review record

Plan review (Codex gpt-6-sol, 2026-10-10, `scratch/cross-model/exhibit-html-controls-plan-codex.md`):
five findings, all taken. Cut the `#exhibit-controls` in-flow placement and the
loader's body padding (one fixed panel, documented height). Added the `:host`
baseline, the visible mount-failure message, and corrected the preamble and
line citations.

Diff review (Codex, `scratch/cross-model/exhibit-html-controls-diff-codex.md`):
five findings, all taken. The host hangs off `<html>` and the selection root
is read lazily, so a page script that replaces the body does not remove the
bar; the bar renders inside the container's error boundary; the preamble
import moved inside the loader's try; the doc names the bottom 48px as the
bar's and narrows selection support to ordinary body text.

## Implementation status

Implemented 2026-10-10 on `worktree-exhibits-rethink`. Files:
`workstreams-app/src/frontend/exhibits/controls.ts` (served at `/controls.ts`) and `exhibits/controls/{scope.ts,mount.tsx,ControlBar.tsx}`. Layout-check moved them out of `boot/`, and moved `Container.tsx`, `CommentPanel.tsx`, and `comment-requests.ts` from `boot/` up to `exhibits/`: they are now reached from two entries, so they are infrastructure of the directory that holds both. The preamble lives in the loader as a dynamic import of `/@react-refresh` awaited before the mount import: a rooted specifier cannot be declared as an ambient module, so a static import of it does not typecheck.,
doctests `boot.controls-scope.doctest.md` and the control-bar section of
`boot.container.doctest.md`, the "Controls on a raw page" section of
`workstreams-app/docs/exhibits.md`. Hand check: the logo bake-off round 3 page
(outside git) with the line added; a comment on two selected caption words
landed in a scratch store and `bin/comments list --workstream logo-bakeoff`
showed the quote and the nearest heading.
