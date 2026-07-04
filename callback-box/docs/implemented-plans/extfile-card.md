# `extfile` Card — an In-Box Pointer to a Live External File

> **Implemented (2026-06).** Shipped as Tracks A–D: the `extfile` schema
> (`src/schemas/extfile.tsx`) + lint (`src/core/card-lint.ts`), `cb extfile sync`
> (`src/cli/commands/extfile.ts`, `src/core/extfile-sync.ts`,
> `src/core/external-roots.ts`), the `ExtfileView` renderer
> (`src/frontend/src/components/ExtfileView.tsx` + shared `ExternalDocument` /
> `AttachedCommentary`), and commentary made attach-only
> (`src/schemas/commentary.tsx`, `CommentaryView`). The O7 strict-validation
> question shipped as the unknown-key lint *warning*. The `ia-review` box
> migration (plan step 7) remains a usage action against that external box.

A new frontmatter card type, `extfile`, that is a first-class in-box object
standing in for an external file (`file:` URL). It is the snapshot-less sibling
of `webpage`: no body, no frozen copy, no markdown extraction. The card holds
the `href` plus drift-detection metadata; the renderer fetches the live file on
each render and dispatches it to the registry renderer for that file type —
**text-renderable files only in MVP** (`.md` → markdown, source/`.txt` →
plaintext, i.e. renderers that consume `data.content`); image/PDF/binary are
deferred because those renderers re-fetch via the in-box `/api/files` route,
which can't serve an external path (see Track C and NOT in scope). Its purpose
is to let commentary attach to the *pointer*
(in the pointer's `.attach/` scope) instead of fusing an external target onto
each `commentary` card via `defaultHref`.

## Stated preferences this plan trades against

- `callback-box/CLAUDE.md:101` — *"Read before writing. Don't guess file
  formats, XML structures, or API shapes."* Every claim below cites `file:line`.
- `callback-box/CLAUDE.md` (Cards) — *"The current format is YAML frontmatter +
  markdown body (Phase 2)."* `extfile` is a frontmatter `cardSchema()`,
  registered in `cardSchemas[]` (`src/schemas/registry.ts:65`).
- `callback-box/CLAUDE.md` (Behavioral Notes) — *"don't add features beyond
  what the task requires."* The NOT-in-scope section is where this is bounded;
  the renderer reuses the existing external-fetch + registry-dispatch path
  rather than inventing one.
- `callback-box/CLAUDE.md` (Behavioral Notes) — *"Keep source and docs generic
  — never hardcode personal names."* `href` values are per-box card data
  (CLAUDE.md exempts *"per-box config, throwaway replies, and personal
  memory"*), so a `file:/Users/...` literal in an extfile card is fine; no
  literal path enters shared source.
- `callback-box/code-style.md` — no default parameters, max 2 positional params
  (named-params object beyond that), no `any`, no bare `catch {}`, custom error
  classes, files ≤300 lines.
- **Precedent — the commentary surface** (`docs/plans/box-commentary-surface.md`,
  shipped). This plan is a direct descendant: it reuses `resolveExternalRef` /
  `buildVersionMarkers` / `GET /api/external` (Track B of that plan) and the
  `{% source %}` `version="sha256:… git:…"` anchor vocabulary. The drift model,
  the threat model (localhost + dev-only + skip-permissions), the `href` (full
  URL, untracked) vs `ref` (in-box, `cb mv`-tracked) split, and the "render
  external content through the file-renderer registry" pattern are all settled
  there and inherited here.
- **Precedent — body-less metadata cards.** `extfile` carries no body, like
  `file` (`src/schemas/file.tsx`), `image`, `audio`, `gdoc` — *not* like
  body-bearing `webpage`/`doc`. The schema shape mirrors `file.tsx` (frontmatter
  only, no `body(z.string())`).
- `~/.claude/.../memory` — *"Never disable lint rules; fix the code or ask."*
  Applies to the new renderer, route changes, schema, and CLI command.

## What already exists

- **`webpage` card — the analog WITH snapshot. MIRROR-MINUS.**
  `src/schemas/webpage.tsx:20-75` is body-bearing (`body: body(z.string())`,
  line 34) and carries snapshot provenance (`frozen`, `source`, `captured`,
  `siteName`, `byline`, `excerpt`). `extfile` strips the body and the snapshot
  fields, keeping only the pointer + drift metadata. Rebuild (new schema), not
  reuse — the field sets barely overlap.

- **`file` card — the body-less schema shape. MIRROR.**
  `src/schemas/file.tsx:30-61` is a frontmatter-only `cardSchema` with no
  `body()` field, a nested metadata object, and a `createFileTemplate` helper
  (`file.tsx:77-98`). `extfile`'s schema + template follow this shape.

- **`resolveExternalRef` + `buildVersionMarkers` — REUSE verbatim.**
  `src/core/external-ref.ts:82-110` resolves a `file:` URL to a realpath under
  an allowlisted root (denylisting `.git/`, `node_modules`, `.env*`).
  `external-ref.ts:135-142` returns the version markers string
  (`sha256:<short-hex>` content hash + `git:<rev>` last-modifying-commit). These
  are the exact functions the `cb extfile sync` command and the card-lint check
  call. **Caveat — they do NOT return `size` or `mtime`** (only hash + git); the
  stamped `size`/`mtime` fields need a small extension (extend
  `buildVersionMarkers` or add a `statExternal` sibling), consumed only CLI-side
  by `sync` — not over the wire (Track B).

- **`GET /api/external` route — REUSE as-is.**
  `src/webapp/routes/api-external.ts:81-113` returns `{ contentBase64,
  contentType, markers }` for a `?href=` query. The extfile renderer fetches
  through this exact route. The renderer's drift check compares the stored
  `version` hash to the live `markers` hash — both already in the envelope, so
  **no envelope change is needed** (`size`/`mtime` are CLI-stamped, not surfaced
  live). **Dev-only:** mounted only when
  `NODE_ENV !== "production"` (`api-external.ts:9-11` doc; gated in `api.ts`), so
  live file rendering works in dev only — same limitation `commentary` external
  targets already have.

- **`rootsForBox` — REUSE, but EXTRACT.**
  `api-external.ts:72-75` reads the box's `externalRoots` (`box-config.ts:28`)
  and prepends the box root, realpath'd. It is a **private** function in the
  route file; `cb extfile sync` and any shared resolution need the same logic,
  so it must move to a shared module (e.g. `src/core/external-roots.ts`).

- **`ExternalDocument` — MOVE to a shared module.**
  `src/frontend/src/components/CommentaryView.tsx:54-71` fetches via
  `/api/external`, base64-decodes the bytes **as UTF-8**, builds
  `FileData {path, content}`, and renders through `getRenderers(filePath,
  fileData)[0]` (falling back to `<Pre>`). This is exactly the "defer to the
  linked file's own viewer" behavior the extfile renderer needs **for text
  files** — the content-in-memory shape only feeds renderers that read
  `data.content` (markdown, plaintext); see Track C for the binary limitation. It
  (and `useExternalTarget`, `CommentaryView.tsx:73-85`) are **private** inside
  `CommentaryView.tsx` (the file `renderers/commentary.tsx` is only 16 lines of
  registration). Because Track D removes commentary's external-target rendering
  entirely, these **move** to a shared module the extfile renderer
  owns/consumes. Real refactor.

- **`WebpageView` — MIRROR (the renderer shape).**
  `src/frontend/src/components/WebpageView.tsx` is the closest renderer cousin:
  it discovers `.commentary.card` files in the card's `.attach/` scope via
  `trpc.status.browse` (`WebpageView.tsx:91-96`), renders each
  (`CommentaryRemarks`, lines 42-69), and wires `onJumpToQuote` to search the
  rendered body pane then fall back to the frozen snapshot (lines 100-121). The
  extfile renderer is **WebpageView's structure** (commentary discovery +
  jump-to-quote against a body pane) **with the body pane replaced by
  `ExternalDocument`** (live external fetch + registry dispatch). The
  `attachDirForCard` helper (`WebpageView.tsx:28-37`) is reused verbatim.

- **Renderer registration — REUSE.**
  `src/frontend/src/renderers/webpage.tsx:11-15` registers via
  `registerCardRenderer("webpage", …)`. `extfile` gets a one-file twin.
  `getRenderers` dispatch (`src/frontend/src/renderers/index.ts:83-92`) is
  unchanged.

- **FileView is the host, not the renderer. CLARIFY.**
  `FileView.tsx:96-169` (`useFileData`) loads a `.card` path's frontmatter via
  `trpc.card.get` and dispatches to the registered renderer for its `tagName`
  (`FileView.tsx:283-296`). So FileView loads the *extfile card's frontmatter*
  and hands off to the extfile renderer; the extfile renderer then does the
  external fetch itself (like `WebpageView`/`CommentaryView`). FileView's text
  branch (`/api/files`, line 114) is **not** the reuse point — that fetches
  in-box files, not external ones.

- **card-lint dispatch — EXTEND (and trim).**
  `src/core/card-lint.ts:137-143` runs type-specific errors only for
  `commentary` today (`commentaryErrors`, lines 172-188). An `extfile` branch
  goes here (well-formed `file:` href, well-formed `sha256:` hash). Broken refs
  are already WARNINGS, not errors (`card-lint.ts:106-134`) — the extfile
  "href resolves under an allowlisted root / file exists" check follows that
  warning posture (machine-specific path; the deployed server won't have it).
  Track D **removes** the `defaultHref`-xor-`defaultRef` error from
  `commentaryErrors` (`card-lint.ts:172-183`), since those fields go away;
  `commentaryErrors` keeps only its Markdoc-body validation.

- **Schema → path-scoped agent rule — REUSE.**
  `src/core/init-rules.ts:103-117` writes `**/*.<type>.card` rule files from a
  schema's `instructions`. `extfile`'s instructions ride this tier-3 mechanism;
  `cb init` in the box regenerates `card-extfile.md`.

- **CLI subcommand shape — MIRROR.**
  `src/cli/commands/move.ts:11-` is a `commander` `Command("mv")` that calls
  into core. `cb extfile sync` follows this: a `Command("extfile")` with a
  `sync` subcommand, exported from `src/cli/commands/index.ts` and registered in
  `src/cli/index.ts:71-` via `program.addCommand`.

- **`{% source %}` version anchors — INTEROP.**
  `docs/plans/box-commentary-surface.md:288-299` defines the per-anchor
  `version="sha256:<short-hex> git:<rev>"` form, produced by
  `buildVersionMarkers`. The extfile card's stamped hash uses the **same
  function and form**, so a comment's anchor version is directly comparable to
  the pointer's stamped version — per-comment drift, not just per-file.

## Prior art (external)

The live-wrapper / `file:`-scheme / drift-via-content-hash design space was
already researched in `docs/plans/box-commentary-surface.md:171-210` (W3C Web
Annotation selectors, Hypothes.is fuzzy anchoring, Vite `server.fs.allow`
denylist hygiene, `git show` for cross-checkout diff). `extfile` reuses that
machinery wholesale, so that research carries over and is not re-run here.

One genuinely new sub-question — **what to stamp for drift detection on a
pointer** — has a well-known prior art:

- **Content hash vs. stat (size+mtime) for change detection** — the rsync /
  git-index model. `git` records `size` + `mtime` + `ctime` in its index as a
  *cheap negative* check (if size/mtime are unchanged the file is *assumed*
  clean) but treats the **content hash (the blob SHA) as authoritative**; rsync
  defaults to size+mtime as a fast heuristic and only falls back to a full
  checksum under `--checksum`. Reference: git index format
  (https://git-scm.com/docs/index-format) and rsync's `--checksum` semantics
  (https://download.samba.org/pub/rsync/rsync.1). **Lesson applied:** `mtime` is
  a *heuristic*, not a sound drift signal — it changes on a no-op `touch`, is
  not preserved identically across clones/checkouts, and the codebase already
  rejected an analogous weak signal (a worktree HEAD) in favor of the content
  hash as the drift primary (`external-ref.ts:126-134`,
  `box-commentary-surface.md:576`). So this plan makes **`hash` the
  authoritative drift signal** and treats `size`/`mtime` as informational
  display only (see Track A decision).

## Tracks / scope

Ordered by implementation dependency, then surface size.

### Track A — the `extfile` schema, metadata, and lint

**What.** A body-less `extfile` frontmatter card holding `href` (a full `file:`
URL), a human `title`, and stamped drift metadata. Plus the card-lint branch
that checks the href and hash shapes.

**Why this needs to change.** There is no card type that is *only* a pointer to
a live external file. `webpage` carries a body + frozen snapshot
(`webpage.tsx:34,32`); `file` points at an uploaded binary in the card's own
attach scope (`file.tsx:21-28`), not an external path. Modeling an external
source today forces `defaultHref` onto a `commentary` card
(`commentary.tsx:29`), which fuses the pointer to the remarks and can't use the
attach-commentary pattern.

**Direction.**
- Schema (`cardSchema("extfile", { fields, instructions })`, registered in
  `registry.ts:65`), **body-less** (mirror `file.tsx`, no `body()`):
  ```
  ---
  type: extfile
  href: file:/Users/ianbicking/src/callback-mono/callback-box/src/core/agent-guide/source.ts
  title: agent-guide source.ts        # optional human label
  version: "sha256:9f3a1c2b git:7ffeae4"   # stamped; drift primary
  size: 4096                          # optional, informational
  mtime: 2026-06-18T12:00:00Z         # optional, informational
  contains: ...                       # optional search fallback
  ---
  ```
- **`href` is a full `file:` URL.** Match the existing commentary convention —
  `box-commentary-surface.md:256,458` writes `file:/Users/...` (single-slash,
  no authority), and `new URL()` parses `file:/abs` and `file:///abs`
  identically (`external-ref.ts:84-93` reads `url.pathname`). **Lock in
  single-slash `file:/abs` to keep extfile and commentary cards visually one
  convention.** (Open question O1 if the boxholder prefers RFC `file:///`.)
- **Drift metadata — `version` (hash + git) is authoritative; `size`/`mtime`
  ride alongside.** Three stamped fields:
  - `version` — the exact `buildVersionMarkers` output (`sha256:… git:…`), named
    to match the `{% source %}` anchor attribute (`box-commentary-surface.md:288`)
    so the pointer's stamp is directly comparable to a comment's anchor; the
    `sha256:` part is the **drift primary**.
  - `size` (bytes) and `mtime` (ISO) — recorded so the card's git history reads
    as a version-log of an untracked file ("grew 4k→6k on this date"). They are
    **never consulted for drift** (the rsync/git lesson, Prior art: `mtime`
    changes on a no-op `touch`); `version`'s hash governs.
  - **Churn control (boxholder decision):** all three are stamped *together* and
    only when the **content hash changes**. `cb extfile sync` skips the rewrite
    entirely when the live hash equals the stored hash — even if `mtime` differs
    — so a touched-but-unchanged file produces no card diff. `mtime` therefore
    records "the file's mtime as of the last real content change we observed,"
    not "right now."
- card-lint `extfile` branch (`card-lint.ts`, beside `commentaryErrors`):
  - **error** if `href` is missing or not a parseable `file:` URL (pure check).
  - **error** if `version`/`hash` is present but not a well-formed `sha256:<hex>`
    marker set (pure check).
  - **warning** (not error) if the href doesn't resolve under an allowlisted
    root or the file is missing — matches the existing broken-ref warning
    posture (`card-lint.ts:106-112`); the path is machine-specific and the
    deployed server legitimately won't have it.
- Schema `instructions` (tier-3, path-scoped via `init-rules.ts`): what an
  extfile card is (a live pointer, not a snapshot), that `href` is a full
  `file:` URL gated by `externalRoots`, that `version` is stamped — never
  hand-edited and never silently refreshed (use `cb extfile sync`), and that
  commentary about the file lives in the card's `.attach/` scope with bare
  `{% source %}` anchors targeting the live file.

**Vocabulary lock-ins.**
- Card type literal `extfile`; file shape `*.extfile.card`. (`source` rejected —
  collides with the `{% source %}` tag; `file` taken by uploaded binaries,
  `file.tsx`.)
- Frontmatter keys: `href` (full `file:` URL, untracked by `cb mv`), `title`,
  `version` (`sha256:… git:…`, the drift primary), `size`/`mtime`
  (informational; stamped only when the hash changes).
- `href` form: single-slash `file:/abs/path`.

**First implementation chunk.** The schema file (with `size`/`mtime`/`version`
fields) + registry entry + the card-lint branch, with a pure-function doctest: a
valid extfile card parses; a missing/malformed `href` errors; a malformed
`version` errors; a well-formed href that doesn't resolve warns (not errors). No
renderer, no CLI yet.

### Track B — `cb extfile sync` (stamp-on-demand)

**What.** A CLI command that re-reads each named extfile card's `href`,
recomputes `version` (and `size`/`mtime` if adopted), and rewrites the card
frontmatter. Stamping also happens at create time; `sync` is the *only* other
path that updates the metadata.

**Why this needs to change.** The extfile card is an *envelope* — it has no body
of its own, so there is no clear, frequent "the agent edited this card" moment to
hang an automatic re-stamp on (boxholder decision: explicit sync is the right
model precisely because touch events are murky for a contentless pointer). The
metadata must therefore be refreshed by a deliberate command, not a hook.

**Direction.**
- `Command("extfile").command("sync")` taking optional `[path...]` (default: all
  `*.extfile.card` under the box). For each: resolve `href` via
  `resolveExternalRef` against `rootsForBox` (extracted shared helper); compute
  the live content hash.
  - **If the live hash equals the stored `version` hash, do nothing** — no
    rewrite, even if the file's `mtime` changed. This is the churn control: a
    touched-but-unchanged file never produces a card diff.
  - **If the hash differs (or the card was never stamped),** rewrite `version`,
    `size`, and `mtime` **together** (parse-mutate-reserialize via `yaml`, per
    `callback-box/CLAUDE.md` Cards).
  - Report per-card: `stamped` / `unchanged` / `unresolved`.
- Runs locally and calls the resolver/marker helpers **directly** (not via the
  dev-only `/api/external` route), so it works regardless of `NODE_ENV`.
- **`buildVersionMarkers` returns only hash + git today** (`external-ref.ts:135-142`);
  `size`/`mtime` are new. Extend it to also return `size`/`mtime`, or add a thin
  sibling `statExternal(absPath)` — one definition of "the file's stamped state"
  so create, sync, and the renderer's drift-check all agree.
- Extract `rootsForBox` from `api-external.ts:72-75` into a shared module both
  the route and this command import.

**Vocabulary lock-ins.** Command surface `cb extfile sync [path...]`.

**First implementation chunk.** Extract `rootsForBox` to the shared module
(route keeps working) and add `size`/`mtime` to the marker/stat helper, then the
`sync` command operating on an explicit path list, with a filesystem-tier
doctest (`makeTmpBox()` + a tmp file): (a) a card with a stale `version` →
`sync` rewrites `version`/`size`/`mtime` to match the file; (b) a card whose file
content is unchanged but whose `mtime` was bumped → `sync` reports `unchanged`
and writes nothing; (c) an unresolvable href is reported, not crashed.

### Track C — the `extfile` renderer

**What.** A renderer registered for `extfile` cards that fetches the live file
via `/api/external`, dispatches it to the registry-picked renderer, surfaces a
drift badge when the stored `version` ≠ the live markers, and surfaces commentary
from the card's `.attach/` scope with jump-to-quote against the rendered file.

**Why this needs to change.** Without a renderer the card type is inert. No
existing renderer both (a) fetches an external file live AND (b) surfaces
attach-scoped commentary — `CommentaryView` does (a) for `defaultHref` targets,
`WebpageView` does (b) over an in-box body. extfile needs both.

**Direction.**
- `renderers/extfile.tsx` registers `registerCardRenderer("extfile", …)` (twin
  of `webpage.tsx:11-15`); the view component lives in
  `components/ExtfileView.tsx` (same components/-for-appearance split as
  WebpageView/CommentaryView).
- The view = `WebpageView`'s structure with the body pane swapped for the
  extracted `ExternalDocument`:
  - read `href` + stored `version` from frontmatter;
  - fetch the live file via the extracted `useExternalTarget(href)`; render it
    through `ExternalDocument` (registry dispatch, `<Pre>` fallback) inside a
    `ref`'d pane so jump-to-quote can search it (mirror `pageBodyRef`,
    `WebpageView.tsx:100-121`).
  - **Text-renderable files only (MVP).** `ExternalDocument` decodes the bytes
    as UTF-8 and hands `{path, content}` to the renderer
    (`CommentaryView.tsx:63-70`). Only `markdown.tsx`/`plaintext.tsx` consume
    `data.content` (`markdown.tsx:10`, `plaintext.tsx:15`); `image.tsx:159`,
    `pdf.tsx:14`, `binary.tsx:30` instead re-fetch `${getApiBase()}/files/${data.path}`
    — the in-box route, which **cannot serve an external absolute path**. So in
    MVP the renderer dispatches text/source/markdown only; for an
    image/PDF/binary href it shows a "preview unavailable for this file type"
    notice (the metadata + commentary still render). Making renderers
    external-aware is deferred (NOT in scope).
  - **drift badge (card-level):** compare the stored `version`'s `sha256:` to the
    live envelope's `markers` `sha256:`; on mismatch paint a "stale — file changed
    since last sync (run `cb extfile sync`)" badge. This is net-new UI —
    CommentaryView only *displays* `markers` (`CommentaryView.tsx:106`); nothing
    in the frontend compares stored-vs-live today (grep: no `stale`/`drift`
    comparison exists).
  - discover `.commentary.card` in the attach scope (`attachDirForCard` +
    `trpc.status.browse`, reused from `WebpageView.tsx:28-96`); render each;
    bare `{% source %}` anchors jump to their span in the rendered live file pane
    via `findQuoteRange` (`WebpageView.tsx:106-118`).
  - **Per-comment drift is NOT inherited — it is new work, and MVP does not
    deliver it.** A comment's `{% source %}` anchor carries its own
    `version="sha256:…"`, but the current surface never compares it to the live
    file: external anchors render as a static chip whose version sits only in the
    hover title (`Source.tsx:169-172`), and jump-to-quote matches by quote text,
    not version (`Source.tsx:192`, `WebpageView.tsx:101`). So a synced extfile can
    show a clean card-level badge while an old attached comment is anchored to a
    superseded version. MVP ships **card-level** drift only; per-comment
    stale-anchor painting is deferred (NOT in scope / Open question O6).
- **Dev-only live render.** On the deployed server (`/api/external` unmounted)
  the file content shows "couldn't load (external rendering is dev-only)"; the
  card's metadata + attached commentary still render. Same limitation
  commentary external targets already have.

**Vocabulary lock-ins.** None new (consumes Track A's fields).

**First implementation chunk.** Extract `ExternalDocument` + `useExternalTarget`
from `commentary.tsx` into a shared module (CommentaryView keeps working — verify
with `bin/browse` on an existing commentary card), then a minimal `ExtfileView`
that renders the live file through it (no drift badge, no commentary yet) —
"open an extfile card, see the live file." Drift badge and commentary surfacing
are follow-on chunks in this track.

### Track D — make `commentary` attach-only (remove external/in-box targeting)

**What.** Remove `commentary`'s ability to carry its own target — drop the
`defaultHref`, `defaultRef`, and `targets` frontmatter keys, the
`CommentaryView` branches that render external/in-box/compare targets, and the
`defaultHref`-xor-`defaultRef` lint rule. After this, a `commentary` card is
**always** attach-scoped: it lives in a host card's `.attach/` scope and its
bare `{% source %}` anchors target the containing card (an `extfile`, `webpage`,
or in-box `doc`). Then migrate the existing consumers.

**Why this needs to change.** With `extfile` as the first-class "external file"
card, `commentary.defaultHref` is a second, redundant way to point at an external
file — an IA smell. The boxholder confirmed there is **no remaining use case for
commentary's standalone external/compare support** worth maintaining, so this is
a removal, not a deprecation. **Nothing sets `defaultHref`/`defaultRef`/`targets`
programmatically** (no hits in `src/` outside the commentary files themselves),
so no connector or capture flow breaks.

**Unknown-key lint warning (landed in this branch — O7).** Removing the fields
makes an unmigrated card *surface* its leftover keys, because this branch added an
unknown-frontmatter-key check to card-lint as a **warning**
(`src/core/card-lint.ts`, `unknownKeyWarnings`). Load stays lenient — unknown keys
are stripped in memory (`card-io.ts:142`), so a drifted card still loads, renders,
and indexes (it shouldn't vanish just because it's mid-migration). The leftover
`defaultHref`/`defaultRef`/`targets` is reported by `cb validate` and the
PostToolUse hook (which surfaces warnings, `validate.ts:163-166`) so it gets
cleaned off disk. So **no bespoke commentary-specific guard is needed** — the
generic unknown-key warning covers it. (`content-type` was added to
`GLOBAL_CARD_FIELDS` so the check doesn't false-positive on XML-bodied cards.)
A missing *required* field or wrong type still errors at parse, as before.

**Direction.**
- **Schema** (`src/schemas/commentary.tsx:21-41`): delete `defaultHref`,
  `defaultRef`, `targets`. Keep `title`, the captured-page metadata
  (`source`/`captured`/`frozen` — still used as a header), and `body`. Rewrite
  the `instructions` to state commentary is always attach-scoped (no default
  target field; the containing card is the implicit target).
- **Renderer** (`src/frontend/src/components/CommentaryView.tsx`): remove the
  external `TargetPane`/`ExternalDocument`/`useExternalTarget` path (lines
  54-120, **moved** to the shared module in Track C, not deleted), the in-box
  `InboxTargetPane`/`InboxDocument`/`useInboxTarget` path (lines 122-191), the
  `targetHrefs` compare layout (lines 194-205, 292-299), and the `defaultRef`
  "Saved page" block (lines 300-319). What remains is the commentary-body render
  + the captured-page meta header — i.e. the `CommentaryRemarks`-shaped
  body-only view (which is also what the extfile/webpage hosts embed).
- **Lint** (`src/core/card-lint.ts:172-188`): remove the
  `defaultHref`-xor-`defaultRef` error; `commentaryErrors` keeps only its
  Markdoc-body validation. No removed-field guard is needed — the generic
  unknown-key warning (above) already flags a leftover
  `defaultHref`/`defaultRef`/`targets` via `cb validate` and the PostToolUse hook.
- **`extfile`/`webpage` schema `instructions`:** state the principle —
  *commentary attaches to a first-class card (`extfile`/`webpage`/`doc`) in its
  `.attach/` scope; for a single external file, make an `extfile` and attach the
  commentary there.*
- **Migration (in-repo consumers, this worktree):**
  - `test/card-lint.doctest.md` and `test/migrate-webpage-card.doctest.md` —
    drop/replace the `defaultHref`/`defaultRef` assertions.
  - test1 box seeded review cards (`store/reviews/IA_Plan`,
    `Review_Resolver`, `Compare_Plans`.commentary.card) — convert the
    single-target ones to `extfile` + attach-commentary; the `Compare_Plans`
    compare card has no attach-only equivalent and is **dropped** (demo data; no
    use case per the boxholder).
- **Migration (out-of-repo, later):** the `ia-review` box's 11
  `*.commentary.card` files under `~/src/boxes/ia-review/store/prompts/` each
  become an `extfile` pointer with remarks moved into its `.attach/` scope; the
  `_Prompt_Review_Index.doc.card` and `Prompts.landmark.card` are repointed.
  Executed against the real box after the code lands (it isn't in this worktree).

**Vocabulary lock-ins.** `commentary` loses `defaultHref`/`defaultRef`/`targets`;
the card type is henceforth attach-only.

**First implementation chunk.** The schema field removal + lint-rule removal +
`CommentaryView` simplification + the two in-repo doctest updates, landing
together so `cb validate` and the renderer stay green. Depends on Track C having
moved `ExternalDocument` to the shared module first. The `ia-review` and test1
box migrations are usage actions, sequenced after.

## Subplans

None. The one candidate — a side-by-side **compare view** over multiple external
files — is being *removed* with `commentary.targets` (Track D), not redesigned:
the boxholder confirmed no remaining use case. If cross-file compare ever returns,
it would be a fresh plan (a commentary referencing N `extfile` cards, the
renderer dereferencing each pointer's `href`, column layout); it is not a
dependency of this one.

## Failure modes

> **Threat model (inherited, not a critical gap).** `extfile` reuses the
> dev-only, localhost-only, allowlisted external resolver
> (`box-commentary-surface.md:82-87`). The boxholder runs agents with
> `--dangerously-skip-permissions` (full machine read already). The path guard
> is hygiene, not a hardened boundary; not gold-plated beyond the existing
> traversal/denylist doctest in `external-ref`.

> **Accepted documented risk (not a blocking gap):** per-comment drift —
> an attached comment anchored to a superseded file version — has no test and no
> handling in MVP and fails silently. Accepted because the **card-level** stale
> badge already signals "this file changed, re-check the comments," which bounds
> the harm to "re-read," not "act on wrong info." Per-comment painting is the
> first follow-on (Open question O6) once the card-level signal proves too blunt.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| `href` points at a file changed since last `sync` (drift) | Yes — renderer drift-badge functional test on the marker pair (Track C) | Yes — stored `version` `sha256:` vs live `markers` `sha256:`; mismatch paints stale | Clear (stale badge) — *the core case; silent here = confidently-wrong commentary* |
| `href` escapes the allowlist via `../`/symlink, or is denylisted (`.git/`, `.env*`) | Yes — existing `external-ref` doctest (`box-commentary-surface.md:573`) | Yes — `resolveExternalRef` realpath + `path.relative` + denylist → `ExternalRefError` 404 | Clear (renderer "target unavailable"; lint warns) |
| `href` resolves nowhere (file removed / outside roots / wrong machine) | Yes — Track A lint doctest (warn) + Track B sync doctest (reported) | Yes — lint WARNING, `sync` reports unresolved, renderer shows unavailable | Clear (warning, not a commit block — machine-specific by design) |
| extfile card rendered on the deployed server (`/api/external` unmounted) | Yes — covered by existing route-gating doctest (`box-commentary-surface.md:579`) | Yes — fetch 404 → renderer "external rendering is dev-only"; metadata + commentary still render | Clear (degraded, explained) |
| `version` hand-edited to a malformed marker | Yes — Track A lint doctest | Yes — card-lint `sha256:` shape error | Clear (lint error) |
| `cb extfile sync` runs while the file is mid-write | No | None — reads whatever bytes are present | Silent-ish (next `sync` corrects it; sync is explicit + non-racy per the few-byte window, matching `box-commentary-surface.md:524`) |
| Attach-scoped commentary's bare `{% source %}` quote no longer matches the live file | Partial — relies on jump-to-quote returning false | `findQuoteRange` returns null → no jump (`WebpageView.tsx:106-118`) | Clear (jump silently no-ops, the existing webpage behavior) |
| Attach comment anchored to an *older* file version than the synced pointer (per-comment drift) | No (deferred) | **None in MVP** — the anchor `version` is shown only in a hover title (`Source.tsx:169-172`); no anchor-vs-live compare exists | **Silent (accepted, documented)** — card-level badge flags the file changed; per-comment painting is deferred (O6). The badge tells the reader "re-check the comments," which bounds the harm |
| Unmigrated `commentary` card still carries `defaultHref`/`defaultRef`/`targets` after Track D | Yes — `card-lint` unknown-key doctest | Yes — unknown-key lint warning (`card-lint.ts` `unknownKeyWarnings`); load strips the keys so the card still renders; warning surfaced by `cb validate` + PostToolUse hook | Clear (lint warning) — *card stays usable; warning drives the on-disk cleanup* |
| extfile `href` points at an image/PDF/binary (renderer can't load external bytes via `/api/files`) | Yes — Track C renderer test | Yes — MVP shows "preview unavailable for this file type"; metadata + commentary still render | Clear (degraded, explained) |
| File's `mtime` bumped (no-op `touch`) but content unchanged | Yes — Track B sync doctest case (b) | `cb extfile sync` compares the content hash, finds it equal, and writes nothing — `mtime` is not re-stamped on its own | Clear (no card diff, no false stale — *the reason hash, not mtime, is the drift signal*) |

The only no-test/no-handling/silent codepath is per-comment drift, flagged above
as an accepted documented risk (card-level badge bounds the harm). All other
codepaths are clear.

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — agent tries to put `defaultHref` on a commentary
  card. **ADDRESSED** — the unknown-key lint warning (`card-lint.ts`
  `unknownKeyWarnings`) flags it via `cb validate` and the PostToolUse hook (the
  card still loads, the key is stripped); the schema `instructions` point the
  agent at the extfile + attach-commentary pattern.
- **Stale ref** — `href` points at a file removed/moved after the card was
  written. **ADDRESSED** — `resolveExternalRef` errors cleanly; renderer shows
  unavailable; lint warns (Failure-modes rows 2-3).
- **Two agents touching the same card** — concurrent edits to one extfile card
  or its attach-commentary. **DEFERRED** — same as any card; not reconciled
  beyond git. extfile cards are tiny pointers; the contended object is the
  attach-commentary, which inherits the commentary single-writer assumption
  (`box-commentary-surface.md:704`). See Open questions.
- **Hand-edit drift** — boxholder hand-edits `version` or `href`.
  **ADDRESSED** — card-lint checks both shapes (Track A); a hand-set `version`
  that doesn't match the file simply reads as stale until `cb extfile sync`,
  which is the intended "explicit re-stamp" behavior.
- **Fabricated free-form value** — agent invents `version` instead of measuring.
  **ADDRESSED by making honesty easy** — `version` is computed by
  `buildVersionMarkers` at create + `cb extfile sync`, never authored; the
  schema `instructions` say so explicitly.
- **Validation error UX** — does a bad extfile card read well to the agent?
  **ADDRESSED** — the lint branch names the offending field (missing/malformed
  `href`, malformed `version`), surfaced through the existing `cb validate
  --hook` PostToolUse path (`callback-box/CLAUDE.md` Validation).
- **Partial migration / transition state** — Track D removes
  `defaultHref`/`defaultRef`/`targets` in one commit, so an un-migrated card in
  any box would fail validation against the new schema. **ADDRESSED** — the
  in-repo consumers (two doctests + the three test1 review cards) are migrated in
  the *same* chunk as the removal (Track D first chunk); the out-of-repo
  `ia-review` box is migrated immediately after, before the plan ships. No
  long-lived bilingual window: the field is gone and its (few, all hand-authored)
  consumers move with it.

## NOT in scope

- **Snapshot / frozen copy of the external file.** That is exactly what
  `webpage` is for; extfile is deliberately live-only (the boxholder's choice —
  comments anchor to what the agent actually loads). Drift is detected via
  `version`, not prevented via a copy.
- **Markdown extraction / a stored readable body.** extfile is body-less; the
  live file renders through the registry renderer for its type. No Defuddle-style
  extraction (that's webpage's job).
- **Image / PDF / binary extfile targets (rendered preview).** The reuse path
  (`ExternalDocument` → `{path, content}`) only feeds renderers that read
  `data.content` (markdown, plaintext); `image.tsx`/`pdf.tsx`/`binary.tsx`
  re-fetch via the in-box `/api/files/${data.path}` route, which can't serve an
  external path. MVP renders text/source/markdown; binary previews need
  external-aware renderers (a separate change). The card still works as a pointer
  for those types (metadata + commentary); only the inline preview is unavailable.
- **Per-comment stale-anchor painting.** MVP detects drift at the card level
  (the file changed since last sync); it does not yet compare each `{% source %}`
  anchor's `version` to the live file and paint individual comments stale. That
  surface (`Source.tsx` external chips, jump-by-quote) has no version-compare
  today; building it is the first follow-on (O6).
- **In-pane selection → new attached commentary.** Authoring commentary by
  selecting text in the rendered live file and pushing it to chat depends on the
  `ref`→`href` selection pipeline the commentary plan left unfinished
  (`box-commentary-surface.md:54`; capture is ref-only,
  `selection-serialize.ts:69`, `FileView.tsx:264`). extfile **surfaces** existing
  attach-commentary and renders the live file; it does not deliver in-pane
  selection capture. The agent authors bare-anchor commentary by synthesis /
  hand-edit (the existing path), which needs no `href` per anchor.
- **Multi-target / side-by-side compare.** A pointer is single-target, and
  Track D removes `commentary`'s `targets` compare too (no use case). A
  compare-over-extfile-refs design would be a fresh plan, not part of this one.
- **Live-rendering `http(s):` extfile targets.** Same boundary as the commentary
  plan (`box-commentary-surface.md:645`): `file:` is the immediate need; web
  targets ride the same `href` vocabulary without the fetch/sanitize/iframe work.
- **Production exposure of `/api/external`.** Stays dev-only; extfile live render
  is a dev affordance. Metadata + commentary render everywhere.
- **Auto-refresh of `version` on view or on wakeup.** Explicitly rejected — a
  silent re-stamp erases the drift signal. Only create + `cb extfile sync` stamp.
- **`size`/`mtime` as drift signals.** Stored (if adopted) for human display
  only; `hash` is authoritative (Prior art / rsync-git lesson).

## Open design questions

- **O1 — `file:/abs` vs `file:///abs`.** **Lean: single-slash `file:/abs`**, to
  match the existing commentary cards (`box-commentary-surface.md:256,458`); both
  parse identically (`external-ref.ts:84-93`). Revisit only if the boxholder
  prefers the RFC `file:///` form as canonical. Minor; settle during Track A.
- **O2 — metadata fields — SETTLED (boxholder).** `version` (`sha256:… git:…`,
  the authoritative drift signal, named to match `{% source %}` anchors) **plus**
  `size` and `mtime`, so the card's git history reads as a version-log of an
  untracked file. `size`/`mtime` are informational, never used for drift. Churn
  control: `cb extfile sync` rewrites all three together and only when the
  **content hash changes** — a bumped `mtime` with unchanged content writes
  nothing.
- **O3 — the deprecation decision — SETTLED (boxholder).** `extfile` **replaces**
  `commentary`'s external/in-box targeting. `commentary` becomes attach-only;
  `defaultHref`/`defaultRef`/`targets` and their render/lint paths are removed
  (Track D). No remaining use case for standalone external/compare commentary.
- **O4 — is `extfile` searchable?** A pointer has little indexable content.
  **Lean: `searchable: false`** (or rely on `title`/`contains` only), like
  pointer-ish metadata cards. Minor; settle during Track A.
- **O5 — does removing `commentary.defaultRef` orphan any "saved page" card?**
  The `defaultRef` "Saved page" render path (`CommentaryView.tsx:300-319`) is only
  hand-set (no programmatic writer), and webpage commentary already lives
  attach-scoped (`WebpageView`). **Lean: safe to remove**; verify during Track D
  by grepping all reachable boxes for `defaultRef` on a `commentary` card before
  deleting the branch (the test1 grep found only the seeded review cards).
- **O6 — per-comment drift painting (deferred follow-on).** Should MVP ship only
  the card-level stale badge, or also compare each anchor's `version` to the live
  file and paint individual comments stale? **Lean: card-level only for MVP**
  (the badge already says "re-check the comments"); build per-comment painting if
  the coarse signal proves too blunt. Requires new version-compare wiring in
  `Source.tsx` (today external chips show `version` only in a hover title,
  `Source.tsx:169-172`).
- **O7 — unknown-frontmatter-key handling — SETTLED & LANDED (this branch).**
  Considered strict-at-parse (`.strict()`), but rejected: it errors at *load*,
  which drops drifted cards from search (`refresh-file.ts:94`) and lists them as
  "unknown" (`state.ts:112`) — a fundamentally-fine card with one stray key
  shouldn't vanish (boxholder). Final design: **load stays lenient** (unknown keys
  stripped in memory, `card-io.ts:142`, so the card still loads/renders/indexes)
  and an **unknown-key lint warning** (`card-lint.ts` `unknownKeyWarnings`)
  surfaces the drift via `cb validate` + the PostToolUse hook so it's cleaned off
  disk eventually. `content-type` added to `GLOBAL_CARD_FIELDS` (the one
  cross-cutting key read raw, `card-io.ts:144`) so the check doesn't
  false-positive on XML-bodied cards. Required-missing / wrong-type still error at
  parse (unchanged). Verified: cardworks 521/521, callback-box 2171/2171. This
  supersedes any per-type removed-field guard in Track D.
- **Concurrent-writer reconciliation** — deferred (see edge cases); revisit only
  if attach-commentary stops being single-writer.

## Knowledge audits

`extfile` is an agent-facing card type (the agent creates extfile cards and
attaches commentary to them). Per the commentary precedent
(`box-commentary-surface.md:708-722`), the synthesis-and-card conventions there
were **skip-by-default** because they load from path-scoped schema
`instructions` exactly when a matching card is touched (`init-rules.ts:103-117`)
— a compaction that drops the detail self-heals on the next card touch. The same
reasoning applies here: an agent that never opens an extfile card never needs the
convention, and one that does gets `card-extfile.md` loaded.

**Recommendation: one optional `knows_directly` audit** — that an extfile card
is a *live pointer with drift detection*, not a snapshot (i.e. the agent doesn't
conflate it with `webpage`), and that `version` is stamped via `cb extfile
sync`, never hand-edited. Everything else: skip-with-rationale (path-scoped rule
covers it). If written, it lands **run** (`pnpm knowledge-audit run --box
<test-box> --filter extfile`) with the status recorded, per the skill rule.

## Implementation order

1. **Track A chunk** — `extfile` schema + registry entry + card-lint branch +
   instructions, with the pure-function lint doctest. Unblocks everything;
   net-new, breaks nothing.
2. **Track B chunk** — extract `rootsForBox` to a shared module; `cb extfile
   sync` over an explicit path list, with the filesystem-tier doctest. Depends
   on A (the card type exists to stamp).
3. **Track C extract chunk** — pull `ExternalDocument` + `useExternalTarget`
   out of `commentary.tsx` into a shared module; verify CommentaryView still
   renders (`bin/browse`). Pure refactor; depends on nothing in A/B but
   sequenced here as the renderer's prerequisite.
4. **Track C renderer chunk** — minimal `ExtfileView` rendering the live file
   through the extracted module. Depends on A (fields) + the extract chunk.
5. **Track C drift + commentary chunk** — drift badge (stored vs live `version`)
   and attach-scope commentary surfacing with jump-to-quote. Depends on chunk 4.
6. **Track D removal chunk** — strip `defaultHref`/`defaultRef`/`targets` from
   the commentary schema, simplify `CommentaryView`, remove the xor lint rule,
   add the attach-only guidance to the `commentary`/`extfile`/`webpage`
   `instructions`, and migrate the two in-repo doctests + the three test1 review
   cards in the same commit. Depends on the Track C extract chunk (so
   `ExternalDocument` has already moved out of `commentary.tsx`).
7. **Usage (not a code chunk)** — re-run `cb init` in `ia-review`; rearrange its
   11 commentary surfaces onto extfile + attach-commentary; update the index +
   landmark. Against the real `~/src/boxes/ia-review`, after the code lands.

The plan completes when chunks 1-6 land; it ships (merges to main) only on an
explicit signal, per cb-plan's no-partial-ship rule.

## Rollout shape

- **Test posture.** Following the commentary plan's "real coverage" override
  (`box-commentary-surface.md:748`), each new codepath lands with a doctest in
  its chunk:
  - **Unit (pure-function):** extfile schema parse + card-lint
    (valid / missing href / malformed href / malformed version / warn-on-
    unresolved) — Track A.
  - **Functional (filesystem, `makeTmpBox()`):** `cb extfile sync` stamps the
    correct `buildVersionMarkers` output and reports unresolved hrefs — Track B;
    the drift-badge comparison (stored vs live markers ⇒ stale) as a unit on the
    marker pair — Track C.
  - **Renderer:** the full `ExtfileView` visual (live render + drift badge +
    commentary) is dogfood-verified via `bin/browse`, the same posture
    commentary used for its browser-only parts (`box-commentary-surface.md:769`).
- **Knowledge-audit entries.** At most one optional `knows_directly` (see
  Knowledge audits); everything else skip-with-rationale.
- **Migration.** `extfile` is net-new and additive. `commentary` is a
  **breaking schema change** (Track D removes three fields), but the consumer set
  is tiny and entirely hand-authored — two in-repo doctests + three seeded test1
  review cards (migrated in the removal commit) and the 11 `ia-review` cards
  (step 7). All hand-done by the agent, atomic per box, not scripted; there is no
  programmatic writer of the removed fields, so no code-side migration. Done
  before the plan ships (no partial-migration window).
- **No lint-rule changes.** Per CLAUDE.md/memory, the new renderer, route
  extraction, schema, and CLI conform to the rules; if a rule fights the code,
  raise it, don't disable it.
