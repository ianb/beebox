# Card-aware widgets for box-authored views

A reusable widget set — `<CardLink>` and `<CardRef>` — that box-authored JSX
views import to point at another card, rendering the *right* affordance for
**the surface they are displayed in**: opening a card from a view in the chat
companion pane opens it in the pane; from browse, in the browse surface; from a
full card page, page navigation. The widgets delegate "how to open a card here"
to a host-supplied view-host context rather than hardcoding a navigation target.

## Stated preferences this plan trades against

- `callback-box/CLAUDE.md:101` — *"Read before writing. Don't guess file
  formats, XML structures, or API shapes."* This plan cites the existing nav
  plumbing rather than reinventing it.
- `callback-box/CLAUDE.md` (Cards/Validation) — *"`cb validate` checks all
  cards … Boxes get two hooks installed during `cb init`."* Refs are a
  validated, tracked surface; a JSX-embedded ref must not be a blind spot.
- `callback-box/CLAUDE.md` — *"Box-authored views are a security-sensitive
  surface (compiled box code) — don't widen what views can do beyond
  card-viewing"* (paraphrased from the idea brief; reinforced by the views
  compiler externalizing only React today).
- `callback-box/CODE-STYLE.md` — no default parameters, max 2 positional
  params (named-params object beyond that), no `any`, no bare `as` in `.tsx`.
- `callback-box/FRONTEND.md:34` — *"Reach for a primitive from
  `src/frontend/src/components/ui/` before writing appearance classes inline"*;
  the `className`-only-for-outer-layout rule (FRONTEND.md:81-83). Widgets are
  host components and must obey the palette + primitives.
- Most recent precedent: the chat-header landmark menu
  (`src/frontend/src/components/LandmarkLinksButton.tsx`, commit `7d5cd93e`) —
  "go / open in sidebar" via `onZoomView`. This plan **shares** that mechanism
  rather than forking it.
- `docs/feedback_components_own_a11y` (user memory) — components render their
  own landmark; widgets must not require the author to wrap them.

## What already exists

- **The view compiler** — `src/webapp/views/compiler.ts`. esbuild bundles each
  view; React is externalized two ways by target: browser uses a
  `react-shim` plugin emitting `const React = window.__cbReact` (compiler.ts:44-70),
  node externalizes bare `react` specifiers (compiler.ts:146-149). **Reuse:**
  this is the exact seam for a `callback-box/view-widgets` specifier — add a
  widgets analog to `reactExternalPlugin` (browser) and to the node `external`
  array. `external` is already a caller-supplied option (compiler.ts:118,125).
- **`window.__cbReact`** — set in `ViewRenderer.tsx:76-78`
  (`if (!window.__cbReact) window.__cbReact = React;`). **Reuse:** views and host
  share one React instance, so a host-created React context is consumable by
  widget code. (Prior art confirms this is the standard micro-frontend pattern —
  see below.) A `window.__cbViewWidgets` global mirrors it.
- **Compiled-view runtime** — `src/frontend/src/components/ViewRenderer.tsx`.
  Dynamically imports `/views/<slug>/module.js` (ViewRenderer.tsx:120-122) and
  renders `mod.default` with a fixed `ViewProps` set (ViewRenderer.tsx:236-246):
  `cards`, `files`, file helpers, `navigate(path:string)`, `boxSlug`, `params`,
  `reportActivity`. **Gap to close:** the compiled view receives **only**
  `navigate(path)` — a hard router push (ViewRenderer.tsx:200-204) — and never
  the surface-aware `onNavigate(target,hint)` or `onZoomView`. This is the
  reason a view can't "open in the current surface" today.
- **`ViewProps`/`ViewMeta`** — `src/types/views.ts:10-95`. `ViewMode = "page" |
  "chat"` (types/views.ts:95). **Reuse/extend.**
- **FileView** — `src/frontend/src/components/FileView.tsx`. `FileViewMode =
  "page" | "chat" | "companion" | "embed"` (FileView.tsx:45). Required prop
  `onNavigate: (target: ViewTarget, hint?: NavigateHint) => void`
  (FileView.tsx:57); passed to every renderer (FileView.tsx:349). **`embed`
  mode** (FileView.tsx:354-358) is exactly CardRef's *inline* affordance.
  **Gap to close:** when a box view is the bound renderer for a card type, the
  `Bound` wrapper (FileView.tsx:319-326) mounts `<ViewRenderer>` **without
  forwarding `onNavigate`** — so the surface primitive is dropped on the
  card-binding path too.
