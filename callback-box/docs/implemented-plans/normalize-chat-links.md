# Normalize chat/card links

> **Superseded in part (2026-07-30).** This plan's `contextDir`-relative chat
> resolution is gone: chat message links, embeds, and images now all resolve
> from the box root, and the React context that carried the chat cwd into the
> renderer (`chat/chat-context-dir.ts`) was deleted with it. See
> `docs/plans/box-root-paths.md` (Track C) and
> `issues/decisions/2026-07-30-always-box-root-relative-links.md`. Everything
> else below still describes live behavior.

> **Implementation status (landed on this branch).** Tracks 1–6 + 8 are
> implemented, `pnpm test` green (2635), typecheck + lint + knip clean:
> parser/renderers (plain paths, `legacy-view` marker, generalized embeds),
> `contextDir`-relative resolution (syntactic, not the dropped server variant),
> `?view=`/param + companion-tab threading, standalone-view removal, CB001
> repurpose, instruction scrub + regenerated box docs, and `cb migrate-view-links`
> (applied to test1/ledger boxes; ledger `bill.tsx` converted to `rendersCardTypes`).
> The three knowledge audits (figure-embed, link-vs-embed, views-attach) **pass**
> against test1; `cb view lint` flags card-less `views/*.tsx`; the two card-less
> dashboards (`test1/views/todos.tsx`, `hearth-test/views/butterfly-closet.tsx`)
> were deleted. **Remaining:** live `bin/browse` verification (needs the shared
> dev router). Box repos hold uncommitted migrated content + view deletions for
> boxholder review.

Replace the bespoke `view:` URL scheme for referencing box files/cards in
markdown with native markdown link/image semantics:

- `[label](path)` — a **reference**. Clicking it opens the target in the
  companion pane (sidebar). No inline render.
- `![title](path)` — an **embed**. The target renders inline, frameless
  (`embed` mode). Images embed as images (unchanged); cards embed via their
  own viewer; this generalizes today's figure-only `![](view:…figure.card)`.

This is **normalization, not new behavior**: today a non-`zoom` `view:` link
*already* embeds the card inline (bordered `mode="chat"` in chat,
`FileView.tsx:362`; frameless `mode="embed"` for figures in card bodies,
`FigureEmbed.tsx:38`). The plan moves that embed onto the `!` image syntax,
generalizes it across figures and every other card type, settles the vocabulary
on **"embed"/"embedded"** (not "compact" — that word is only a renderer-toggle
styling prop, `FileView.tsx:217`), and makes the plain link mean "open in the
sidebar" (today's `?zoom` behavior, promoted to the default).

`view:` is dropped from the markdown link/image surface entirely (hard
cutover). The `?zoom` companion-panel flag is retired — a plain link *is* the
"open in companion" gesture now. Path resolution: the agent is instructed to
write box-root-absolute paths (`/store/…`) in chat. Resolution is **syntactic
and filesystem-like**, keyed on the chat `contextDir` (the Agent SDK cwd),
threaded to the renderer via a React context: a leading-`/` path is box-root
absolute; a bare `foo.card` resolves relative to `contextDir` — exactly how a
shell treats an absolute vs a relative path. (An earlier draft specified an
existence-based server contract — "try absolute, else retry against cwd." It was
dropped as over-engineering: it would make resolution async through many call
sites to rescue only the case of an agent writing a *bare* path *meant* as
absolute, which the "write absolute" instruction already avoids.) Existing
hand-authored box content that uses `view:` is migrated in place.

