# In-box Commentary Surface for Out-of-Box Files

A Callback Box capability for viewing, selecting, and commenting on files
that live **outside** the box — repo docs and source, including the same
logical file across multiple git worktrees — from inside a dedicated box.
A new `commentary` card wraps one or more live external targets; its body is
agent-and-user commentary anchored into those targets via a `{% source %}`
tag extended to carry position and version. The card has a **dedicated
renderer** that resolves and renders each referenced file live (without it the
card is inert — see Track C). The boxholder reads/selects in the browser and
pushes selections through chat (the existing selection-commentary path); the
box agent synthesizes those selections into durable, anchored commentary; a
developer working in the wrapped worktree reads that commentary back out of
the box.

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
  generic — never hardcode personal names."* The external addressing scheme
  and the allowlist must be expressed in terms of resolved roots, not
  `/Users/ianbicking/...` literals — which is one reason an absolute `file:`
  URI scheme is disfavored (see Open questions).
- **Threat model (the security posture this plan trades against).** The
  boxholder runs box agents with `--dangerously-skip-permissions` — they
  already have full read access to the machine — and the dev server is
  localhost-only. So the external-read route's path guard is **hygiene**
  (keep the route's intent honest, catch accidental traversal bugs), **not** a
  high-stakes security boundary. The plan deliberately does not gold-plate it.
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
  card that stands in for content sourced elsewhere. The `commentary` card is
  its live-filesystem cousin; we mirror its frontmatter-metadata +
  `content.ref` shape (Track C).
- **Convention — `ref` for in-box targets** (`docs/prompt-audits.md:184`:
  *"links in card schemas always use `ref="..."` for the target, not
  href/path/url"*). An out-of-box target is a deliberate departure from this;
  the `href`-vs-`ref` question is in Open questions.
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
  target ref. The serialized form is built at
  `src/frontend/src/lib/selection-serialize.ts:69-73`: *"return
  `<user-selection ref="${escapeAttr(selection.ref)}"${positionAttr}${placementAttr}>${escapeText(selection.text)}</user-selection>`"*
  — attributes `ref` (required), `position` (optional), `placement`
  (voice-only). The position grammar is assembled at
  `src/frontend/src/lib/selection-position.ts:47-62` (`formatPosition`):
  clauses `section`, `heading: TEXT (#id)`, `paragraph N`, `~line N`, joined
  with `"; "`, all optional. **Reuse** this whole stack; Track A renames the
  emitted attribute to `pos` and lets `{% source %}` carry the same values.

- **The `source` Markdoc tag — EXTEND.** `src/shared/markdoc-config.ts:133-149`
  defines `source` with exactly two attributes: *"ref: { type: String,
  required: true }, as: { type: String }"* — **no** `pos`, `version`, or hash
  attribute today. Track A adds them.

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
  (`bin/router.ts:548-566`) enumerates them. The external resolver reuses this
  mapping rather than re-deriving paths.

- **Card schema registration + path-scoped instruction rules — REUSE.**
  Frontmatter schemas register in `src/schemas/registry.ts:63-89`
  (`cardSchemas[]`). A schema's `instructions` becomes a path-scoped agent
  rule at `cb init`: `src/core/init-rules.ts:102-117` writes
  `**/*.<type>.card` rule files. The `commentary` card's synthesis guidance
  rides this tier-3 mechanism (Track D).

- **External-content card precedent — MIRROR.** `src/schemas/gdoc.tsx`:
  pure-frontmatter metadata + a `content.ref` pointing at the renderable
  body. `commentary` mirrors the metadata-card shape but resolves targets live
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
  quoted `exact` (the tag body) and a `pos`, plus multiple `version` markers —
  preferred-then-fallback.
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
  thread: they bite only when the dev server is network-exposed. Given our
  localhost-only + skip-permissions threat model the stakes are low, but the
  cheap lessons still apply: realpath before matching, allowlist of resolved
  root prefixes (not a blocklist), strip query suffixes, read-only, dev-only.
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
path-scoped instruction (`commentary` schema), and the finished surface is
then used to review the IA design docs themselves. Build order is also the
cheapest way to feel where the tier rule is unwritten.

### Track A — `{% source %}` as the unified, version-aware anchor

**What.** Extend the existing `source` Markdoc tag with `pos`, `version`, and
`placement` so a single tag expresses everything `<user-selection>` expresses
(where it came from, where in the doc, the exact words in the body, whether
the spot was estimated) **plus** which version(s) it was anchored against.
Rename the emitted selection attribute `position` → `pos` (in
`<user-selection>` too — cheap, since that tag isn't persisted). Update the
tier-2 agent guide (`source.ts`) accordingly.

**Why this needs to change.** Today `{% source %}` carries only `ref` + `as`
(`markdoc-config.ts:134-136`), while `<user-selection>` carries `ref` +
`position` + `placement` (`selection-serialize.ts:70-72`). The commentary
body needs the *union* — a persisted comment must say which span (`pos`),
quote the span (body text), note if the spot was estimated (`placement`), and
pin the version(s) so drift is detectable. Without a single superset tag, the
box agent would have to invent an ad-hoc shape when turning a selection into
commentary.

**Direction.**
A commentary entry is **quote-then-remark**: the `{% source %}` anchors and
holds *the span the user selected* (verbatim text from the target — the W3C
`exact` selector, and what lets the entry read standalone without resolving
the live file); the user's **comment** is the prose that *follows* the tag,
outside it (per `agent-guide/source.ts`: "your own framing... doesn't need a
`{% source %}` tag"). A selection is always verbatim, so it composes with an
inner `{% quote %}` and `as="verbatim"`:
```
{% source href="wt:chat-output-ia:callback-box/docs/box-commentary-surface.md"
          pos="body; heading: Track A (#track-a); paragraph 2; ~line 210"
          version="git:7ffeae4 sha256:9f3a…"  /* one or more kind:value markers */
          placement="estimated, ~50% through the message"  /* only when the spot was approximate */
          as="verbatim" %}
{% quote %}a single tag expresses everything <user-selection> expresses{% /quote %}
{% /source %}

Overstated — `placement` is composer-only, so it isn't a clean superset. Soften this.
```
The first block is the anchored span; the trailing paragraph is the comment.
(`href` and the `wt:` scheme are provisional — see Open questions. An in-box
`{% source %}` still uses `ref`; the example targets an out-of-box file.)
- `pos` — same freeform grammar as `formatPosition`
  (`selection-position.ts:47-62`); reused verbatim so the chat selection and
  the persisted source share one string. (Short name per the boxholder; the
  meaning is obvious in context.)
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
  marker**: it records that the anchor's `pos` was *estimated* (a voice-grabbed
  selection whose exact spot was lost and dropped by rough timing), so a reader
  treats `pos` as approximate rather than exact. Omitted ⇒ the spot is exact.
  The value phrasing ("through the message") is composer-flavored but preserved
  as-is rather than re-minted.
- The tag body remains the quoted `exact` (W3C `TextQuoteSelector.exact`).
  `prefix`/`suffix` selectors are deferred (NOT in scope).

`{% source %}` is therefore a true superset of `<user-selection>`'s
attributes (target ref, `pos`, `placement`, quoted body) **plus** the
multi-marker `version`.

**Vocabulary lock-ins.**
- Attribute names: `pos` (renamed from `position`, applied to
  `<user-selection>` too), `version`, `placement`. (`ref`-vs-`href` for the
  target is *not* locked — see Open questions.)
- `version` value format: a space-separated set of `"<kind>:<value>"` markers
  (e.g. `git:<rev>`, `sha256:<hex>`); the `kind:` prefix makes the set
  open-ended (new marker kinds can be added without a new attribute), and
  values are truncatable for display.
- The `pos` string grammar is owned by `formatPosition`; `{% source %}`
  consumes it, never re-specifies it. `placement` is owned by the selection
  serializer; `{% source %}` carries it, never re-specifies it.

**First implementation chunk.** Add `pos`, `version`, and `placement` to the
`source` schema in `markdoc-config.ts` (attributes only, all optional, no
behavior change to existing `ref`/`as` callers); rename `position` → `pos` in
the `<user-selection>` serializer (`selection-serialize.ts:70`); thread the
new attributes through the `SourceInline`/`SourceBlock` render rename the same
way `ref`→`sourceRef` is handled (`markdoc-config.ts:144-145`); extend
`agent-guide/source.ts` with a short "anchoring an existing span (pos, version
markers, placement)" subsection; one doctest asserting a `{% source %}` with
all attributes — including a multi-marker `version="git:… sha256:…"` and a
`placement` — parses and validates. The target-attribute name is `ref` for
this chunk (in-box); `href` (if chosen) is additive and lands with Track B.

### Track B — external addressing scheme + gated live-read resolver

**What.** An external addressing scheme (provisionally `href="wt:<worktree>:<repo-relative-path>"`)
and a single resolver that maps it to an absolute path under an **allowlist**
of canonicalized roots, reads the file **read-only**, and is **mounted only in
dev**. A new download-shaped route serves the bytes to the viewer. (Scheme
literal and attribute name pending — see Open questions; the resolver logic is
identical regardless.)

**Why this needs to change.** The viewer can only target box-relative paths
today, and the box file route hard-confines to boxRoot
(`api-files.ts:67-69`). Wrapping a live repo file — across worktrees —
requires reading outside boxRoot, which nothing currently permits.

**Direction.**
- **Scheme.** A worktree-aware symbolic form, provisionally
  `wt:<name>:<repo-rel>`, where `<name>` resolves via the router's known
  roots: `discoverWorktrees()` for worktree names (`bin/router.ts:548-566`) →
  `WORKTREES_ROOT/<name>/` (`:55`, `:103`), and a reserved `main` token → the
  main checkout root. (Resolving `main`'s on-disk path is a detail to settle —
  see Open questions.)
- **Resolver (server).** A new helper — call it `resolveExternalRef(ref)` —
  that: parses the scheme; rejects anything not the external scheme; builds the
  candidate path; `fs.realpath`s it; verifies the realpath `startsWith` one of
  the allowlisted resolved roots (the same `startsWith`-after-resolve shape as
  `api-files.ts:67`, but against the roots allowlist instead of boxRoot);
  refuses `.git/`, `.env*`, and node_modules (denylist, per Vite); returns a
  custom `ExternalRefError` on any failure (CODE-STYLE: custom error classes,
  no bare catch). Read-only — no write counterpart. Per the threat model this
  guard is hygiene, not a hardened boundary.
- **Route.** A raw Fastify route (file-download shape, per the tRPC-vs-raw
  rule in CLAUDE.md) e.g. `GET /api/external/:ref` returning the bytes +
  content-type **plus the current `version` markers** (so the renderer can
  drift-check without a second round-trip), **registered only when a dev flag
  is set** (so the deployed server at `/opt/callback/` never mounts it). Strip
  query suffixes before resolving (Vite `?raw` lesson).
- **`buildVersionMarkers(absPath)` (server).** Produces the marker set for a
  resolved file: `sha256:<hash>` of the current on-disk bytes always (the
  file-specific drift signal), plus `git:<rev>` = the worktree's current
  commit when the path is tracked (enables the later `git show <rev>:<path>`
  diff-view). Used by the route (to report current markers) and by Track D
  synthesis (to stamp an anchor) — one helper, one definition of "version,"
  so creation and drift-check can't disagree. This is the "creating the
  versions" unit the functional tests target.
- **Allowlist.** Resolved roots: `WORKTREES_ROOT` and the main checkout root.
  Expressed as resolved prefixes, never personal-name literals (CLAUDE.md
  generic-source rule).

**Vocabulary lock-ins.**
- The resolver is the **only** code that turns an external ref into a
  filesystem path; viewer and synthesis never construct paths themselves.
- (Scheme literal and `ref`/`href` attribute are deliberately *not* locked
  here — Open questions.)

**First implementation chunk.** `resolveExternalRef` + its allowlist/denylist
+ `ExternalRefError`, as a pure-ish function with a doctest covering: valid
worktree ref, `main` ref, traversal attempt (`../../etc/passwd` → realpath
escapes allowlist → error), denylisted path (`.git/config` → error), unknown
worktree → error. Land `buildVersionMarkers` alongside, with a **functional
test** (filesystem tier, `makeTmpBox()`/a tmp git repo) that builds markers for
a committed file and a dirty file: `sha256:` matches the bytes in both, and
`git:<rev>` is present when tracked and absent for an untracked/external path.
Route mounting comes in a later chunk; the resolver has no open questions
beyond the scheme literal (which only changes the parse prefix).

### Track C — the `commentary` card + viewer renderer

**What.** A `commentary` frontmatter card type whose `targets:` list names one
or more external refs to render, and whose body is commentary. A dedicated
`commentary.tsx` renderer resolves each target via Track B, renders it
(markdown/plaintext) in its own pane, renders the commentary body, and wires
per-pane SelectionCapture so a selection reports the **target's** ref. This
renderer is load-bearing: without it the card type is inert (it's the answer
to "these new cards need a viewer that renders the referenced file").

**Why this needs to change.** "View and select an out-of-box file in the box
UI" has no current surface — FileView renders one box-relative `path`
(`FileView.tsx:42-60`). The commentary card is the in-box, addressable handle
that makes external targets viewable, selectable, and comment-anchored in one
object.

**Direction.**
- **Schema** (`cardSchema("commentary", …)`, registered in
  `registry.ts:63-89`): `targets:` — array of `{ ref/href: string,
  label?: string }`; the body is freeform Markdoc commentary. Frontmatter
  declares the canvas (so an empty commentary card still shows its targets to
  select against); body `{% source %}` tags annotate into them. Multi-file
  and cross-worktree both fall out of `targets:` being a list — wrapping the
  same repo-rel path under `wt:main` and `wt:<name>` puts the two versions
  side by side. (This is also why no single ref must name multiple worktrees:
  multiplicity lives in the list.)
- **Renderer** (`renderers/commentary.tsx`): one column per target; each
  column renders the resolved content through the existing markdown/plaintext
  renderer and is wrapped in `SelectionCapture` (reusing
  `FileView.tsx:283-285`) whose `onCapture` stamps that column's target ref;
  a commentary pane renders the body, and each `{% source %}` anchor links to
  its span in the matching column. `version` mismatch on a live target paints
  the affected anchors as stale.
- **Selection → composer.** A captured selection serializes (today's path) as
  `<user-selection ref="…" pos="…">text</user-selection>` — the target ref is
  now an external ref instead of a box path; everything downstream is unchanged.

**Vocabulary lock-ins.**
- Card type literal: `commentary`; file shape `*.commentary.card`.
- Frontmatter key: `targets` (array).

**First implementation chunk.** The `commentary` schema + registry entry + a
minimal `commentary.tsx` that renders a **single** target (no compare, no
anchor-linking yet) through the existing renderer behind the Track-B route —
i.e. "open a commentary card, see one live external file." Multi-column
compare and anchor-linking are follow-on chunks within this track. No open
questions in the single-target chunk.

### Track D — synthesis behavior + box usage

**What.** The `commentary` schema's `instructions` (tier-3, path-scoped to
`*.commentary.card`) telling the agent how to turn an incoming
`<user-selection>` into durable `{% source %}`-anchored commentary in the card
body — including computing `version`. Plus the one-time usage step: stand up
the dedicated box and create commentary cards over the IA design docs.

**Why this needs to change.** The capability (A–C) is inert without the agent
knowing *what to produce*. Per the conversation, this synthesis is the actual
"new functionality," and it's an output-vocabulary instruction — what the
agent may emit — so it belongs in the path-scoped schema-instruction tier that
loads exactly when a `commentary` card is touched (`init-rules.ts:102-117`).

**Direction.**
- Schema `instructions`: when a `<user-selection>` against a `targets:` ref
  arrives, append/update a `{% source %}` block in the body — body = the
  user's exact selected span; copy `pos` (and `placement`, if any) from the
  selection; add `version` markers measured at synthesis time — `git:<rev>`
  when the target is tracked plus `sha256:<hash>` of the live bytes (the
  few-seconds synthesis window is not racy, per the boxholder); the agent's
  own remark goes as prose adjacent to (not inside) the `{% source %}` (mirrors
  `agent-guide/source.ts`'s "your framing is yours, the tag marks what came
  from elsewhere"). One commentary card per coherent target-set.
- Box usage: a dedicated persistent box at `~/src/boxes/<name>/` (served at
  `/main/<name>/`), seeded with commentary cards whose `targets:` point at this
  worktree's IA docs.

**Vocabulary lock-ins.** None new; consumes A's tag and C's card.

**First implementation chunk.** Write the `commentary` schema `instructions`
prose, plus a **functional test of the synthesis transform** — given a
captured `<user-selection>` (target ref + `pos` + `placement`) and a resolved
target, assert it produces a `{% source %}` carrying those exact selector
fields and the `buildVersionMarkers` output, with the agent's remark as
adjacent prose (not inside the tag). This is the second half of the
"creating the selectors/versions" coverage the boxholder asked for: Track B
tests marker *creation*, this tests selection → anchored `{% source %}`.
(Knowledge-audit entries are skip-by-default here — see Knowledge audits.) The
box-standup is a usage action, not a code chunk.

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

> **Threat model (not a critical gap).** The external resolver reads files
> outside the box root, but the boxholder runs agents with
> `--dangerously-skip-permissions` (full machine read access already) and the
> dev server is localhost-only. So the allowlist + realpath guard is
> **hygiene** — it keeps the route's intent honest and catches accidental
> traversal bugs — not a high-stakes security boundary. The cheap
> traversal/denylist doctest stays as a regression guard; nothing here is
> gold-plated beyond that.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| External ref escapes allowlist via `../` or symlink | Yes — Track B chunk doctest | Yes — realpath + allowlist `startsWith`, `ExternalRefError` 403 | Clear (403) |
| External ref names a removed/unknown worktree | Yes — Track B doctest | Yes — `discoverWorktrees()` miss → `ExternalRefError` | Clear (resolver error; viewer shows "target unavailable") |
| Wrapped target edited since anchor (`version` marker mismatch) | Yes — `buildVersionMarkers` unit test + drift-check functional test (Track C) | Yes — re-check markers (git rev preferred, else hash) on view, paint anchor stale | Clear (stale flag) — *this is the core drift case; silent here would be confidently-wrong commentary* |
| Target has no git history, only `sha256:` marker available | n/a (expected for external resources) | Hash marker alone still detects drift; no diff affordance | Clear (drift flagged; diff-view simply unavailable for that target) |
| Markers match but `pos` line drifted (any byte change flips both git rev and hash) | Yes — covered by the marker functional test | Marker check catches it (any committed or on-disk change ⇒ mismatch ⇒ flag) | Clear (over-flags rather than under-flags — safe direction) |
| Selection over a `.ts` (plaintext) target → `pos` is line-only | n/a (degraded, not failure) | `formatPosition` tolerates missing heading/paragraph (`selection-position.ts:47-62`) | Clear (weaker anchor + quoted body still present) |
| Dev route accidentally mounted in prod | Yes — route-gating route-doctest (Track B route chunk) | Dev flag gates mounting; deployed server never sets it | Clear (route 404 in prod) |
| Commentary card body hand-edited with malformed `{% source %}` | Inherited | `cb validate` runs Markdoc validation on card load (CLAUDE.md validation contract) | Clear (validation error) |
| Two agents edit one commentary card concurrently | No | Same as any card; not reconciled | DEFERRED (see edge cases) |

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — agent uses `{% quote %}` where
  `{% source %}` was right. **ADDRESSED** — `agent-guide/source.ts` already
  draws the quote-vs-source line ("whose exact words" vs "where it came
  from"); Track A's guide edit extends it for the pos/version case.
- **Stale ref** — a `targets:` ref points at a file/worktree removed after
  the card was written. **ADDRESSED** — Track B resolver errors cleanly;
  renderer shows "target unavailable" per the Failure-modes row.
- **Two agents touching the same card** — commentary card edited by the box
  chat agent and (hypothetically) a background agent at once. **DEFERRED** —
  no reconciliation beyond git; commentary cards are expected to be
  single-writer (the chat agent during a commentary session). Cited in Open
  questions.
- **Hand-edit drift** — boxholder hand-writes `{%source%}` (no spaces) or a
  bad `version`. **ADDRESSED** — Markdoc validation on load (CLAUDE.md
  validation contract); a malformed tag fails `cb validate` rather than
  rendering wrong.
- **Fabricated free-form value** — agent invents `version` or `pos` rather
  than measuring. **ADDRESSED by making honesty easy** — `version` is computed
  from the live target (Track D synthesis), not authored; `pos` is copied from
  the selection string, not invented. The one free-form field, `as`, already
  has the "describe reality, don't enum-fit" guidance in `agent-guide/source.ts`.
- **Validation error UX** — does a bad `{% source %}` read well to the agent?
  **ADDRESSED** — Markdoc attribute validation names the offending attribute;
  surfaced via the existing `cb validate --hook` PostToolUse path
  (callback-box CLAUDE.md).
- **Partial migration / transition state** — `{% source %}` gains optional
  attributes (backward-compatible); the `position` → `pos` rename touches the
  `<user-selection>` serializer + its doctests, but that tag is transient (not
  persisted in any card), so there's no stored data to migrate. **ADDRESSED** —
  no card migration; rename is code-and-test only.

## NOT in scope

- **Fuzzy re-anchoring on drift.** MVP flags `version` mismatch; it does not
  re-find the span. Rationale: it's a self-contained design (subplan) and
  flag-first is useful on its own.
- **`prefix`/`suffix` quote selectors on `{% source %}`.** Body-as-`exact` +
  `pos` + `version` is the MVP selector set. Rationale: adding the W3C
  belt-and-suspenders selectors only pays off once fuzzy re-anchoring exists
  (the subplan), so they land together or not at all.
- **Live wrapper as a production/network feature.** Dev-only, localhost,
  read-only. Rationale: every Vite `server.fs` CVE bit only when
  network-exposed; we don't expose it.
- **Write-back to wrapped files.** The box never edits canonical repo files;
  development stays in the worktree. Rationale: read-only removes the
  two-writer-conflict class entirely and matches the stated "development stays
  here" decision.
- **Snapshot mode.** The boxholder chose live wrapping; we do not also build
  the gdoc-style attach-copy snapshot. Rationale: `version` gives the
  drift-detection that snapshotting was wanted for, without a second
  content-storage path. (Recorded because snapshot was seriously considered.)
- **Syntax-highlighted code renderer.** `.ts` targets render via existing
  `plaintext.tsx`. Rationale: highlighting doesn't change the loop;
  line-anchored selection already works.
- **True highlighted diff of compared targets.** Compare = N columns
  side-by-side; a change-highlighted diff is a separate feature (the `git:`
  marker is the hook to build it later). Rationale: prior art shows diff is its
  own primitive; columns satisfy "view together."
- **CriticMarkup-style inline comments in the target.** Backbone is
  body-`{% source %}`, because targets are read-only. Rationale: inline
  mutates the file we've decided not to write.
- **Concurrent-writer reconciliation on commentary cards.** Single-writer
  assumption. Rationale: commentary is an interactive chat-agent session, not a
  background-agent target.

## Open design questions

- **External addressing: scheme literal + attribute name.** Two coupled,
  unsettled sub-decisions:
  - *Attribute.* In-box targets use `ref` by established convention
    (`docs/prompt-audits.md:184`). An out-of-box target is genuinely
    different, so `href` is a defensible "external, not in this box" signal.
    **Lean:** `href` for external, keep `ref` for in-box — a clean rule, at
    the cost of a second addressing attribute on `{% source %}` and `targets:`.
  - *Scheme/value.* A worktree-aware symbolic scheme (`wt:<name>:<path>`,
    provisional) stays symbolic (portable; no machine-path literals, which the
    generic-source rule disfavors) and names *which* worktree. Plain `file:`
    is more recognizable but embeds absolute machine paths and is
    worktree-blind. **Lean:** a worktree-aware symbolic scheme; exact spelling
    TBD.
  - *Multi-worktree "awkwardness" dissolves:* no single ref needs to name many
    worktrees — `targets:` is a list, so comparing the same file across `main`
    + a worktree is two entries, whichever scheme. The scheme only has to name
    *one* target unambiguously.
  - Does not block Track B's resolver chunk — only the parse prefix and the
    attribute name change; resolver logic is identical.
- **Resolving `wt:main` → on-disk path.** `discoverWorktrees()` enumerates
  `WORKTREES_ROOT` (`bin/router.ts:548-566`); the main checkout lives
  elsewhere (the monorepo root). The resolver needs main's root from the same
  config the router uses. **Lean:** read it from the router's own
  configuration rather than re-deriving. Settle before Track B's route chunk.
- **Single `commentary` card type vs. wrapper + sidecar.** Committed to single
  (`targets:` frontmatter + body commentary). Recorded as settled, not open —
  noted because the conversation left it "not sure." Rationale: one
  addressable object holds target + anchor + comment; a sidecar split doubles
  the card count and the ref-chasing. *(Flagged for the boxholder's close
  read.)*
- **Concurrent-writer reconciliation** — deferred (see edge cases); revisit
  only if commentary cards stop being single-writer.

## Knowledge audits

These conventions are **obscure, dev-only, and low-frequency** — per the
boxholder, direct recall is generally not needed. They also load exactly when
they matter: the synthesis guidance is a path-scoped schema instruction
(`init-rules.ts:102-117`) injected whenever the agent touches a
`*.commentary.card`, and `{% source %}`'s new attributes live in the tier-2
agent guide that's always present. So unlike the `{% quote %}` work (four
`knows_directly` entries), this plan **skips direct-recall audits by default,
with rationale:** an agent that never opens a commentary card never needs the
convention, and one that does gets it loaded from the path-scoped rule. A
compaction that drops the detail is self-healing on the next card touch.

Optional single light audit if the boxholder wants one: that `{% source %}`
can carry more than `ref`/`as` (i.e. the agent doesn't believe it's
ref-only). Everything else: skip-with-rationale.

## Implementation order

1. **Track A chunk** — `{% source %}` gains `pos`/`version`/`placement`,
   `position`→`pos` rename in the selection serializer, guide + doctest.
   Unblocks the anchor vocabulary; backward-compatible for cards.
2. **Track B resolver chunk** — `resolveExternalRef` + allowlist/denylist +
   `ExternalRefError` + doctest (traversal/denylist/unknown-worktree). Depends
   on nothing in A; sequenced second because it's the riskier surface.
3. **Track B route chunk** — dev-gated `/api/external/:ref` route. Depends on
   the resolver and on settling `wt:main` resolution + the scheme literal.
4. **Track C single-target chunk** — `commentary` schema + registry + minimal
   `commentary.tsx` rendering one live target through the route. Depends on A
   (attributes exist) + B (resolver/route).
5. **Track C compare + anchor-linking chunks** — multi-column, per-pane
   target-stamped selection capture, stale-anchor painting.
6. **Track D chunk** — `commentary` schema `instructions`. Depends on A + C.
7. **Usage (not a code chunk)** — stand up the box, seed commentary cards over
   the IA docs, run the loop.

The plan completes when chunks 1–6 land; it ships (merges to main) only on an
explicit signal, per cb-plan's no-partial-ship rule.

## Rollout shape

- **Test posture (overrides cb-plan's default "dogfooding-first, defer
  tests" — the boxholder wants real coverage).** Every new codepath lands with
  tests in their chunk, in the project's doctest format (`.claude/rules/doctest.md`;
  three tiers — pure-function, route via `makeTestServer()`, filesystem via
  `makeTmpBox()`):
  - **Unit (pure-function):** `{% source %}` parse/validate with all attributes
    (Track A); `resolveExternalRef` allow/deny/traversal/unknown-worktree
    (Track B); the `pos` builder's existing `selection-position.doctest.md`,
    extended for the `position`→`pos` rename.
  - **Functional — "creating the selectors/versions" specifically (the
    boxholder's explicit ask):** `buildVersionMarkers` over a committed and a
    dirty file (filesystem tier) — `sha256:` matches bytes, `git:<rev>` present
    iff tracked (Track B); and the synthesis transform — a captured
    `<user-selection>` (`pos` + `placement`) → a `{% source %}` carrying those
    exact fields + the markers (Track D).
  - **Route (`makeTestServer()`):** `GET /api/external/:ref` returns
    bytes + current markers for an allowed ref, 403/404 for denied/unknown,
    and 404 when the dev flag is off (Track B route chunk).
  - **Renderer:** drift detection (stored vs. route-current markers ⇒ stale
    paint) covered by a functional test on the marker pair; the full
    `commentary.tsx` visual is dogfood-verified via `bin/browse`, the same
    posture selection-commentary used for its irreducibly-browser parts.
- **Knowledge-audit entries.** Skipped by default (see Knowledge audits); at
  most one optional light entry for `{% source %}`'s extended attributes.
- **Migration.** None for card data — Track A attributes are additive and
  optional; no existing `{% source %}` tag changes. The `position`→`pos`
  rename is code+test only (the tag isn't persisted). The `commentary` card
  type is net-new. The dev-only external route is additive and unmounted in
  prod.
- **No lint-rule changes.** Per CLAUDE.md/memory, the new renderer and route
  conform to the rules; if a rule fights the code, raise it, don't disable it.