- **`onZoomView`** — `src/frontend/src/components/chat/markdown-rendering.tsx:18`:
  `(view: { target: ViewTarget; label: string }) => void`. Defined by
  `useChatTabs()` (`InteractiveChat-hooks.ts:24-56`), threaded as a **prop**
  (no context) through `InteractiveChat-view.tsx` → `ChatHeader`. Callers wrap
  a `{target,label}`: LandmarkLinksButton (InteractiveChat-layout.tsx:49-55),
  RecentFilesButton (layout.tsx:56-62), markdown view-links
  (markdown-rendering.tsx:118-136). The companion pane renders each tab as
  `<FileView mode="companion" onNavigate=… />` whose `onNavigate` re-enters
  `onZoomView` with `zoom:false` (InteractiveChat-controls.tsx:306-313,
  InteractiveChat-view.tsx:266-274). **Reuse:** the surface's `onNavigate`
  *is* the per-surface "open a card here" primitive the widgets need.
- **Browse navigation** — `src/frontend/src/pages/BrowsePage.tsx`.
  `handleLinkNavigate` (BrowsePage.tsx:108-121) is the FileView `onNavigate`
  for browse: `zoom:true` escapes to a full page, else swaps the detail panel.
  **Reuse.**
- **View URL addressing** — `src/frontend/src/lib/view-url.ts`.
  `ViewTarget = { path; viewer; params; zoom }` (view-url.ts:14), `parseViewUrl`
  (view-url.ts:38, normalizes leading-slash refs via `boxRelativePath`),
  `resolveRelativePath` (view-url.ts:96, handles `attach/` scope). **Reuse:**
  the widget's `ref` → `ViewTarget` conversion is `parseViewUrl` /
  `resolveRelativePath`, identical to markdown links.
- **`callback-box/cards` exposure** — `package.json:8-11` exports `./cards` →
  `dist/cards/index.js`; Node box-schema loading uses a `registerHooks` resolve
  hook gated on `parentURL.includes("/config/schemas/")`
  (`src/schemas/registry.ts:131-156`) with a virtual package-root parent
  (registry.ts:118); `dist/cards/index.js` is a separate esbuild bundle
  (`scripts/build-cli.mjs`, second `build()` call). **Reuse the pattern,
  rebuild for views:** a `./view-widgets` export needs its own dist bundle and a
  resolve-hook gate keyed on the box `views/` dir (not `config/schemas/`).
- **Ref extraction + validation + rewrite** —
  - `extractRefs` (frontmatter) `src/cards/schema.ts:240`; `extractBodyRefs`
    (Markdoc body) `src/core/body-refs.ts:46`. Both yield `{path, ref}`.
    body-refs.ts:14-19 explicitly anticipates *"future schemas with a different
    body format would write their own extractor and merge results"* — the
    extension seam for JSX views.
  - `cb validate` broken-ref walk: `src/core/card-lint.ts:144-157` runs both
    extractors, checks existence via `resolveRefExists`
    (`src/core/ref-exists.ts:45`); ref convention defined in
    `resolveRefToPath` (ref-exists.ts:30) — leading `/` = box-root, `attach/` =
    attach scope, else relative to referrer dir. Broken = warning.
  - `cb mv` rewrite: `src/core/rewrite-card-refs.ts` (`ref="…"` regex already
    matches widget attributes, gated by a `remap` closure so over-matching is
    safe — header :38-40). Referrer set in
    `src/core/commands/move-operations.ts:197-200` is
    `listBoxCardFiles + listBoxMarkdownFiles` (`src/core/list-cards.ts:12,35`).
    **Gap to close:** `views/*.tsx` is in **neither** the validate scan nor the
    mv referrer set.

## Prior art (external)

- **Externalized React → window global shares Context across dynamically
  imported modules.** Confirmed the established micro-frontend pattern: marking
  React external and resolving it to one `window` global means every
  dynamically imported module references the same React instance, so Context
  propagates across the import boundary. This is exactly what `window.__cbReact`
  already does for views; `window.__cbViewWidgets` extends it.
  `esbuild-plugin-external-global` / `@fal-works/esbuild-plugin-global-externals`
  are the off-the-shelf versions of the hand-rolled `reactExternalPlugin`.
  - https://github.com/evanw/esbuild/issues/2668
  - https://www.npmjs.com/package/esbuild-plugin-external-global
- **No prior art needed for the ref-in-JSX tracking** — it's an internal
  convention extension (`extractBodyRefs` already anticipates new body-format
  extractors, body-refs.ts:14-19). No external search applies.