Alongside the syntax change, the plan **removes the standalone (card-less)
"view" surface entirely** — every view becomes a renderer attached to a card,
addressed `?view=foo` — and scrubs the instructions so the agent no longer knows
standalone views exist. This shrinks surface area (the boxholder's stated goal)
and is what lets the `view:` token disappear from the agent's world completely: a
bare view slug was the only thing that ever needed disambiguating from a path.
Discovery confirmed the removal is small and cleanly bounded (Track 8).

The motivation is concrete: the agent gets `view:` wrong constantly — the
codebase carries an entire markdownlint rule (CB001) whose only job is to catch
one class of that error — and the scheme buys nothing that markdown's own
link-vs-image distinction doesn't already express.

## Stated preferences this plan trades against

- **`callback-box/CLAUDE.md:` "Read before writing"** (Behavioral Notes):
  *"Don't guess file formats… Read the schema, read the existing code."* The
  plan reuses existing resolution (`resolveRelativePath`), existing repair
  (`cb relink` / `link-repair.ts`), and existing migration scaffolding
  (`scripts/migrate/`) rather than inventing parallel machinery.
- **`callback-box/CLAUDE.md:` "don't add features beyond what the task
  requires."** The plan removes a scheme and a flag; it must not grow the
  surface. The NOT-in-scope section is the gate.
- **`callback-box/CLAUDE.md:` "Keep source and docs generic — never hardcode
  personal names."** Instruction rewrites use "the user"/"the box"; the
  migration touches real boxes (ledger-copy) but writes no personal names into
  shared source.
- **`callback-box/code-style.md:` no default parameters; max 2 positional
  params; no `as` in `.tsx`.** New resolution/embed helpers follow these.
- **`callback-box/docs/testing.md`** — tests as a design tool; doctest the
  substantial new codepaths (the parser/resolver), not every line.
- **Monorepo `CLAUDE.md:` "NEVER disable or weaken a lint rule… Ask first."**
  This plan *changes* a custom rule (CB001) as a deliberate design act with the
  boxholder's sign-off recorded here — not a silent suppression. Retiring the
  old assertion is paired with adding a stronger one (catch leftover `view:`).

## What already exists

The redesign is mostly *subtraction* over infrastructure that already models
the target behavior.

- **`src/frontend/src/lib/view-url.ts:96-122` `resolveRelativePath`** — already
  does filesystem-style resolution: leading `/` → box-root
  (`view-url.ts:97`), otherwise resolved against a base dir, with an
  `attach/` special case. **Reuse** — this is the resolution primitive for both
  the absolute and (with `contextDir` as base) the cwd-relative fallback.
- **`src/frontend/src/lib/view-url.ts:138-147` `classifyMarkdownHref`** —
  already returns `view` / `relative` / `external`. **Reuse, minus the `view`
  arm.** The `relative` arm (`view-url.ts:146`) already carries plain paths;
  dropping `view` leaves relative paths as the card-link case with no new code.
- **`src/frontend/src/components/Markdown.tsx:117-136`** — the shared card-body
  renderer *already* intercepts `relative` links, resolves them against
  `ctx.basePath`, and hands them to `onNavigate` (`Markdown.tsx:118-130`).
  **Reuse** — card bodies need almost no change; deleting the `view` arm
  (`Markdown.tsx:98-116`) is the bulk of it.
- **`src/frontend/src/components/FigureEmbed.tsx:30-56`** — `![](view:…)` →
  inline `<FileView mode="embed">` for `.figure.card` paths. **Rebuild
  (generalize):** drop the `view:` gate (`FigureEmbed.tsx:34`) and the
  figure-only test (`FigureEmbed.tsx:22-24,36`); embed *any* resolved card/file
  path, images excepted. The `mode="embed"` frameless render
  (`FigureEmbed.tsx:38-49`) is exactly the "embedded mode" the plan wants.
- **`src/frontend/src/components/FileView.tsx`** — already has
  `mode: "page" | "chat" | "companion" | "embed"`. **Reuse** — no new mode.
- **`src/frontend/src/components/chat/markdown-rendering.tsx:133-175`
  `ChatLink`** — intercepts only `view:` today (`markdown-rendering.tsx:134`).
  **Rebuild:** intercept `relative` via `classifyMarkdownHref`, route a click to
  `onZoomView` (companion). The zoom-button branch
  (`markdown-rendering.tsx:140-150`) becomes the *default* link behavior; the
  inline-`FileView`-in-chat branch (`markdown-rendering.tsx:151-163`) is
  retired (its job moves to the `!` embed).
- **`src/frontend/src/components/chat/InteractiveChat.tsx:85,228`
  `effectiveContextDir`** — already computed and threaded into
  `InteractiveChatBody`. **Reuse** — it exists at the body level; the plan
  threads it down to `MarkdownContent` as the chat `basePath`.
- **`src/cli/commands/relink.ts` + `src/core/link-repair.ts`
  (`repairBoxLinks`)** — an established box-content link-rewrite command with
  dry-run + report. **Reuse as the migration vehicle** (or its close sibling):
  the `view:`→plain rewrite is a mechanical link transform of the same shape.
- **`scripts/migrate/*.ts` + `scripts/migrate/_warnings.ts`** — per-schema
  migrators with field-loss detection; `normalize-ref-keys.ts` is a direct
  precedent for a content-normalizing pass. **Reuse the harness** if the
  rewrite is run as a migration rather than through `cb relink`.
- **`src/core/markdown-lint-rules.ts:9-37` CB001 (`no-view-label-links`)** — the
  rule that exists solely because agents misplace `view:`. **Rebuild
  (repurpose):** retarget it from "`view:` in the label" to "`view:` at all —
  drop the prefix, link by plain path."

## Prior art (external)

- **SilverBullet `![path](path)` transclusions** —
  https://silverbullet.md/Transclusions — the exact proposed shape ships in a
  real tool: `![…](…)` embeds images *and* pages *and* sections
  (`![page#header](page#header)`); plain `[…](…)` stays a link; params control
  rendering. Confirms the design is not novel and the `!`-means-embed extension
  of markdown image syntax is a known, coherent pattern.
- **Obsidian embed/transclusion (`![[…]]`)** —
  https://forum.obsidian.md/t/correct-link-format-for-embedding-images/67352 —
  same `!`=embed convention over wikilinks (images, notes, block refs). We adopt
  the CommonMark-link flavor (`![](…)`) rather than wikilinks because our
  content is already standard-markdown files, but the semantic split is the
  established one.
- **CommonMark transclusion discussion** —
  https://talk.commonmark.org/t/transclusion-or-including-sub-documents-for-reuse/270
  — long-standing community treatment of `![](…)` as the natural transclusion
  extension point. No competing convention emerged that we'd be fighting.
- **No prior art found** for a runtime "try absolute path, fall back to a
  session cwd" resolution inside a markdown renderer — that fallback is specific
  to our chat/`contextDir` model and is designed here, not borrowed.

## Tracks / scope

Ordered by implementation dependency, then surface size. The parser/resolution
core unblocks the two renderer tracks; instructions, lint, and migration follow
once the syntax is real.

### Track 1 — Parser & resolution core (`view-url.ts`, `message-parsing.ts`)

**What.** Make the URL layer speak plain paths, not `view:`, and add the
absolute-then-cwd fallback.

**Why this needs to change.** Every renderer routes through
`parseViewUrl`/`classifyMarkdownHref`; the syntax change is meaningless until
these stop privileging `view:`.

**Direction.**
- `classifyMarkdownHref` (`view-url.ts:138-147`): remove the `view` arm
  (`view-url.ts:141`). Result narrows to `relative | external`. A relative
  path is the card/file reference; `http(s):`/`mailto:`/`#` stay external.
- `parseViewUrl` (`view-url.ts:38-70`): already tolerates a missing `view:`
  prefix (`view-url.ts:40`). Rename to `parseContentUrl` (keep a
  `parseViewUrl` re-export only if internal companion-serialization callers
  still need it — see NOT-in-scope). Stop treating `zoom` as meaningful:
  `?zoom` on a user path is ignored (not an error) so a missed migration
  degrades to "opens normally," not "breaks."
- **Resolution is syntactic (shipped), keyed on `contextDir`.** A leading-`/`
  path is box-root absolute; a bare `foo.card` resolves against the chat cwd —
  the existing pure `resolveRelativePath` already does exactly this (leading-`/`
  short-circuit at `view-url.ts:97`), so the only new work is *supplying* the
  base. Chat threads `effectiveContextDir` to `MarkdownContent` via a React
  context (`chat/chat-context-dir.ts`) and passes it as the shared renderer's
  `basePath`; card bodies keep their own `basePath` (the card's dir). No server
  round trip, no async resolution. (Codex flagged that the *earlier* draft's
  "retry in `FileView` on 404" had no home — true; that existence-based variant
  was dropped rather than built, since it only rescues an agent writing a bare
  path meant as absolute, which the instruction avoids.)
- `message-parsing.ts:262-263`: `VIEW_LINK_RE` is deleted; `MARKDOWN_IMAGE_RE`
  stays for lightbox extraction, extended so a card-embed `![](…card)` is *not*
  swept into the image lightbox list.
- **Visible (not silent) degradation for leftover `view:`.** After the `view`
  arm is gone, a stale `view:…` href would otherwise fall through
  `classifyMarkdownHref` as `external` (scheme match, `view-url.ts:143`) and
  render as a dead `<a href="view:…">` — legible but not obviously broken. Add a
  narrow `view:`-scheme branch in the renderers that draws a visibly-disabled
  "legacy link — needs migration" marker, so un-migrated content reads as broken
  on sight rather than as a silently-inert link. (Transitional; removable once
  all controlled boxes are migrated.)

**Vocabulary lock-ins.** The user-facing scheme prefix `view:` is removed from
all markdown — everywhere, including custom-view addressing (see Track 8), so
the token `view:` disappears from the agent's world entirely. The verb is
**"embed"/"embedded"** across prompts, docs, and schema instructions; "compact"
is not adopted as a mode name (it's only a toggle-styling prop,
`FileView.tsx:217`). One embed *semantic*, two surface chromes: frameless
`mode="embed"` in card bodies, the compact-header `mode="chat"` in chat (keeps
its open-in-sidebar button).

**First implementation chunk.** Delete the `view` arm from
`classifyMarkdownHref` and drop `zoom` from the parse result + `ViewTarget`
(`view-url.ts:21,54,61-62,78`); update `view-url.doctest.md` to the new
expected shapes. No open questions inside this chunk.

### Track 2 — Shared card-body renderer (`Markdown.tsx`, `FigureEmbed.tsx`)

**What.** Card bodies link and embed by plain path; embeds generalize beyond
figures.

**Why this needs to change.** Card bodies are where the bulk of stored `view:`
content lives (the ledger tax docs, the figure gallery); their renderer must
resolve the migrated plain paths and embed any card, not just figures.

**Direction.**
- `Markdown.tsx makeLink` (`Markdown.tsx:92-147`): delete the `view` arm
  (`:98-116`); the `relative` arm (`:117-136`) already resolves against
  `basePath` and navigates — it becomes the sole in-box link path.
- `FigureEmbed.tsx` → generalize to a content-embed component: key off the
  *resolved* path, not a `view:` prefix (`FigureEmbed.tsx:34`) or the
  `.figure.card` suffix (`:22-24,36`). Rule: image extension → default image
  (`makeImg`); otherwise → `<FileView mode="embed">`. Resolve the path via
  `resolveRelativePath(ctx.basePath, src)` first. The `<figure>`/`<figcaption>`
  wrapper (`:38-49`) stays for all embeds; `alt` is the caption.
- `makeImg` (`Markdown.tsx:149-172`) is unchanged for true images; the
  embed-vs-image fork lives in the generalized `FigureEmbed` overrides that card
  views opt into.

**First implementation chunk.** Delete `makeLink`'s `view` arm and confirm
card-body relative links still resolve+navigate (existing behavior, now the only
behavior) — a subtraction with an existing doctest anchor.

### Track 3 — Chat renderer (`markdown-rendering.tsx`, wire `contextDir`)

**What.** In chat, `[label](path)` click → companion pane; `![title](path)` →
inline embed; relative paths resolve absolute-first with `contextDir` fallback.

**Why this needs to change.** Chat is the surface the user named as broken and
the one that today intercepts *only* `view:` and passes plain relative links
through as dead anchors (`markdown-rendering.tsx:174`).

**Direction.**
- `ChatLink` (`markdown-rendering.tsx:133-175`): replace the
  `href.startsWith("view:")` gate (`:134`) with `classifyMarkdownHref`. A
  `relative` result renders a click-through that calls `onZoomView` (the
  companion pane) — generalizing the current zoom-button
  (`:140-150`). The current inline-`FileView` branch (`:151-163`) — today's
  chat embed — is **not deleted but relocated** to `ChatImg` under the `!`
  syntax; a plain link no longer renders inline.
- `ChatImg` (`markdown-rendering.tsx:123-132`): fork like Track 2 — image
  extension → `ChatInlineImage`; otherwise → an inline card embed via
  `<FileView mode="chat">` (the compact-header frame that already carries an
  open-in-sidebar button — the chat-surface chrome for the one "embed"
  semantic; card bodies use frameless `mode="embed"`). Video detection
  (`:126-128`) stays.
- **Wire cwd:** thread `effectiveContextDir`
  (`InteractiveChat.tsx:85,228`) down to `MarkdownContent`
  (`markdown-rendering.tsx:203`) and into the load-time resolver as the chat
  fallback base. Today chat passes `basePath: undefined`
  (`markdown-rendering.tsx:130`); it will pass `contextDir`.
- `ChatParagraph`'s image-only detection (`markdown-rendering.tsx:94-117`) must
  keep treating true images as images and *not* fold an embedded card into the
  centered-image layout.
- **Preserve viewer + params through link → companion → tab (Codex #3).** A link
  can carry `?view=` and other params (`[x](/store/X.card?view=foo&k=v)`), but
  today those are dropped or collide on the companion path: the panel mounts
  `FileView` with only `tab.target.path`
  (`InteractiveChat-controls.tsx:324`), and tab identity is keyed on
  `target.path` alone (`InteractiveChat-hooks.ts:26,31`), so two opens of one
  card with different `?view=` collide. Thread the full `ViewTarget`
  (path + viewer + params) into the companion mount (`FileView rendererName` +
  `params`), and key tabs on the **serialized** target (`serializeViewUrl`), not
  the bare path. This is real plumbing — not the "no new machinery" the earlier
  draft claimed — and it is shared with the figure-embed params path, so do it
  once here.

**First implementation chunk.** Swap the `ChatLink` gate to
`classifyMarkdownHref` and route `relative` → `onZoomView`; keep the embed fork
for a later chunk. No open questions inside this chunk (the `contextDir`
fallback is Track-1 machinery this chunk consumes, not redesigns).

### Track 4 — Instructions (`chat-session-prompts.ts`, `views-doc.ts`, `agent-guide/cards.ts`, `figure.ts`)

**What.** Teach the new syntax; delete the old.

**Why this needs to change.** The agent writes what the prompt teaches; leaving
`view:` in the prompt (`chat-session-prompts.ts:56`) guarantees continued
misuse and dead links post-cutover.

**Direction.**
- `chat-session-prompts.ts:54-60` "Showing things in chat": rewrite Links/Images.
  New Links line — plain link `[the plan](/store/notes/Plan.doc.card)` opens in
  the companion pane on click; to render inline, embed with
  `![the plan](/store/notes/Plan.doc.card)`. Drop the `view:` and `?zoom`
  sentences. Keep the box-root-absolute `/` guidance (`:58`) and state the cwd
  fallback in one clause.
- `views-doc.ts:144-210` "Showing Files in Chat" / "Inline vs Companion":
  rewrite to plain-path link vs `!`-embed; drop the `view:`/`?zoom` examples;
  keep `?view=` (force renderer) and figure params on the query string.
- `agent-guide/cards.ts:123-124`: delete the `view:`-in-label validation line
  (obsolete).
- `src/schemas/figure.ts:102-112` (Embedding): drop `view:` from the example —
  `![caffeine](/store/figures/Molecule.figure.card?molecule=H2O2)` — and keep
  the "frameless, alt is caption, params on query string" prose, which already
  describes the generalized behavior.

**Vocabulary lock-ins.** One sentence, repeated verbatim across surfaces:
*"Link a card with `[label](path)` (opens in the sidebar); embed it inline with
`![label](path)`."*

**First implementation chunk.** Rewrite `chat-session-prompts.ts:54-60` — the
primary, highest-traffic prompt.

### Track 5 — Lint (`markdown-lint-rules.ts`)

**What.** Repurpose CB001 from "`view:` in the label" to "`view:` anywhere in a
link/image — drop it."

**Why this needs to change.** Post-cutover, `[x](view:…)` renders as a dead
`<a href="view:…">` anchor and `![x](view:…)` as a broken `<img>` — **not** a
`FileView` broken-file state, and *nothing existing catches it*: CB002's
`isRelativePath` returns false for any scheme, so it skips `view:` today
(`markdown-lint-rules.ts:166-170`), and `cb relink` only repairs
CB002-classified internal links (`link-repair.ts:128`). So the lint net is
**work this track builds**, not existing safety (Codex #2 corrected the earlier
"lint catches it for free" claim).

**Direction.** Keep the CB001 id; change `VIEW_LABEL_RE`
(`markdown-lint-rules.ts:12`) to also match `](view:` (in both link and
`![…](…)` image forms); update `description`/`detail` (`:19,30`) to "drop the
`view:` prefix — reference by plain path." Also extend `isRelativePath`
(`markdown-lint-rules.ts:166-170`) — or add a dedicated CB001 case — so a
`view:` target is *classified as broken/internal* rather than silently skipped,
giving CB002/`cb relink` a hook. Then the plain paths this plan produces are
guarded by CB002 for free — broken card links get caught.

**First implementation chunk.** Retarget the regex + messages and update the
rule's doctest.

### Track 6 — Content migration (`link-repair.ts` / new migrate script)

**What.** Rewrite stored hand-authored `view:` content across real boxes:
`[l](view:X)` → `[l](X)`, `![c](view:X)` → `![c](X)`, strip `?zoom` (keep other
query params). Regenerated content (generated docs, box clones, doctests) is
*not* migrated — it falls out of Tracks 4/7.

**Why this needs to change.** Hard cutover: once the parser stops honoring
`view:`, un-rewritten stored content (e.g. the ~25 links in
`ledger-copy/store/documents/tax/2023/return-status.md`, the
`test1/store/figures/Figure_Gallery.doc.card` embeds) renders as dead
external-looking anchors.

**Direction.** A mechanical string transform of markdown link/image targets
(reuse `extractInlineLinks` from `markdown-lint-rules.ts:109-120` to find
targets with position info). Package as a `cb`-invocable pass with `--dry-run`
+ report, mirroring `cb relink` (`relink.ts:38-56`). Run it against `test1`
first (verify the figure gallery + any `store/` docs), then the ledger boxes.
`?zoom`-stripping and param-preservation are the only non-identity rules.

**Vocabulary lock-ins.** None — this is a data pass.

**First implementation chunk.** The pure transform function
`rewriteViewLink(url): string` with a doctest table covering: plain link, embed,
`?zoom` strip, `?view=`/param preservation, leading-slash, and a non-`view:`
passthrough. No open questions inside it.

### Track 7 — Tests & regeneration

**What.** Rewrite the parser/renderer doctests to the new syntax; regenerate
generated docs and the test-box clone.

**Direction.** `test/frontend/lib/view-url.doctest.md` (currently asserts
`view:` parsing/classification, e.g. `:76-77`) is rewritten to the plain-path
contract. `test/core/external-url-fetch.doctest.md:21` (`[card](view:store/a.card)`
"ignored") updates to the plain form. `docs/generated/views.md`,
`docs/generated/card-figure.md`, and the `~/src/boxes/test1` `.claude/rules/` +
`docs/generated/` clones regenerate from the Track-4 sources — no hand edits.

### Track 8 — Custom views become card-attached; remove standalone views

**What.** Settle custom-view *addressing* as `path?view=foo` (a renderer
attached to a card), remove the card-less "standalone view" surface entirely,
and scrub the instructions so the agent no longer knows standalone views exist.

**Why this needs to change.** The boxholder isn't using custom views and wants
them gone, to shrink surface area: *"Let's get rid of stand-alone views too… it
will also involve updating instructions so the agent doesn't know anything about
stand-alone views or try to implement them."* Removing the slug-addressed
card-less surface is also what lets `view:` vanish completely (a bare slug was
the only thing that needed disambiguating from a path).

**The discovery pass (below) found the surface is small and cleanly bounded:**
almost all view machinery — the `/api/views/:slug/{module.js,cards}` endpoints,
the `ViewRenderer` component, `view-bindings`, `view-host`, `view-widgets`, the
compiler — is **shared** with card-attached `rendersCardTypes` rendering and is
**preserved**. Standalone reachability is essentially one branch. Confirmed too:
`zoomed-view` already **cannot** carry a slug — `InteractiveChat.tsx:134-138`
builds it from a file-path `ViewTarget` via `serializeViewUrl`
(`view-url.ts:75-84`), so the doc example `view:ledger-overview?path=/` is
**stale/aspirational**, a doc fix not a code change.

**Direction — addressing (mechanism exists; params need threading — Codex #3).**
A custom view is selected by `?view=foo` on a card path — the `rendererName`/
`?view=` selector (`FileView.tsx:344,51`) and the `useCardViewBinding(data.type)`
priority-100 injection (`FileView.tsx:315-330`) both already exist.
`[label](/store/X.card?view=foo)` links it; `![label](/store/X.card?view=foo)`
embeds it. **But it is not "no new machinery":** the injected `ViewRenderer` is
mounted with `params={{ path }}` **hardcoded** (`FileView.tsx:322`), so a link's
`?view=foo&k=v` query params never reach the view. Add the threading — carry the
`ViewTarget.params` into `FileView` (a new `params` already exists on
`RendererProps`, `renderers/index.ts`, but the *bound-view* mount ignores the
link's params) and merge them into the `ViewRenderer` `params` alongside `path`.
This is the same viewer/param plumbing Track 3 adds on the companion/tab path;
land it once and reuse.

**Direction — code removal (delete only these regions; preserve everything
else):**
- `pages/ViewPage.tsx`: delete the **plain-slug branch** — the `looksLikeFilePath`
  slug fallthrough (`:41-48`), the `parsed.type === "slug"` render arm
  (`:63-71`), and the now-unused `ViewRenderer` import (`:14`). **Keep** the
  file-path branch (`:38-40,56-62`, the general `/views/<file-path>` full-page
  viewer that `useViewNavigate` targets) and the `viewRoute` registration
  (`router.tsx:139-143`).
- `ViewRenderer.tsx`: delete the `buildViewHost` `onNavigate`-omitted page-push
  fallback (`:142-146`) and make `onNavigate` **required** (`:100-106`) — the
  remaining mounts always pass it. The `mode==="chat"` "Open full page →" link
  (`:327-340`) is **not standalone-only** (Codex #4): `FileView` mounts
  *card-attached* bound views with `mode="chat"` too (`FileView.tsx:320`), so
  this tail also fires for them. Remove it and rely on `FileView`'s own chat
  chrome (which already carries an open-in-sidebar button) — a deliberate change
  affecting card-attached chat views, not an unnoticed side effect.
- **Extensionless-root routing hazard (Codex #5).** `looksLikeFilePath`
  (`ViewPage.tsx:23`) only treats paths with a `/` or a known extension as files,
  so a bare `/views/box` currently falls into the slug branch. Deleting that
  branch would strand root-level extensionless targets. Fix: after removing the
  slug branch, route the `else` to the file viewer (treat any non-file-looking
  splat as a file path too) rather than to a deleted code path — and add a
  doctest/`bin/browse` check for `/views/<bare-name>`.
- **Preserve (do NOT prune):** `webapp/routes/views.ts` (all three endpoints —
  shared), `webapp/trpc/routers/views.ts` (`resolveRef`, widget host),
  `lib/view-bindings.ts`, `lib/view-host.tsx`, `view-widgets/*`,
  `ViewErrorBoundary.tsx`, `hooks/useViewFileHelpers.ts`, `core/view-cards.ts`,
  `core/view-refs.ts`, `webapp/views/compiler.ts`, `cli/commands/view.ts` +
  `view-typecheck.ts`, `renderers/*`, `FileView.tsx` `?view=` path.

**Direction — instruction scrub (the agent must not know standalone views
exist):**
- `views-doc.ts`: intro "standalone pages" (`:12`), the "When to Create a View"
  dashboard framing (`:16-25`), the standalone `EstateOverview`/`params.path`
  example (`:37`), and the `zoomed-view="view:ledger-overview?path=/"` slug
  example (`:203`) → rewrite to card-attached-only; the existing "Do not use
  `view:` for custom view slugs" line (`:174`) becomes simply true.
- `views-doc-files.ts:131` (standalone `?path=` params doc, framed as mandatory
  scoping), `views-doc-examples.ts`, `agent-guide/chat.ts:58` ("standalone
  page… the unusual case" → *unsupported*, not "unusual"),
  `chat-session-prompts.ts:48,60,76`, `box-templates.ts` `VIEWS_CLAUDE_MD`
  (`:263-289`), `generate-docs-cb-commands.ts:135` (`cb view test` help wording).
  Regenerate every box's `docs/generated/views.md` + `views/CLAUDE.md`.
- **Existing knowledge audit expecting `view:` (Codex #6).**
  `src/dev/knowledge-audits.yaml:2901` has an audit that explicitly expects the
  `view:` form — it must be rewritten to the plain-path syntax (or retired),
  not just supplemented by the new audits in the Knowledge-audits section. A
  stale audit would "pass" by asserting the wrong convention.
- **Stale `zoomed-view` values (Codex #6).** `zoomedViewAttr`
  (`InteractiveChat.tsx:134`) serializes whatever the active target is; a
  hand-typed/stored `view:ledger-overview?path=/` becomes a *path-like* FileView
  target (a card that doesn't exist), not a working slug — so it fails visibly,
  not silently, but the doc examples that model it must go (covered by the
  `views-doc.ts:203` scrub above).

**Direction — data migration (existing box `.tsx` views).** Views are `.tsx`
files under `<box>/views/` (no schema/registry), so there's no data-shape
migration — but existing **standalone** view files 404 once the slug branch is
gone and must be converted or deleted (none currently declare
`rendersCardTypes`):
- `~/src/boxes/ledger-copy/views/bill.tsx`, `~/src/boxes/ledger-shrink-test/views/bill.tsx`
  — already `params.path`-filtered; add `rendersCardTypes: ["bill"]` to attach
  them to the bill card type.
- `~/src/boxes/test1/views/todos.tsx` (no backing card) and
  `~/src/boxes/hearth-test/views/butterfly-closet.tsx` (+ its worktree copy,
  `dependencies: []`) — pure standalone dashboards; convert to a
  `rendersCardTypes` renderer with a host card, or delete. `test1` is ours to
  fix as part of completion; the others are documented for their owners.
- Add a `cb` lint/check that flags any `views/*.tsx` lacking `rendersCardTypes`,
  so a card-less view is caught box-wide rather than 404-ing at runtime.

**Vocabulary lock-ins.** "Custom view" = a renderer attached to a card,
addressed `?view=`. There is no card-less view; the word "standalone" leaves the
agent-facing vocabulary.

**First implementation chunk.** Delete the `ViewPage.tsx` plain-slug branch
(`:14,41-48,63-71`) and confirm the file-path viewer + card-attached rendering
still mount (the two surviving `ViewRenderer` mounts). No open questions inside
it — the preserve/delete boundary is settled by the discovery pass.

## Subplans

None. The standalone-view removal — the one candidate for its own design step —
came back from discovery as a small, cleanly-bounded deletion (one `ViewPage`
branch + the `ViewRenderer` fallback + a shared chat tail, all backend/widget
machinery preserved), so it folds into Track 8 rather than needing a subplan.
The other sub-questions (resolution contract, embed generalization, content
migration) are settled inline; the absolute-then-`base` resolution is a
server-side route change (Track 1 Direction), decided, not open.

## Failure modes

**Critical gap:** none unresolved. The one silent-failure candidate (below,
"missed migration in an external box") is downgraded to a documented,
visible-in-UI degradation, not a silent one.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Chat bare path resolves against the wrong cwd (agent meant box-root) | `resolveContentTarget` doctest | Instruction: write `/`-absolute paths; bare falls back to cwd | Clear (visible broken-file UI if it misses) |
| A path exists BOTH as box-absolute and cwd-relative (collision) | New (resolver doctest) | Absolute wins by rule | Clear-but-surprising — documented in prompt: absolute is authoritative |
| `![](path)` where path is a non-image, non-card file (e.g. `.pdf`) | New (embed fork doctest) | `FileView mode="embed"` picks a renderer or a generic viewer | Clear |
| Un-migrated `view:` link in an external box we don't control | Migration doctest covers the transform, not the miss | Renderer draws a visibly-disabled "legacy link" marker (Track 1); CB001-repurposed + CB002-scheme-hook flag it on next lint | Clear (marked broken + lint warning), not silent |
| `?zoom` survives in un-migrated content | Parser doctest | Parser ignores `zoom` (Track 1) → opens normally | Clear (no crash; just no panel semantics) |
| Embedded card is itself broken/archived at render | Existing `FileView` load tests | `FileView` broken-file state | Clear |
| Lightbox sweep pulls a card-embed `![](…card)` into the image lightbox | New (message-parsing doctest) | `MARKDOWN_IMAGE_RE` consumer excludes card paths (Track 1) | Clear |
| Existing box standalone view (`views/*.tsx` sans `rendersCardTypes`) after slug branch removed | New (`cb` view-lint check) | Convert-or-delete in migration; `cb` lint flags stragglers box-wide | Clear (lint names the file), not silent |
| Removing `ViewRenderer` tails also breaks a card-attached mount | Manual `bin/browse` (both surviving mounts render) | Only the two identified standalone-only regions deleted; `onNavigate` made required so the compiler catches a missed caller | Clear (typecheck/compile error, not runtime) |

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — agent writes `[x](view:…)` from trained habit.
  **ADDRESSED:** CB001-repurposed (Track 5) flags it with the fix; the prompt
  rewrite (Track 4) removes the source of the habit; a knowledge audit verifies
  recall (Knowledge audits section).
- **Wrong link-vs-embed** — agent embeds (`!`) when it meant to link, or vice
  versa. **ADDRESSED (by design):** the failure is benign and legible — an
  unwanted inline render vs an unwanted extra click — and mirrors markdown's own
  image-vs-link intuition, so it's self-correcting. No validation needed.
- **Stale ref** — target moved/archived between write and read. **ADDRESSED:**
  existing CB002 (`markdown-lint-rules.ts:68-99`) flags broken plain links, and
  `cb relink` (`relink.ts`) repairs them — both now cover the plain-path form
  for free.
- **Two agents touching the same card** — not implicated; this plan changes link
  *syntax*, not card write paths. **ADDRESSED (N/A).**
- **Hand-edit drift** — boxholder hand-writes `![](view:…)` or `?zoom`.
  **ADDRESSED:** CB001-repurposed + parser tolerance (`?zoom` ignored) keep it
  legible; `cb relink`-style migration can re-run.
- **Fabricated free-form value** — not implicated; a link target either resolves
  or shows broken (design makes honesty checkable via CB002). **ADDRESSED.**
- **Validation error UX** — CB001-repurposed message must read well in agent
  context. **ADDRESSED:** the detail string names the exact fix ("drop `view:` —
  reference by plain path"), matching the existing terse-actionable style
  (`markdown-lint-rules.ts:30`).
- **Partial migration / transition state** — during rollout, the parser is
  cut over but some external-box content isn't migrated yet. **DEFERRED
  (documented):** the plan migrates the boxes we control (Track 6); external
  boxes degrade to visible dead links + lint warnings until their owner runs the
  migration. See Open design questions.
- **Agent tries to build a standalone view** — post-scrub the agent shouldn't
  know they exist. **ADDRESSED:** Track 8 removes standalone-view guidance from
  every instruction surface and reframes the agent-guide from "unusual case" to
  *unsupported*; the `cb` view-lint (Track 8) flags a card-less `views/*.tsx` if
  one is written anyway; a knowledge audit verifies the agent reaches for a
  `rendersCardTypes` renderer.

## NOT in scope

- **Internal `ViewTarget` serialization for companion-pane URL persistence**
  (`serializeViewUrl`, `?card=` URL param, `useCardUrlPersistence`). This is
  machine plumbing, not agent-authored markdown; it may keep its current
  encoding. Rationale: changing it is churn with no agent-facing benefit and
  risks the live-update equality contract (`view-url.ts:44-50`).
- **`view-widgets` React surface** (`CardLink`/`CardRef` in `.tsx` views). Those
  use `cardRef=` props, not markdown link syntax; unaffected. Rationale:
  different authoring surface, no `view:` string involved.
- **A rich hover/preview for links.** A link opens the companion on click;
  no hovercard. Rationale: not requested; adds surface.

## Open design questions

- **Fate of non-`test1` standalone box views.** `test1`'s `todos.tsx` is ours to
  convert/delete as part of completion. The ledger `bill.tsx` views are a
  one-line `rendersCardTypes` add; `hearth-test`'s `butterfly-closet.tsx` has
  no backing card at all. Lean: convert the ones with an obvious host card, and
  for the truly card-less dashboard, delete it (the boxholder confirmed they
  don't want standalone views) — but flag it before deleting someone's box
  content. The `cb` view-lint makes the stragglers visible either way.
- **External-box `view:` migration reach.** Do we ship a `cb` command boxholders run on
  their own boxes, or hand-migrate the known ones only? Lean: ship the command
  (Track 6 is already `cb relink`-shaped), run it on ours, document it for
  others.

## Knowledge audits

This plan introduces two agent-facing conventions, so per the default each gets
at least one `knows_directly` entry in `src/dev/knowledge-audits.yaml`:

1. **Link a card** — verify the agent recalls `[label](path)` (plain path, no
   `view:`) links a card and a click opens it in the companion pane.
2. **Embed a card/figure** — verify the agent recalls `![title](path)` embeds
   inline (frameless), that images embed as images, and that params ride the
   query string.

Two more worth including:

3. **Absolute-first paths in chat** — that the agent writes `/store/…`
   box-root-absolute paths by default. It's the exact thing the agent "gets
   wrong all the time," so verifying recall is high-value.
4. **Views attach to a card** (the *negative* of the scrub) — verify the agent,
   asked to build a view, reaches for a `rendersCardTypes` renderer on a card
   type and does **not** propose a standalone/card-less view. This audits that
   Track 8's instruction scrub actually took.

**Existing audit to rewrite, not just add to:** `knowledge-audits.yaml:2901`
already asserts the `view:` form (Codex #6). Rewrite it to the plain-path
convention (or retire it) — otherwise it "passes" by verifying the old, wrong
syntax.

These land **run**, not just written: execute
`pnpm knowledge-audit run --box <abs-path-to-a-throwaway-box> --filter <ids>`
(per memory: `--box` is a path and must not point inside the monorepo) and
record the status comments before the plan completes.

## Implementation order

1. **Track 1** parser/resolution core + `view-url.doctest.md` rewrite. Unblocks
   all rendering. (No dependency.)
2. **Track 2** shared card-body renderer + generalized embed. (Depends on 1.)
3. **Track 3** chat renderer + `contextDir` wiring. (Depends on 1; parallel to
   2.)
4. **Track 5** lint repurpose. (Independent of renderers; can land anytime after
   1's syntax decision — do it early so the transition net exists.)
5. **Track 4** instructions. (Depends on the final syntax from 1–3 being real,
   so the prompt teaches what the code does.)
6. **Track 8a (addressing + code removal)** confirm `?view=`-on-a-card-path
   routes through the existing `rendererName` path; delete the `ViewPage`
   plain-slug branch + `ViewRenderer` standalone tails (make `onNavigate`
   required); add the `cb` view-lint for card-less `views/*.tsx`; convert/delete
   `test1`'s standalone view. (Depends on 1's syntax; the slug-branch deletion is
   independent of the renderer tracks and can land early.)
7. **Track 8b (instruction scrub)** remove standalone-view guidance from
   `views-doc*.ts`, `agent-guide/chat.ts`, `box-templates.ts`,
   `generate-docs-cb-commands.ts`. Fold into Track 4's instruction pass so the
   prompt teaches only card-attached views. (Depends on 8a's decision being
   final.)
8. **Track 6** content migration. (Depends on 1's rewrite rule; run after 1–3 so
   a migrated box actually renders correctly. Run on `test1`, then ledger boxes.)
9. **Track 7** remaining doctests + doc regeneration. (Depends on 4/6/8b.)

Each track is one or a few commits on the worktree branch. The plan completes
when all tracks land; it ships (merges to `main`) only on the boxholder's
explicit signal — not before, and not track-by-track.

## Rollout shape

- **Test posture (tests first, as design tool per `docs/testing.md`):**
  - `test/frontend/lib/view-url.doctest.md` — rewrite to the plain-path
    contract: `parseContentUrl` of `store/x.md?view=source`, of a leading-slash
    path, of a param-carrying figure embed; `classifyMarkdownHref` returns
    `relative`/`external` (no `view`). This doctest *is* the Track-1 done-when.
  - New doctest for the migration transform (`rewriteViewLink`): the six cases
    in Track 6's first chunk. This encodes the migration's done-when as
    assertions, not "looks migrated."
  - New/updated doctest for CB001-repurposed (catches `](view:` in both link and
    image forms; passes on plain paths).
  - The absolute-then-cwd *fallback* is a `FileView` fetch behavior that layout
    doctests can't cover; verify it manually via `bin/browse` against `test1`
    (a link written cwd-relative resolves; an absolute one resolves) as part of
    the Track-3 chunk, per the chat-UI CLAUDE.md manual-verification norm.
  - Not doctested: the React render wiring itself (component overrides) — covered
    by the manual `bin/browse` pass, consistent with `docs/testing.md`'s
    "not for coverage's sake."
- **Knowledge-audit entries:** the two (or three) `knows_directly` entries above
  land **run** with the plan (Track 4/7 window), not deferred.
- **Migration approach:** scripted + `--dry-run`, `cb relink`-shaped
  (Track 6). Atomic per box (one commit per box's rewritten content). Boxes we
  control (`test1`, ledger) are migrated as part of plan completion; external
  boxes get the documented command. This is a real data-shape change to stored
  markdown, so it is part of completion — not a "gradual" tail that stops
  midway.
