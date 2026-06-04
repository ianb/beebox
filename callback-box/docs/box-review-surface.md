# In-box Review Surface for Out-of-Box Files

A Callback Box capability for viewing, selecting, and commenting on files
that live **outside** the box — repo docs and source, including the same
logical file across multiple git worktrees — from inside a dedicated box.
A new `review` card wraps one or more live external targets; its body is
agent-and-user commentary anchored into those targets via a `{% source %}`
tag extended to carry position and version. The boxholder reads/selects in
the browser and pushes selections through chat (the existing
selection-commentary path); the box agent synthesizes those selections into
durable, anchored commentary; a developer working in the wrapped worktree
reads that commentary back out of the box.

This is also the first concrete artifact of the larger output-vocabulary IA
pass (see the dogfooding note in **Tracks**): it exercises all three doc
loading tiers and consolidates two anchoring tags into one.

## Stated preferences this plan trades against

- `callback-box/CLAUDE.md:101` — *"Read before writing. Don't guess file
  formats, XML structures, or API shapes."* Every claim below cites a
  `file:line`.
- `callback-box/CLAUDE.md` (Behavioral Notes) — *"HTTP endpoints go in tRPC
  by default... Raw Fastify routes... are only for things that don't fit the
  tRPC request/response shape: SSE/streaming, file upload/download..."* The
  external-file read is a file-download shape, so it extends the raw
  `routes/api-files.ts` family rather than tRPC — traced in Track B.
- `callback-box/CLAUDE.md` (Behavioral Notes) — *"Keep source and docs
  generic — never hardcode personal names."* The `wt:` ref scheme and the
  allowlist must be expressed in terms of resolved roots, not
  `/Users/ianbicking/...` literals.
- `callback-box/CLAUDE.md` — *"don't add features beyond what the task
  requires."* This plan is large; the **NOT in scope** section is where it
  earns its bound (fuzzy re-anchoring, prod exposure, diff view, prefix/suffix
  selectors all deferred).
- `callback-box/CODE-STYLE.md` — no default parameters, max 2 positional
  params (named-params object beyond that), no `any`, no bare `catch {}`,
  custom error classes, files ≤300 lines.
- **Precedent — `{% quote %}` / `{% source %}` work.** The shipped
  selection-commentary feature (`docs/selection-commentary.md`) and the
  agent-guide tier-2 sections (`src/core/agent-guide/source.ts`,
  `quotes.ts`) are the densest preference for how a body-anchoring tag is
  shaped and documented. Track A extends `{% source %}` rather than minting a
  new tag, per that precedent.
- **Precedent — `gdoc` external-content card** (`src/schemas/gdoc.tsx`): a
  card that stands in for content sourced elsewhere. The `review` card is its
  live-filesystem cousin; we mirror its frontmatter-metadata + `content.ref`
  shape (Track C).
- `~/.claude/.../memory` — *"Never disable lint rules; fix the code or ask."*
  Applies to the new frontend renderer and server route.

## What already exists

- **Selection capture, position, and `<user-selection>` serialization —
  REUSE.** Selection capture is wired once at the FileView level, wrapping
  whatever renderer is active:
  `src/frontend/src/components/FileView.tsx:283-285`: *"const body =
  onAddSelection === undefined ? rendered : `<SelectionCapture
  onCapture={handleCapture}>{rendered}</SelectionCapture>`"*. So selecting
  inside a wrapped-target pane needs no new capture code — only a per-pane
  `ref`. The serialized form is built at
  `src/frontend/src/lib/selection-serialize.ts:69-73`: *"return
  `<user-selection ref="${escapeAttr(selection.ref)}"${positionAttr}${placementAttr}>${escapeText(selection.text)}</user-selection>`"*
  — attributes `ref` (required), `position` (optional), `placement`
  (voice-only). The position grammar is assembled at
  `src/frontend/src/lib/selection-position.ts:47-62` (`formatPosition`):
  clauses `section`, `heading: TEXT (#id)`, `paragraph N`, `~line N`, joined
  with `"; "`, all optional. **Reuse** this whole stack; Track A makes
  `{% source %}` able to carry the durable subset of these.