## Tracks / scope

Ordered by implementation dependency, then surface size.

### Track 1 — The view-host context (the crux)

**What.** A React context, `ViewHostContext`, created in host frontend code and
provided by `ViewRenderer` around the compiled `<Component>`. It exposes the
per-surface "open a card here" operation plus the ambient facts a widget needs.

**Why this needs to change.** A compiled view's only nav primitive is
`navigate(path)` — a hard router push (ViewRenderer.tsx:200-204) — so a widget
rendered in the chat companion pane cannot open a card *in the pane*; it would
always leave the pane for a full page. The surface already knows how to open a
card correctly (it passes `onNavigate` into FileView), but that primitive never
reaches the compiled view. A widget instance sits arbitrarily deep in the
author's JSX, so a threaded prop can't reach it — context is the only clean
delivery, and the shared `window.__cbReact` instance makes context identity hold
across the dynamic-import boundary.

> **Note — this corrects the briefing's framing.** The briefing assumed "props
> can't thread into compiled JSX cleanly, so a context is likely required."
> Props *do* thread cleanly (`ViewRenderer` already passes a full `ViewProps`
> object). The real reason for a context is widget *depth* in author JSX, not a
> threading limitation — and the load-bearing enabler is the shared React
> instance, which the plan must not break.

**Direction.** Contract shape (host frontend, e.g.
`src/frontend/src/lib/view-host.tsx`):

```ts
export interface ViewHost {
  /** Open a card ref in the current surface (the "go" affordance). */
  openCard(ref: string, opts?: { label?: string; viewer?: string | null; params?: Record<string, string> }): void;
  /** The view's own box-relative path, for resolving relative refs. */
  basePath: string;
  boxSlug: string;
  /** Which surface mounted the view — for affordance defaults and analytics. */
  surface: "page" | "chat" | "companion" | "browse" | "embed" | "node";
}
const ViewHostContext = createContext<ViewHost | null>(null);
export function useViewHost(): ViewHost { /* throws if used outside a view */ }
```

`openCard` is built once per surface from the surface's existing
`onNavigate(target, hint)`: it `parseViewUrl`/`resolveRelativePath`-resolves
`ref` against `basePath` into a `ViewTarget`, then calls `onNavigate(target,
{ label })`. Because the companion pane's `onNavigate` re-enters `onZoomView`,
browse's swaps the detail panel, and the page's pushes a route, the three
surface behaviors fall out for free — no new per-surface code beyond passing the
already-existing `onNavigate` down.

Plumbing changes:
1. Add `onNavigate?: (target: ViewTarget, hint?: NavigateHint) => void` to
   `ViewRendererProps` (ViewRenderer.tsx:80-87). When present, build `openCard`
   from it; when absent, fall back to the current `viewNavigate` page push
   (ViewRenderer.tsx:200-204) so standalone view pages keep working.
2. `ViewRenderer` wraps `<Component>` in
   `<ViewHostContext.Provider value={host}>` (ViewRenderer.tsx:234-246).
3. `FileView`'s `Bound` wrapper forwards its `onNavigate` into `<ViewRenderer>`
   (FileView.tsx:319-326) — closes the card-binding drop.
4. The standalone view-page mount (`useViewNavigate`,
   `src/frontend/src/hooks/useViewNavigate.ts`) passes an `onNavigate` so a
   view opened as a full page still routes correctly.

**Vocabulary lock-ins.** `useViewHost`, `openCard`, `ViewHostContext`,
`surface` enum values above. `openCard`'s first positional arg is the raw `ref`
string (matches the `ref="…"` author convention).

**First implementation chunk.** Add `view-host.tsx` (context + `useViewHost` +
the `openCard`-from-`onNavigate` builder), thread `onNavigate` into
`ViewRendererProps`, wrap the component, and forward through FileView's `Bound`.
No widget yet — a temporary in-view `useViewHost()` smoke call in a test box
view proves the context resolves on all three surfaces.

### Track 2 — `callback-box/view-widgets` package + exposure

**What.** A public specifier compiled views import: `import { CardLink, CardRef }
from "callback-box/view-widgets"`. The widget implementations live in host
frontend code (so they `useViewHost()` against the same context object and use
host UI primitives); the specifier is externalized by the compiler to a global
in the browser and to a bundled module in node.

**Why this needs to change.** There is no off-the-shelf way for a view to embed
or link a card; authors hand-roll `<a>` and must know the `view:`/path
convention (idea brief). The compiler only externalizes React today
(compiler.ts:44-70) — any other import is bundled relative to the box dir and
fails (per cards-exposure analysis).

**Direction.**
- **Browser:** add a `viewWidgetsExternalPlugin` mirroring `reactExternalPlugin`
  (compiler.ts:44-70) that maps `callback-box/view-widgets` →
  `const W = window.__cbViewWidgets; export const CardLink = W.CardLink; export
  const CardRef = W.CardRef;`. Host bootstrap assigns
  `window.__cbViewWidgets = { CardLink, CardRef }` next to the `__cbReact`
  assignment (ViewRenderer.tsx:76-78). Both widget and provider come from the
  one frontend bundle → context identity guaranteed.
- **Node (`cb view test`):** externalize `callback-box/view-widgets` in the node
  `external` array (compiler.ts:146-149); add a `./view-widgets` export to
  `package.json` → `dist/view-widgets/index.js`; add a third esbuild bundle in
  `scripts/build-cli.mjs` (parallel to the cards bundle); add a resolve-hook
  gate for the box `views/` dir analogous to `registry.ts:131-156` (the existing
  gate is `/config/schemas/`-only). The node bundle exports the components plus
  a `ViewHostProvider` so the `cb view test` harness can supply a no-op/page
  `openCard` (surface `"node"`).
- **Security:** the widgets do not widen view powers — `openCard` only routes a
  box-relative `ViewTarget` (constrained by `boxRelativePath`, view-url.ts:50)
  through the host's existing `onNavigate`; inline rendering reuses `FileView`,
  which already governs what is renderable. No new fetch/exec capability is
  exposed.

**Vocabulary lock-ins.** Specifier `callback-box/view-widgets`; global
`window.__cbViewWidgets`; dist path `dist/view-widgets/index.js`; export key
`./view-widgets`.

**First implementation chunk.** Compiler browser+node externalization for the
specifier + `window.__cbViewWidgets` host assignment, exporting a trivial
placeholder `CardLink` that renders its children. Compile a test-box view that
imports it, on both the browser path and `cb view test`, to prove resolution
end-to-end before building real widget behavior.

### Track 3 — `<CardLink>` (the barely-styled correct link)

**What.** `<CardLink ref="store/Notes/Foo.memo.card" view? params?>label</CardLink>`
→ a **minimally styled** inline link that simply *behaves* correctly: it calls
`useViewHost().openCard(ref, { label, viewer, params })` on activation, opening
the card in whatever surface the view is displayed in. Appearance is
deliberately light so it sits inside author prose without imposing a chrome;
label falls back to the target's title when children are omitted (mirrors
landmark links, LandmarkLinksButton.tsx:87).

**Why this needs to change.** "Point at another card" is the most common view
need and has no reusable component; today an author hand-rolls an `<a>` and must
know the `view:`/path convention (idea brief). The boxholder's framing: *"a link
that behaves how we want, but has little in the way of styling."*

**Direction.** Resolve the label/existence via a small query shared with
CardRef — a `views.resolveRef` tRPC procedure returning `{ title, type, exists
}` (built from the same loader the existing `/views/<slug>/cards` route uses,
ViewRenderer.tsx:132-141; and mirroring `landmarks.forDir`'s resolved-link
payload, commit `7d5cd93e`). Missing target → a muted "(missing)" marker like
LandmarkLinksButton.tsx:88-90, never a dead link. Render a near-bare anchor
(underline-on-hover, inherits surrounding text color — light enough to live in
prose, but still a real link per FRONTEND.md's primitive/`className` rules) and
`preventDefault` → `openCard`.

**Vocabulary lock-ins.** Attribute name `ref` (matches the tracked-ref
convention, ref-exists.ts); optional `view` (→ `ViewTarget.viewer`) and `params`.

**First implementation chunk.** `views.resolveRef` procedure + `CardLink`
rendering a resolved-title link that calls `openCard`; assigned into
`window.__cbViewWidgets`. Doctest the procedure; exercise the widget in a
test-box view across chat/browse/page.

### Track 4 — `<CardRef>` (the styled reference: follow + expand-inline)

**What.** The richer, **styled** reference: it presents the target card as a
compact reference (title + type, styled per FRONTEND.md primitives) and offers
two controls on that one reference — **follow** (`openCard` → open in the current
surface) and **expand-inline** (render the card in place). The styled default
presentation *is* the compact form; there is no separate "small" affordance.

**Why this needs to change.** Embedding a card has no off-the-shelf path; the
inline plumbing (`FileView` `embed` mode) exists but isn't exposed (idea brief).
The boxholder's framing: *"a second one that is more styled with
follow/expand-inline options."*

**Direction.**
- **Presentation** — a styled chip/row built from `views.resolveRef` (title +
  type `Badge`, FRONTEND.md:61, + `StatusBadge` if relevant, FRONTEND.md:62),
  using UI primitives and the semantic palette. Missing target → "(missing)".
- **follow** — a control that calls Track 1's `openCard` (same behavior as
  CardLink, surfaced as an explicit affordance on the chip).