- **The `source` Markdoc tag — EXTEND.** `src/shared/markdoc-config.ts:133-149`
  defines `source` with exactly two attributes: *"ref: { type: String,
  required: true }, as: { type: String }"* — **no** `position`, `version`,
  or hash attribute today. Track A adds them.

- **Box file-serving + sandbox guard — EXTEND (do not weaken).**
  `src/webapp/routes/api-files.ts:67-69` confines reads to the box root:
  *"if (!resolved.startsWith(path.resolve(boxRoot))) { return
  reply.status(403).send({ error: "Access denied" }); }"*. The live wrapper
  needs to read **outside** boxRoot — so it is a **new, separately-gated
  resolver**, not a relaxation of this guard (Track B).

- **Worktree enumeration — REUSE.** `bin/router.ts:55-56` defines the roots
  (*"WORKTREES_ROOT = path.join(os.homedir(), "src", "callback-worktrees")"*),
  `resolveWorktree(name)` maps a name → absolute path
  (`bin/router.ts:103`, `:116`), and `discoverWorktrees()`
  (`bin/router.ts:548-566`) enumerates them. The `wt:` resolver reuses this
  mapping rather than re-deriving paths.

- **Card schema registration + path-scoped instruction rules — REUSE.**
  Frontmatter schemas register in `src/schemas/registry.ts:63-89`
  (`cardSchemas[]`). A schema's `instructions` becomes a path-scoped agent
  rule at `cb init`: `src/core/init-rules.ts:102-117` writes
  `**/*.<type>.card` rule files. The `review` card's synthesis guidance
  rides this tier-3 mechanism (Track D).

- **External-content card precedent — MIRROR.** `src/schemas/gdoc.tsx`:
  pure-frontmatter metadata + a `content.ref` pointing at the renderable
  body. `review` mirrors the metadata-card shape but resolves targets live
  rather than from an attach copy.

- **Renderers — REUSE.** `src/frontend/src/renderers/` has `markdown.tsx`
  and `plaintext.tsx`; a wrapped `.md` renders via the former, a wrapped
  `.ts` via the latter. No code/syntax renderer is built and none is in scope.

## Prior art (external)

Searched; all five returned useful results.

- **W3C Web Annotation Data Model** — https://www.w3.org/TR/annotation-model/
  (§4.2 selectors). Anchors store an **array** of selectors and consumers
  pick the most precise that still resolves. `TextQuoteSelector` = `exact` +
  `prefix` + `suffix` (position-independent, survives edits elsewhere);
  `TextPositionSelector` = `start`/`end` char offsets (exact but brittle).
  This is the canonical justification for `{% source %}` carrying **both** a
  quoted `exact` (the tag body) and a `position`, plus a `version` — multiple
  selectors, preferred-then-fallback.
- **Hypothes.is "Fuzzy Anchoring"** — https://web.hypothes.is/blog/fuzzy-anchoring/.
  Persists three selectors and re-anchors in fallback order (range → position
  → context-fuzzy → quote-fuzzy), using a fork of Google's `diff-match-patch`
  for approximate matching when the exact quote no longer matches. Directly
  validates the drift story — and tells us the **full** fuzzy re-anchor is a
  real chunk of work, so MVP detects drift (version mismatch) and flags;
  fuzzy re-anchoring is explicitly deferred (subplan candidate).
- **CriticMarkup** — https://fletcher.github.io/MultiMarkdown-6/syntax/critic.html.
  Inline editorial markup incl. comment `{>> ... <<}` attached after a
  highlight `{== ==}`. Considered as the inline-comment syntax and **rejected
  for the backbone**: it mutates the document, which our wrapped targets are
  read-only against (see NOT in scope). Recorded because it's the obvious
  alternative a reviewer will ask about.