- **expand-inline** — a toggle that renders `<FileView path={resolvedPath}
  mode="embed" onNavigate={surfaceOnNavigate} />` (FileView.tsx:354-358) below
  the chip. The widget reads the surface `onNavigate` off the host context so
  nested links inside the expanded card keep surface-correct behavior. `embed`
  is frameless — matches "expand in place."
- **Optional container override** — `<CardRef ref="…">{(summary) => <MyTile/>}</CardRef>`
  may supply a function-child to replace the default chip presentation. Kept as
  a thin escape hatch, **not** a central affordance; default styling is the
  expected path.

**Vocabulary lock-ins.** Two controls named **follow** and **expand** (inline);
the optional function-child override.

**First implementation chunk.** `CardRef` with the styled default chip + the
**follow** control (reusing `openCard`) and the **expand** toggle (reusing
`FileView embed`). Exercise both in a test-box view in the companion pane (where
surface-correct follow matters most) and in browse.

### Track 5 — Ref tracking for JSX views

**What.** Make a `ref="…"` inside a view `.tsx` a tracked card ref:
`cb validate` flags a broken one; `cb mv` rewrites it on moves.

**Why this needs to change.** Today `views/*.tsx` is in neither the validate
ref scan (card-lint.ts:144-157 reads card frontmatter + body only) nor the mv
referrer set (move-operations.ts:197-200 = cards + `.md`). Moving a target card
would silently break a view — the exact hazard the markdown link-validation work
just closed for `.md`.

**Direction.**
- **Discovery:** `extractViewRefs(source)` — a regex over view source for
  `ref="…"` / `ref={"…"}` string literals (the same loose form mv already
  rewrites, rewrite-card-refs.ts header :38-40), yielding `{path:
  "view:<line>:<n>", ref}`. Scope to literal strings; expression refs
  (`ref={x}`) are unresolvable statically and out of scope (flag-and-skip, not
  error).
- **validate:** add `listBoxViewFiles` (glob `views/*.tsx`,
  `src/core/list-cards.ts` alongside :12,:35) and a view branch to the
  broken-ref walk that runs `extractViewRefs` + `resolveRefExists` (ref-exists
  resolves relative to the view file's dir; document that view refs are
  conventionally box-absolute `/…`). Warning, not error (card-lint.ts:137-138
  posture).
- **mv:** add `listBoxViewFiles` to the referrer set (move-operations.ts:197-200);
  the existing `ref="…"` rewrite regex already matches, `remap` gates changes.

**Vocabulary lock-ins.** View-ref `path` token format `view:<line>:<index>`
(parallels `body:<line>:<tag>.<attr>`, body-refs.ts:66-76).

**First implementation chunk.** `extractViewRefs` + `listBoxViewFiles`, wired
into the `cb validate` broken-ref walk, with a doctest over a fixture view that
references an existing and a missing card. The mv inclusion is a second commit
in the same track.

### Track 6 — View-authoring documentation

**What.** Teach box authors/agents that the widgets exist and how to use them, at
the right altitude, by editing the **generators** of the canonical view doc (the
doc is generated, not hand-written).

**Why this needs to change.** The view-authoring reference
(`docs/generated/views.md`) documents the import surface in a single `## React`
section: *"React is provided automatically. Do NOT import React…"*
(`src/core/views-doc-files.ts:155`) — there is **no documented importable-widget
surface** today, and the two worked examples
(`src/core/views-doc-examples.ts`) hand-roll plain card lists with no linking.
Undocumented, the widgets won't be found; the idea brief's premise is that
authors currently hand-roll `<a>` because there's nothing to reach for.

**Direction.**
- **Reference doc (knows_about altitude):** add a `## Card-aware widgets` section
  to `src/core/views-doc-files.ts` (immediately after `## React`, the
  import-surface chapter) documenting: the `callback-box/view-widgets` import;
  `<CardLink ref="…">` (the barely-styled correct link); `<CardRef ref="…">`
  (styled, with **follow** + **expand-inline**); the `ref` convention
  (box-absolute `/…`, relative, `attach/`); and that view refs are tracked by
  `cb validate`/`cb mv`. Add a worked `<CardLink>`/`<CardRef>` example to
  `src/core/views-doc-examples.ts`. Regenerate via the existing
  `generate-docs` path (`src/core/generate-docs.ts:335` writes
  `docs/generated/views.md`) — never hand-edit the generated file.
- **Scaffolded stub:** add a one-line widgets entry to the `views/CLAUDE.md`
  "Quick Reference" (`VIEWS_CLAUDE_MD`, `src/core/box-templates.ts:263-284`),
  pointing at the new section (conditionally loaded when an agent works in
  `views/` — knows-about altitude, matches `cb view test` precedent).
- **No always-loaded pointer (decided).** The widgets are *not* added to the
  always-loaded `viewsSection()` — authoring a view is not a frequent task, so
  `views.md` is the primary documentation and the widgets stay knows_about. Zero
  always-on context is added by this plan. (Boxholder decision, 2026-06-29.)

**Vocabulary lock-ins.** Section title `## Card-aware widgets`; the widget names
and `callback-box/view-widgets` specifier (shared with Track 2).

**First implementation chunk.** The `## Card-aware widgets` generator section +
example + regenerate. Lands **with** Tracks 3-4, not before — documenting a
widget the box can't yet import would send a box agent to a broken import.

## Subplans

None. Each track has a settled direction; the only genuinely open sub-question
(the `summary` FileViewMode) is small enough to live in Open design questions,
not a subplan.

## Failure modes

**Track 1 — view-host context**

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| `useViewHost()` called outside any provider (e.g. a node test without the harness wrapping) | To add (doctest of the hook) | `useViewHost` throws a named error | Clear (throw) |
| A surface mounts `ViewRenderer` without passing `onNavigate` | To add | Falls back to `viewNavigate` page push | Silent-but-safe (page nav, not the in-surface ideal) |
| Context identity mismatch (widget's React ≠ host's React) breaks `useContext` | Manual cross-surface check | Guaranteed by `window.__cbReact` single instance (ViewRenderer.tsx:76-78) | Would be silent (null context) — covered by the throw above |

**Track 2 — exposure**

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| `window.__cbViewWidgets` unset when a view imports the specifier (host bootstrap not run) | To add | Bootstrap sits next to `__cbReact` assignment, runs on ViewRenderer module load | Clear (undefined deref throws at view load, surfaced by `ViewErrorBoundary`, ViewRenderer.tsx:236) |
| `cb view test` can't resolve `callback-box/view-widgets` (dist bundle missing / gate wrong) | `cb view test` doctest on a widget-using view | Build step + resolve-hook gate | Clear (import error printed by the CLI) |
| Node dist bundle drifts from the browser widget source | — | Single source compiled to both; build-cli bundles it | Risk: documented below |

**Track 3/4 — widgets**

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| `ref` points at a card archived/moved between write and read | `views.resolveRef` doctest | `exists:false` → "(missing)" marker | Clear (visible marker) |
| `CardRef` function-child override throws | To add | Wrap in the view's `ViewErrorBoundary` (already wraps the whole view, ViewRenderer.tsx:236) | Clear (error card) |
| Inline `FileView embed` of a huge card blows up the view | — | `embed` is frameless; container controls placement | Silent (layout) — author's call, documented |

**Track 5 — ref tracking**

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| `ref={expr}` (non-literal) can't be statically resolved | `extractViewRefs` doctest | Skipped (not flagged) | Silent — documented limitation |
| mv rewrites a `ref="…"` that wasn't a card ref (false match) | rewrite doctest over a view fixture | `remap` returns null for non-targets → no change (rewrite-card-refs.ts header :38-40) | Clear (no spurious edit) |

**Critical gap:** none unresolved. The closest is the node/browser widget-source
drift (Track 2) — mitigated by compiling one source to both targets, accepted as
a documented risk (same risk the `callback-box/cards` dual build already carries).

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — author uses `<CardLink>` where `<CardRef>` (or a
  plain markdown link) fit. **ADDRESSED** (low stakes): both resolve the same
  `ref`; the only difference is affordance. Validation treats both identically.