- **Vite `server.fs.allow` / `server.fs.deny`** —
  https://vite.dev/config/server-options.html#server-fs-allow. The accepted
  pattern for a dev server reading outside its root: an **allowlist of
  canonicalized roots**, read-only, plus a denylist for secrets (`.env`,
  `.git/`). Its CVE history (`?raw` suffix bypass GHSA-9cwx-2883-4wfx, `//`
  CVE-2023-34092, case-insensitive-fs, trailing-backslash) all share one
  thread: they bite only when the dev server is network-exposed, and they
  come from blocklist matching gone subtly wrong. Lessons folded into Track B:
  realpath before matching, allowlist of resolved root prefixes (not a
  blocklist), strip query suffixes, read-only, localhost/dev-only.
- **Cross-worktree diff** — no specialized standard; worktrees are just
  checkouts, so the established primitive is `git show <ref>:<path>` per side
  fed to your own renderer (https://www.gitkraken.com/learn/git/git-diff).
  Confirms the compare view is "render N targets in columns," and a true
  highlighted diff is a separate, deferrable concern.

## Tracks / scope

Ordered by implementation dependency, then surface size.

**Dogfooding note (applies to all tracks).** The output-vocabulary IA pass
this worktree exists for asks: which emittable tag is documented in which of
three loading tiers (chat system prompt / always-loaded agent-guide /
path-scoped schema instructions). This plan *is* an instance: Track A is a
tier-2 vocab change (`agent-guide/source.ts`), Track D is a tier-3
path-scoped instruction (`review` schema), and the finished surface is then
used to review the IA design docs themselves. Build order is also the
cheapest way to feel where the tier rule is unwritten.

### Track A — `{% source %}` as the unified, version-aware anchor

**What.** Extend the existing `source` Markdoc tag with two optional
attributes — `position` and `version` — so a single tag expresses everything
the durable part of `<user-selection>` expresses (where it came from, where
in the doc, the exact words in the body) **plus** which version it was
anchored against. Update the tier-2 agent guide (`source.ts`) accordingly.

**Why this needs to change.** Today `{% source %}` carries only `ref` + `as`
(`markdoc-config.ts:134-136`), while `<user-selection>` carries `ref` +
`position` (`selection-serialize.ts:70-72`). The review body needs the
*union* — a persisted comment must say which span (`position`), quote the
span (body text), and pin the version so drift is detectable. Without a
single superset tag, the box agent would have to invent an ad-hoc shape when
turning a selection into commentary.

**Direction.**
```
{% source ref="wt:chat-output-ia:callback-box/docs/box-review-surface.md"
          position="body; heading: Track A (#track-a); paragraph 2; ~line 210"
          version="git:7ffeae4 sha256:9f3a…"  /* one or more kind:value markers */
          placement="estimated, ~50% through the message"  /* present only when the anchor's position was approximate */
          as="commentary" %}
the exact span the user selected
{% /source %}
```
- `position` — same freeform grammar as `formatPosition`
  (`selection-position.ts:47-62`); reused verbatim so the chat selection and
  the persisted source share one position string.
- `version` — **a set of one or more version markers**, space-separated,
  each `"<kind>:<value>"`. This mirrors the W3C "array of selectors, prefer
  the precise one, fall back" pattern. Two kinds matter at MVP:
  - `git:<rev>` — when the target is tracked (the rev is the one in the
    *callback-mono* repo, since worktrees share its history). Cheap to store,
    and **diffable** — a later viewer can `git show <rev>:<path>` to show what
    changed (the deferred diff-view becomes much cheaper with this marker
    present).
  - `sha256:<hash>` — always available, and the only marker that pins a
    **dirty/uncommitted** worktree file's exact on-disk bytes. The git rev
    identifies the committed baseline; the hash identifies what was actually
    on disk when the anchor was made.

  A purely external resource with no git history carries only `sha256:`. A
  tracked file can carry both. On view, the renderer checks markers in
  preference order (git rev if present, else hash); any mismatch ⇒ flag the
  anchor "may be stale" (the `data_through`/freshness shape from
  `docs/prompt-audits.md` §"Cache freshness"). Re-anchoring on mismatch is
  **not** in this track.
- `placement` — carried verbatim from `<user-selection>` when present
  (`selection-serialize.ts:71`). On a durable annotation it is a **provenance
  marker**: it records that the anchor's position was *estimated* (a
  voice-grabbed selection whose exact spot was lost and dropped by rough
  timing), so a reader treats the `position` as approximate rather than
  exact. Omitted ⇒ the position is exact. The value phrasing ("through the
  message") is composer-flavored but preserved as-is rather than re-minted.
- The tag body remains the quoted `exact` (W3C `TextQuoteSelector.exact`).
  `prefix`/`suffix` selectors are deferred (NOT in scope).

`{% source %}` is therefore a true superset of `<user-selection>`'s
attributes (ref, position, placement, quoted body) **plus** the multi-marker
`version`.

**Vocabulary lock-ins.**
- Attribute names: `position` (not `pos`/`loc`), `version`, `placement`,
  matching the existing `ref`/`as` register.
- `version` value format: a space-separated set of `"<kind>:<value>"` markers
  (e.g. `git:<rev>`, `sha256:<hex>`); the `kind:` prefix makes the set
  open-ended (new marker kinds can be added without a new attribute), and
  values are truncatable for display.
- The position string grammar is owned by `formatPosition`; `{% source %}`
  consumes it, never re-specifies it. `placement` is owned by the selection
  serializer; `{% source %}` carries it, never re-specifies it.

**First implementation chunk.** Add `position`, `version`, and `placement` to
the `source` schema in `markdoc-config.ts` (attributes only, all optional, no
behavior change to existing `ref`/`as` callers); thread them through the
`SourceInline`/`SourceBlock` render rename the same way `ref`→`sourceRef` is
handled (`markdoc-config.ts:144-145`); extend `agent-guide/source.ts` with a
short "anchoring an existing span (position, version markers, placement)"
subsection; one doctest asserting a `{% source %}` with all attributes —
including a multi-marker `version="git:… sha256:…"` and a `placement` — parses
and validates. No open questions inside this chunk.

### Track B — `wt:` external ref scheme + gated live-read resolver

**What.** A symbolic ref scheme `wt:<worktree>:<repo-relative-path>` and a
single resolver that maps it to an absolute path under an **allowlist** of
canonicalized roots, reads the file **read-only**, and is **mounted only in
dev**. A new download-shaped route serves the bytes to the viewer.

**Why this needs to change.** The viewer can only target box-relative paths
today, and the box file route hard-confines to boxRoot
(`api-files.ts:67-69`). Wrapping a live repo file — across worktrees —
requires reading outside boxRoot, which nothing currently permits.

**Direction.**
- **Scheme.** `wt:<name>:<repo-rel>` where `<name>` resolves via the router's
  known roots: `discoverWorktrees()` for worktree names
  (`bin/router.ts:548-566`) → `WORKTREES_ROOT/<name>/` (`:55`, `:103`), and a
  reserved `main` token → the main checkout root. (Resolving `main`'s on-disk
  path is the one detail to settle — see Open questions.)
- **Resolver (server).** A new helper — call it `resolveExternalRef(ref)` —
  that: parses the scheme; rejects anything not `wt:`; builds the candidate
  path; `fs.realpath`s it; verifies the realpath `startsWith` one of the
  allowlisted resolved roots (the same `startsWith`-after-resolve shape as
  `api-files.ts:67`, but against the roots allowlist instead of boxRoot);
  refuses `.git/`, `.env*`, and node_modules (denylist, per Vite); returns a
  custom `ExternalRefError` on any failure (CODE-STYLE: custom error classes,
  no bare catch). Read-only — no write counterpart.
- **Route.** A raw Fastify route (file-download shape, per the tRPC-vs-raw
  rule in CLAUDE.md) e.g. `GET /api/external/:ref` returning the bytes +
  content-type, **registered only when a dev/review flag is set** (so the
  deployed server at `/opt/callback/` never mounts it). Strip query suffixes
  before resolving (Vite `?raw` lesson).
- **Allowlist.** Resolved roots: `WORKTREES_ROOT` and the main checkout root.
  Expressed as resolved prefixes, never personal-name literals (CLAUDE.md
  generic-source rule).

**Vocabulary lock-ins.**
- Ref scheme literal: `wt:<name>:<path>`. `main` is the reserved worktree
  name for the primary checkout.
- The resolver is the **only** code that turns a `wt:` ref into a filesystem
  path; viewer and synthesis never construct paths themselves.

**First implementation chunk.** `resolveExternalRef` + its allowlist/denylist
+ `ExternalRefError`, as a pure-ish function with a doctest covering: valid
worktree ref, `main` ref, traversal attempt (`wt:x:../../etc/passwd` → realpath
escapes allowlist → error), denylisted path (`.git/config` → error), unknown
worktree → error. Route mounting comes in a later chunk; the resolver has no
open questions.

### Track C — the `review` card + viewer renderer

**What.** A `review` frontmatter card type whose `targets:` list names one or
more `wt:` refs to render, and whose body is commentary. A `review.tsx`
renderer resolves each target via Track B, renders it (markdown/plaintext)
in its own pane, renders the commentary body, and wires per-pane
SelectionCapture so a selection reports the **target's** `wt:` ref.

**Why this needs to change.** "View and select an out-of-box file in the box
UI" has no current surface — FileView renders one box-relative `path`
(`FileView.tsx:42-60`). The review card is the in-box, addressable handle
that makes external targets viewable, selectable, and comment-anchored in one
object.

**Direction.**
- **Schema** (`cardSchema("review", …)`, registered in
  `registry.ts:63-89`): `targets:` — array of `{ ref: string (wt:…),
  label?: string }`; the body is freeform Markdoc commentary. Frontmatter
  declares the canvas (so an empty review card still shows its targets to
  select against); body `{% source %}` tags annotate into them. Multi-file
  and cross-worktree both fall out of `targets:` being a list — wrapping the
  same repo-rel path under `wt:main` and `wt:<name>` puts the two versions
  side by side.
- **Renderer** (`renderers/review.tsx`): one column per target; each column
  renders the resolved content through the existing markdown/plaintext
  renderer and is wrapped in `SelectionCapture` (reusing
  `FileView.tsx:283-285`) whose `onCapture` stamps that column's `wt:` ref;
  a commentary pane renders the body, and each `{% source %}` anchor links to
  its span in the matching column. `version` mismatch on a live target paints
  the affected anchors as stale.
- **Selection → composer.** A captured selection serializes (today's path) as
  `<user-selection ref="wt:…" position="…">text</user-selection>` — `ref` is
  now a `wt:` ref instead of a box path; everything downstream is unchanged.

**Vocabulary lock-ins.**
- Card type literal: `review`; file shape `*.review.card`.
- Frontmatter key: `targets` (array), each `{ ref, label? }`.

**First implementation chunk.** The `review` schema + registry entry + a
minimal `review.tsx` that renders a **single** target (no compare, no
commentary anchoring yet) through the existing renderer behind the Track-B
route — i.e. "open a review card, see one live external file." Multi-column
compare and anchor-linking are follow-on chunks within this track. No open
questions in the single-target chunk.

### Track D — synthesis behavior + box usage

**What.** The `review` schema's `instructions` (tier-3, path-scoped to
`*.review.card`) telling the agent how to turn an incoming
`<user-selection ref="wt:…">` into durable `{% source %}`-anchored commentary
in the card body — including computing `version`. Plus the one-time usage
step: stand up the dedicated review box and create review cards over the IA
design docs.

**Why this needs to change.** The capability (A–C) is inert without the agent
knowing *what to produce*. Per the conversation, this synthesis is the actual
"new functionality," and it's an output-vocabulary instruction — what the
review agent may emit — so it belongs in the path-scoped schema-instruction
tier that loads exactly when a `review` card is touched
(`init-rules.ts:102-117`).

**Direction.**
- Schema `instructions`: when a `<user-selection>` against a `targets:` ref
  arrives, append/update a `{% source %}` block in the body — body = the
  user's exact selected span; copy `position` (and `placement`, if any) from
  the selection; add `version` markers measured at synthesis time — `git:<rev>`
  when the target is tracked plus `sha256:<hash>` of the live bytes (the
  few-seconds synthesis window is not racy, per the boxholder); the agent's
  own remark goes as prose adjacent to (not inside) the `{% source %}` (mirrors
  `agent-guide/source.ts`'s "your framing is yours, the tag marks what came
  from elsewhere"). One review card per coherent review target-set.
- Box usage: a dedicated persistent box at `~/src/boxes/<name>/` (served at
  `/main/<name>/`), seeded with review cards whose `targets:` point at this
  worktree's IA docs via `wt:chat-output-ia:…`.

**Vocabulary lock-ins.** None new; consumes A's tag and C's card.

**First implementation chunk.** Write the `review` schema `instructions`
prose + at least one `knows_directly` knowledge-audit entry (see Knowledge
audits). The box-standup is a usage action, not a code chunk.

## Subplans

- **Fuzzy re-anchoring of stale `{% source %}` anchors.** When `version`
  mismatches, MVP only flags. Actually *re-finding* the span (Hypothes.is's
  range→position→context-fuzzy→quote-fuzzy fallback with diff-match-patch) is
  its own design with its own vocabulary (which selectors to persist:
  prefix/suffix? offsets?) and its own failure modes. Spin
  `docs/source-reanchoring.subplan.md` if/when drift-flagging proves too
  blunt. Parent ships with flag-only behavior; the subplan is not a
  precondition.

No other sub-question is large enough to need its own design step.

## Failure modes

> **Critical gap (resolved in-plan):** Track B external resolver — a
> traversal or symlink escape that read an arbitrary file off the developer's
> disk would be silent (the bytes would just render). Resolved by:
> realpath-before-match against an **allowlist** of resolved root prefixes
> (not a blocklist), query-suffix stripping, secret denylist, read-only, and
> dev-only mounting — Track B Direction. A doctest asserts the traversal and
> denylist cases error (Track B first chunk).

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| `wt:` ref escapes allowlist via `../` or symlink | Yes — Track B chunk doctest | Yes — realpath + allowlist `startsWith`, `ExternalRefError` 403 | Clear (403) |
| `wt:` ref names a removed/unknown worktree | Yes — Track B doctest | Yes — `discoverWorktrees()` miss → `ExternalRefError` | Clear (resolver error; viewer shows "target unavailable") |
| Wrapped target edited since anchor (`version` marker mismatch) | To add — Track C | Yes — re-check markers (git rev preferred, else hash) on view, paint anchor stale | Clear (stale flag) — *this is the core drift case; silent here would be confidently-wrong commentary* |
| Target has no git history, only `sha256:` marker available | n/a (expected for external resources) | Hash marker alone still detects drift; no diff affordance | Clear (drift flagged; diff-view simply unavailable for that target) |
| Markers match but `position` line drifted (any byte change flips both git rev and hash) | Partial | Marker check catches it (any committed or on-disk change ⇒ mismatch ⇒ flag) | Clear (over-flags rather than under-flags — safe direction) |
| Selection over a `.ts` (plaintext) target → `position` is line-only | n/a (degraded, not failure) | `formatPosition` tolerates missing heading/paragraph (`selection-position.ts:47-62`) | Clear (weaker anchor + quoted body still present) |
| Dev route accidentally mounted in prod | To add | Dev/review flag gates mounting; deployed server never sets it | Clear (route 404 in prod) |
| Review card body hand-edited with malformed `{% source %}` | Inherited | `cb validate` runs Markdoc validation on card load (CLAUDE.md validation contract) | Clear (validation error) |
| Two agents edit one review card concurrently | No | Same as any card; not reconciled | DEFERRED (see edge cases) |

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — agent uses `{% quote %}` where
  `{% source %}` was right. **ADDRESSED** — `agent-guide/source.ts` already
  draws the quote-vs-source line ("whose exact words" vs "where it came
  from"); Track A's guide edit extends it for the position/version case.
- **Stale ref** — a `targets:` ref points at a file/worktree removed after
  the card was written. **ADDRESSED** — Track B resolver errors cleanly;
  renderer shows "target unavailable" per the Failure-modes row.
- **Two agents touching the same card** — review card edited by the box chat
  agent and (hypothetically) a background agent at once. **DEFERRED** — no
  reconciliation beyond git; review cards are expected to be single-writer
  (the chat agent during a review session). Cited in Open questions.
- **Hand-edit drift** — boxholder hand-writes `{%source%}` (no spaces) or a
  bad `version`. **ADDRESSED** — Markdoc validation on load (CLAUDE.md
  validation contract); a malformed tag fails `cb validate` rather than
  rendering wrong.
- **Fabricated free-form value** — agent invents `version` or `position`
  rather than measuring. **ADDRESSED by making honesty easy** — `version` is
  computed from the live target (Track D synthesis), not authored;
  `position` is copied from the selection string, not invented. The one
  free-form field, `as`, already has the "describe reality, don't enum-fit"
  guidance in `agent-guide/source.ts`.
- **Validation error UX** — does a bad `{% source %}` read well to the agent?
  **ADDRESSED** — Markdoc attribute validation names the offending attribute;
  surfaced via the existing `cb validate --hook` PostToolUse path
  (callback-box CLAUDE.md).
- **Partial migration / transition state** — adding optional attributes to
  `{% source %}` is backward-compatible: existing `ref`/`as`-only tags keep
  working (Track A attributes are optional). **ADDRESSED** — no migration of
  existing source tags; new attributes are additive.

## NOT in scope

- **Fuzzy re-anchoring on drift.** MVP flags `version` mismatch; it does not
  re-find the span. Rationale: it's a self-contained design (subplan) and
  flag-first is useful on its own.
- **`prefix`/`suffix` quote selectors on `{% source %}`.** Body-as-`exact` +
  `position` + `version` is the MVP selector set. Rationale: adding the W3C
  belt-and-suspenders selectors only pays off once fuzzy re-anchoring exists
  (the subplan), so they land together or not at all.
- **Live wrapper as a production/network feature.** Dev-only, localhost,
  read-only. Rationale: every Vite `server.fs` CVE bit only when
  network-exposed; we don't expose it.
- **Write-back to wrapped files.** The box never edits canonical repo files;
  development stays in the worktree. Rationale: read-only removes the
  two-writer-conflict class entirely and matches the stated "development stays
  here" decision.
- **Snapshot mode.** The user chose live wrapping; we do not also build the
  gdoc-style attach-copy snapshot. Rationale: `version` gives the
  drift-detection that snapshotting was wanted for, without a second
  content-storage path. (Recorded because snapshot was seriously considered.)
- **Syntax-highlighted code renderer.** `.ts` targets render via existing
  `plaintext.tsx`. Rationale: highlighting doesn't change the review loop;
  line-anchored selection already works.
- **True highlighted diff of compared targets.** Compare = N columns
  side-by-side; a change-highlighted diff is a separate feature. Rationale:
  prior art shows diff is its own primitive; columns satisfy "view together."
- **CriticMarkup-style inline comments in the target.** Backbone is
  body-`{% source %}`, because targets are read-only. Rationale: inline
  mutates the file we've decided not to write.
- **Concurrent-writer reconciliation on review cards.** Single-writer
  assumption. Rationale: review is an interactive chat-agent session, not a
  background-agent target.

## Open design questions

- **Resolving `wt:main` → on-disk path.** `discoverWorktrees()` enumerates
  `WORKTREES_ROOT` (`bin/router.ts:548-566`); the main checkout lives
  elsewhere (the monorepo root). The resolver needs main's root from the same
  config the router uses. **Lean:** read it from the router's own
  configuration rather than re-deriving, to keep one source of truth. Settle
  before Track B's route chunk (not needed for the resolver doctest, which can
  test worktree + traversal cases first).
- **Single review card type vs. wrapper + sidecar.** Committed to single
  (`targets:` frontmatter + body commentary). Recorded as settled, not open —
  noted here only because the conversation left it "not sure." Rationale:
  one addressable object holds target + anchor + comment; a sidecar split
  doubles the card count and the ref-chasing.
- **Concurrent-writer reconciliation** — deferred (see edge cases); revisit
  only if review cards stop being single-writer.

## Knowledge audits

New agent-facing concepts, each defaulting to ≥1 `knows_directly` entry in
`src/dev/knowledge-audits.yaml` (the `{% quote %}` work landed four such
entries — precedent for "a convention without an audit is one the agent
forgets at the next compaction"):

- **`{% source %}` now carries `position`, `version` (markers), and
  `placement`** (Track A) — audit: agent recalls that an existing-span
  citation adds `position`, one or more `version` markers (`git:` and/or
  `sha256:`), and `placement` when the spot was estimated — and that the
  version markers are measured from the target, not invented.
- **`review` card + `targets:` + synthesis behavior** (Tracks C/D) — audit:
  given a `<user-selection>` against a review target, the agent produces a
  body `{% source %}` anchor rather than free prose.
- **`wt:<name>:<path>` ref scheme** (Track B) — audit: agent recognizes a
  `wt:` ref as an out-of-box target and does not try to resolve it as a box
  path. (Lower priority — mostly internal — but the agent will see these refs
  in review-card bodies, so one recall check is warranted.)

## Implementation order

1. **Track A chunk** — `{% source %}` gains optional `position`/`version` +
   guide + doctest. Unblocks the anchor vocabulary; backward-compatible.
2. **Track B chunk** — `resolveExternalRef` + allowlist/denylist +
   `ExternalRefError` + doctest (traversal/denylist/unknown-worktree). Depends
   on nothing in A; sequenced second because it's the riskier surface and
   wants the most review.
3. **Track B route chunk** — dev-gated `/api/external/:ref` route. Depends on
   the resolver and on settling `wt:main` resolution.
4. **Track C single-target chunk** — `review` schema + registry + minimal
   `review.tsx` rendering one live target through the route. Depends on A
   (attributes exist) + B (resolver/route).
5. **Track C compare + anchor-linking chunks** — multi-column, per-pane
   `wt:`-stamped selection capture, stale-anchor painting.
6. **Track D chunk** — `review` schema `instructions` + knowledge-audit
   entries. Depends on A + C.
7. **Usage (not a code chunk)** — stand up the review box, seed review cards
   over the IA docs, run the loop.

The plan completes when chunks 1–6 land; it ships (merges to main) only on an
explicit signal, per cb-plan's no-partial-ship rule.

## Rollout shape

- **Test posture.** Dogfooding precedes broad tests, but the two
  regression-risk pieces get tests **at ship**: the Track B resolver
  (security boundary — traversal/denylist/unknown-worktree doctest, non-
  negotiable) and the Track A parse/validate doctest. The `review.tsx`
  renderer is exercised by dogfooding first; one route-doctest for the
  external-file endpoint lands once the shape settles.
- **Knowledge-audit entries.** The three above land with their tracks (A's
  with Track A, the review/synthesis one with Track D); the `wt:` recall
  audit is lower priority and may trail.
- **Migration.** None for existing data — Track A attributes are additive and
  optional; no existing `{% source %}` tag changes. The `review` card type is
  net-new. The dev-only external route is additive and unmounted in prod.
- **No lint-rule changes.** Per CLAUDE.md/memory, the new renderer and route
  conform to the rules; if a rule fights the code, raise it, don't disable it.