- **Stale ref** — target moved/archived after the ref was written.
  **ADDRESSED**: `views.resolveRef` returns `exists:false` → visible "(missing)"
  marker (Track 3); `cb validate` warns (Track 5); `cb mv` rewrites on the move
  itself (Track 5).
- **Two agents touching the same card** — not applicable; widgets are read-only
  view code, no card mutation. **ADDRESSED** (out of the mutation path).
- **Hand-edit drift** — boxholder hand-edits a view with `ref='…'` (single
  quotes) or odd spacing. **ADDRESSED**: `extractViewRefs` and the mv regex
  accept single/double quotes (rewrite-card-refs.ts `ref=(["'])…\1`).
- **Fabricated free-form value** — author writes a `<CardLink>label` that
  misdescribes the target. **ADDRESSED**: label defaults to the *resolved
  title*; a hand-written label is the author's, like any link text — honesty is
  the easy default (resolved title) and the override is explicit.
- **Validation error UX** — broken view ref in agent context. **ADDRESSED**:
  warning reads *"Broken reference at view:<line>:<n>: <ref> does not exist"*,
  matching the existing card/body message shape (card-lint.ts:153-157).
- **Partial migration / transition state** — a view written before the widgets
  ship. **ADDRESSED**: no migration; views without widgets are unaffected, and
  the specifier/global are additive.

## NOT in scope

- **A `summary` FileViewMode / renderer compact-variant contract.** Descoped by
  the boxholder's framing — the two widgets are a barely-styled link and a styled
  follow/expand-inline reference, not a container-controlled "small" form.
  `CardRef`'s styled default chip *is* its compact presentation; a new mode
  rippling into every renderer's `RendererProps.mode` (renderers/index.ts:42) is
  larger surface for a case no card type needs yet. Revisit only if a card type
  wants a bespoke self-authored small form.
- **A first-class container-controlled "small" affordance.** Reduced to the thin
  function-child override on `CardRef`; not a separate crux.
- **Widgets beyond CardLink/CardRef** (card lists, query widgets, editable
  fields). The idea names two widgets; more is feature creep against
  CLAUDE.md's "don't add features beyond what the task requires."
- **Mutation from widgets.** Views already have file helpers; the widgets are
  view/navigation-only to keep the security surface narrow.
- **Rewriting refs inside `ref={expression}`** — statically unresolvable;
  flag-and-skip, documented.
- **Markdown-link parity inside views** — authors can still hand-write `<a>`/
  markdown; this plan adds components, it doesn't remove the manual path.

## Open design questions

- **Where the widget source physically lives.** `src/frontend/src/lib/` (host
  bundle) for the browser components vs. a shared module also consumed by the
  `dist/view-widgets` node bundle. **Lean:** one source file under
  `src/frontend/` that the node bundle entry re-exports, so browser and node
  compile from the same source (mirrors `src/cards/index.ts` feeding both the
  internal import and the `dist/cards` bundle).
- **`openCard` exposing a nested-`navigate`** for CardRef inline. Add `navigate`
  to the `ViewHost` interface, or derive it inside the widget from the same
  `onNavigate`? **Lean:** keep `ViewHost` minimal (`openCard` only) and pass the
  surface `onNavigate` into the inline `FileView` via a second host field used
  only by CardRef — decided in Track 4's first chunk.

## Knowledge audits

This plan introduces an agent-facing convention: **box-authored views import
`callback-box/view-widgets` and use `<CardLink>`/`<CardRef ref="…">` to point at
cards; those refs are tracked by `cb validate`/`cb mv`.**

**Altitude.** Per `docs/agent-knowledge.md:307` view authoring sits at
**knows_about** — *"the agent guide references `docs/generated/views.md`; the
agent should read it for the exact format."* The existing view audits follow
this: `views-render-test-command`, `views-read-large-attachment`,
`views-write-conflict-safe` are all `knows_about` with
`should_read: ["docs/generated/views.md"]`. Only capabilities named in the
always-loaded `viewsSection()` (`rendersCardTypes`, `adapterFetch`) are
`knows_directly`. The widgets are **knows_about** — the boxholder decided
(2026-06-29) not to add an always-loaded guide line, because authoring a view is
not a frequent task; `views.md` is the primary documentation.

Add to `callback-box/src/dev/knowledge-audits.yaml`, in the existing views
block (next to `views-render-card-type`), matching that file's entry shape:

1. **`view-link-another-card`** — *"In a box view, how do you render a link to
   another card that opens correctly whether the view is shown in chat, browse,
   or a full page?"* — `knows_about`, `should_read: ["docs/generated/views.md"]`,
   `correct_contains_any: ["CardLink", "view-widgets"]`, tags `[views, cards]`.
2. **`view-embed-card-inline`** — *"You want a view to show another card's
   contents expanded in place, with an option to open it fully. What do you
   use?"* — `knows_about`, `should_read: ["docs/generated/views.md"]`,
   `correct_contains: ["CardRef"]`, `correct_contains_any: ["expand", "inline",
   "follow"]`, tags `[views, cards]`.
3. **`view-ref-tracked`** — *"If a view links a card with `ref=\"…\"` and that
   card is later moved with `cb mv`, does the view's link break?"* —
   `knows_about`, `should_read: ["docs/generated/views.md"]`,
   `correct_contains_any: ["rewrites", "tracked", "cb mv", "validate"]`, tags
   `[views, cards]`.

Audits land **run** (`npx tsx src/dev/knowledge-audit.ts run --box
<absolute-test-box-path> --filter views` — the box must be an absolute path
outside the monorepo per the `knowledge_audit_resets_tree` memory) with the
dated status comment recorded in the yaml before the plan completes. They run
**after** Tracks 3-4 + Track 6 land (an audit of an undocumented/unbuilt widget
is hollow), and the agent-session cost is part of authoring (per the
`run_authored_verification` memory).

## Implementation order

1. **Track 1, chunk 1** — `view-host.tsx` context + `onNavigate` threading into
   `ViewRenderer` + FileView `Bound` forwarding. (Unblocks everything; no widget
   yet — smoke via in-view `useViewHost()`.)
2. **Track 2, chunk 1** — specifier externalization (browser shim + node
   external + dist bundle + exports + resolve-hook gate) with a placeholder
   widget. (Depends on nothing in Track 1, but lands second so the placeholder
   can read the Track 1 context immediately.)
3. **Track 3** — `views.resolveRef` + real `CardLink`. (Depends on 1+2.)
4. **Track 4** — `CardRef` go/inline/small. (Depends on 3 for resolve + go.)
5. **Track 5** — view ref tracking in validate, then mv. (Independent safety
   net; can land last. Depends only on the `ref="…"` author convention from 3/4
   being real.)
6. **Track 6** — view-authoring docs (generators + regenerate + `views/CLAUDE.md`
   stub line). Lands **with** Tracks 3-4 (after the widgets resolve), so the doc
   never describes a widget the box can't import.
7. **Knowledge audits** — entries written alongside Track 6, **run after** Tracks
   3-4-6 are real; dated status recorded before completion.

Each chunk is one or a few commits on this worktree branch. The plan ships as
one unit when all tracks complete; **no merge to main without an explicit signal.**

## Rollout shape

- **Test posture** (per `docs/testing.md` — tests first, as a design tool):
  - `views.resolveRef` — route/loader doctest (`makeTestServer()`): resolves an
    existing card's title/type, reports `exists:false` for a missing ref.
  - `extractViewRefs` — pure-function doctest: literal `ref="…"` and
    `ref='…'` found; `ref={expr}` skipped.
  - `cb validate` view-ref walk — filesystem doctest (`makeTmpBox()`): a view
    referencing a missing card warns with the `view:<line>:<n>` path.
  - `cb mv` view rewrite — filesystem doctest: moving a referenced card rewrites
    the `ref="…"` in a `views/*.tsx`.
  - Compiler externalization — doctest/`cb view test` that a view importing
    `callback-box/view-widgets` compiles and resolves on the node path.
  - Surface behavior (companion vs browse vs page open-in-context) is layout/runtime
    and is verified via `bin/browse`, not doctested (per the chat-scroll precedent).
- **Documentation** — the `## Card-aware widgets` section + example are added to
  the **generators** (`src/core/views-doc-files.ts`, `views-doc-examples.ts`) and
  `docs/generated/views.md` is regenerated via `generate-docs`; a one-line entry
  is added to the scaffolded `views/CLAUDE.md` quick-ref
  (`box-templates.ts`). Docs land **with** the widgets (Track 6), never ahead of
  them. No always-loaded `viewsSection()` line is added (boxholder decision) —
  `views.md` is the primary, knows_about documentation.
- **Knowledge-audit entries** — the three above land with Track 6 and are **run**
  (against an absolute-path test box) after Tracks 3-4-6 are real; dated status
  recorded in the yaml before completion.
- **Migration** — none; the change is additive (new specifier, new global, new
  context, additional files scanned by validate/mv). Views authored before the
  widgets ship are unaffected.
