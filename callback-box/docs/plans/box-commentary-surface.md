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
  generic — never hardcode personal names."* This governs **shared** text
  (source, prompts, schemas, docs, rules) — the allowlist roots are read from
  config, never literals. But the same note exempts *"per-box config, throwaway
  replies, and personal memory"*, and commentary cards are per-box data — so a
  `file:/Users/...` href **in a commentary card** is fine (it's not shared
  source). That exemption is what lets the `file:` scheme work (Track B).
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
- **Precedent — body-bearing cards (`doc`/`briefing`).** A `commentary` card
  needs a markdown **body** (the commentary), so its schema follows
  `doc`/`briefing` (`body(z.string())`, `src/schemas/doc.tsx`), **not** `gdoc`
  — codex #9 caught that `gdoc` is body-less and points at an attach file
  (`gdoc.tsx:39`). `gdoc` is still the precedent for the *idea* of a card
  standing in for external content, just not for the schema shape (Track C).
- **Convention — `ref` for in-box targets** (`docs/prompt-audits.md:184`:
  *"links in card schemas always use `ref="..."` for the target, not
  href/path/url"*). `ref` is the box-relative, `cb mv`-tracked form. External
  URLs are deliberately the *other* attribute, `href` — untracked by `cb mv`,
  which is exactly why the split is principled, not just cosmetic (Track A).
- `~/.claude/.../memory` — *"Never disable lint rules; fix the code or ask."*
  Applies to the new frontend renderer and server route.

## What already exists

- **Selection capture, position, and `<user-selection>` serialization —
  REUSE.** Selection capture is wired once at the FileView level, wrapping
  whatever renderer is active:
  `src/frontend/src/components/FileView.tsx:283-285`: *"const body =
  onAddSelection === undefined ? rendered : `<SelectionCapture
  onCapture={handleCapture}>{rendered}</SelectionCapture>`"*. The capture
  *mechanism* (this wrapper) is reused, but the pipeline below is `ref`-bound,
  so generalizing it to `href` is a real change — **not** free reuse (codex #4;
  see Track C "Selection → composer"). The serialized form is built at
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

- **Worktree roots — REUSE (roots only).** `bin/router.ts:55-56` defines the
  roots (*"WORKTREES_ROOT = path.join(os.homedir(), "src", "callback-worktrees")"*).
  With plain `file:` absolute paths, the resolver needs only these **roots**
  for its allowlist — no per-name lookup (`resolveWorktree`/`discoverWorktrees`
  are not needed), since an absolute path already identifies the worktree.

- **Card schema registration + path-scoped instruction rules — REUSE.**
  Frontmatter schemas register in `src/schemas/registry.ts:63-89`
  (`cardSchemas[]`). A schema's `instructions` becomes a path-scoped agent
  rule at `cb init`: `src/core/init-rules.ts:102-117` writes
  `**/*.<type>.card` rule files. The `commentary` card's synthesis guidance
  rides this tier-3 mechanism (Track D).

- **Body-bearing card precedent — MIRROR `doc`/`briefing`.** `commentary` has a
  markdown body (the commentary prose), so it follows `doc`/`briefing`
  (`src/schemas/doc.tsx`, `body(z.string())`). `gdoc` (`src/schemas/gdoc.tsx`)
  is the precedent for *standing in for external content* but is **body-less**
  (`content.ref` → attach file, `gdoc.tsx:39`), so it's the wrong schema shape
  to copy (codex #9).

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
inner `{% quote %}`. **Each anchor is explicit** — it carries exactly one of
`ref` (in-box) or `href` (external) plus its own `version`. The agent fills
these from the card's frontmatter default at *write* time, so they stay
consistent without being *inherited at render* time:
```
{% source href="file:/Users/.../chat-output-ia/callback-box/docs/plans/box-commentary-surface.md"
          version="git:7ffeae4 sha256:9f3a1c2b"
          pos="body; heading: Track A (#track-a); paragraph 2; ~line 210" %}
{% quote %}a single tag expresses everything `<user-selection>` expresses{% /quote %}
{% /source %}

Overstated — `placement` is composer-only, so it isn't a clean superset. Soften this.
```
The first block is the anchored span; the trailing paragraph is the comment.
Note `` `<user-selection>` `` is backtick-wrapped: the raw selection contained
`<…>`, which the agent escapes to valid Markdown when writing the quote (see
Track D).

**Why anchors are explicit, not inherited (codex review).** An earlier draft
let an anchor omit `href`/`version` and inherit the card's frontmatter default.
Codex flagged two real bugs: if the card default later changes, every omitted
anchor silently *retargets*; and a single `defaultVersion` is wrong for anchors
added later as the file moves on — `version` is a *historical fact per anchor*,
not a card-level value. So each anchor is written explicit; the frontmatter
default is an authoring convenience the agent stamps, not a render-time lookup.
- `href` / `ref` — **exactly one, always present.** `ref` is the in-box,
  box-relative, `cb mv`-tracked form; `href` is the external full-URL form
  (`file:`, `http(s):`), untracked by `cb mv` (which is why it's a separate
  attribute — `agent-guide/source.ts` describes the `ref` tracking `href` opts
  out of). The global `source` schema gains `href` and relaxes `ref` from
  required to **"exactly one of `ref`/`href`"** — enforced for commentary cards
  via `card-lint` (see First implementation chunk), since `Markdoc.validate` is
  not otherwise wired (codex #7).
- `pos` — same freeform grammar as `formatPosition`
  (`selection-position.ts:47-62`); reused verbatim so the chat selection and
  the persisted source share one string. Per-anchor.
- `version` — **per-anchor, written at synthesis time** (never inherited). A
  space-separated set of `"<kind>:<value>"` markers:
  - a **content hash**, `sha256:<git-style-short-hex>` of the file bytes. **This
    is the drift primary** (codex #2): the only marker that identifies *this
    file's* exact state, including a dirty/uncommitted edit. Drift is an
    equality check, not collision resistance (non-adversarial), so a short
    prefix suffices.
  - `git:<rev>` — **supplementary, for the diff affordance only**, not drift.
    Ideally the *last commit that modified the file*
    (`git log -1 --format=%h -- <path>`); worktree HEAD is an acceptable
    fallback. (Codex #2: HEAD is wrong as a *drift* signal — it changes when any
    file commits and doesn't change on a dirty edit — so it's never the primary;
    it only says "which committed version to `git show` for a diff.")

  An untracked/web resource carries only the hash. On view, the renderer
  compares the anchor's **content hash** to the target's current hash; mismatch
  ⇒ flag "may be stale" (the `data_through` freshness shape from
  `docs/prompt-audits.md` §"Cache freshness"). Re-anchoring is **not** in this
  track.
- `placement` — carried verbatim from `<user-selection>` when present
  (`selection-serialize.ts:71`); per-anchor (never inherited). On a durable
  annotation it's a **provenance marker**: the `pos` was *estimated* (a
  voice-grab whose exact spot was lost), so treat `pos` as approximate. Omitted
  ⇒ exact. The value phrasing ("through the message") is composer-flavored but
  preserved as-is.
- The tag **body** is the quoted `exact` (W3C `TextQuoteSelector.exact`),
  inside `{% quote %}`. The agent **escapes the span to valid Markdown/Markdoc**
  when writing it — code-wrap `` `<…>` ``, escape a stray `` ` ``, `{%`, `%}` —
  so a selection that contains markup neither breaks the tag nor renders wrong.
  This is faithful rendering of what was displayed, not paraphrase (the same
  carve-out as the speech-correction note in `agent-guide/quotes.ts`).
  `prefix`/`suffix` selectors are deferred (NOT in scope).
- **Not `as`.** The general `{% source %}` `as` attribute describes a
  *non-verbatim* derivation ("summary", "inferred from…"). Commentary anchors
  are always verbatim selections, so `as` is unused here — the inner
  `{% quote %}` already marks "verbatim," and the agent's interpretation lives
  in the adjacent prose, not the tag. (`as` stays available for general
  `{% source %}` use elsewhere.)

`{% source %}` is therefore a true superset of `<user-selection>`'s
attributes (target ref, `pos`, `placement`, quoted body) **plus** the
multi-marker `version`.

**Vocabulary lock-ins.**
- Attribute names: `pos`, `version`, `placement`, `href` (external, untracked),
  `ref` (in-box, tracked). All per-anchor and explicit; `ref`/`href` are
  exactly-one. No render-time inheritance.
- `version` value format: space-separated `"<kind>:<value>"` markers — a
  `sha256:<short-hex>` content hash (**drift primary**) and optionally
  `git:<rev>` (diff affordance, last-modifying-commit). `kind:` prefix keeps
  the set open-ended.
- The `pos` string grammar is owned by `formatPosition`; `placement` by the
  selection serializer. `{% source %}` carries both; neither is re-specified.

**First implementation chunk.** Add `pos`, `version`, `placement`, and `href`
to the `source` schema in `markdoc-config.ts`; relax `ref` from `required` to
optional and add a tag `validate` requiring **exactly one of `ref`/`href`**.
Because `Markdoc.validate` is not invoked anywhere today (codex #7 —
`extractBodyRefs` swallows parse errors at `body-refs.ts:49`, `Markdown.tsx`
calls `parse`/`transform` only), **wire that validation into `card-lint` for
`*.commentary.card` bodies** so the rule runs where it matters. Rename
`position` → `pos` in the `<user-selection>` serializer
(`selection-serialize.ts:70`); thread the new attributes through the
`SourceInline`/`SourceBlock` rename (`markdoc-config.ts:144-145`); extend
`agent-guide/source.ts` with the "anchoring an existing span" subsection. One
doctest asserts a `{% source %}` with `href`, `version` (hash + git), and
`placement` parses; a second asserts a source with neither/both `ref`/`href`
fails the new validate.

### Track B — `file:` addressing + gated live-read resolver

**What.** `href` carries a full URL — `file:<absolute-path>` for local files
(across worktrees), `http(s):` for web pages. A single resolver maps a `file:`
URL to an absolute path under an **allowlist** of canonicalized roots, reads
it **read-only**, and is **mounted only in dev**. A download-shaped route
serves the bytes to the viewer. (`http(s):` targets are referenceable/quotable
now; live-rendering a web page in a pane is deferred — NOT in scope.)

**Why this needs to change.** The viewer can only target box-relative paths
today, and the box file route hard-confines to boxRoot
(`api-files.ts:67-69`). Wrapping a live repo file — across worktrees, or a web
page — requires reading outside boxRoot, which nothing currently permits.

**Why `file:` (settled).** The boxholder chose plain `file:` absolute URLs
over a symbolic `wt:<name>:` scheme. An absolute path already distinguishes
worktrees (each is a distinct directory), so no worktree-name registry or
`main`-resolution is needed — the earlier `wt:main` question dissolves. The
generic-source rule doesn't fight this: commentary cards are **per-box data**
(CLAUDE.md exempts "per-box config, throwaway replies, and personal memory"),
not shared source/docs/prompts, so a `/Users/...` literal in a commentary card
is fine.

**Direction.**
- **Scheme.** `href="file:<abs-path>"` (e.g.
  `file:/Users/.../callback-worktrees/chat-output-ia/callback-box/...`). No
  worktree lookup — the absolute path is the address. `http(s):` hrefs are
  stored and quotable but not resolved by the file route.
- **Resolver (server).** A new helper — call it `resolveExternalRef(href)` —
  that: parses the `file:` URL → absolute path (rejects non-`file:` for the
  read route); strips query suffixes (Vite `?raw` lesson); `fs.realpath`s it;
  verifies the realpath sits under an allowlisted root with
  **`path.relative(root, resolved)`** (not a raw `startsWith` — `/foo` prefixes
  `/foobar`; codex #6): in-bounds iff the relative path doesn't start with `..`
  and isn't absolute; refuses `.git/`, `.env*`, and node_modules (denylist, per
  Vite); returns a custom `ExternalRefError` on any failure (CODE-STYLE: custom
  error classes, no bare catch). Read-only. Per the threat model this guard is
  hygiene, not a hardened boundary.
- **Route.** A raw Fastify route (file-download shape, per the tRPC-vs-raw
  rule in CLAUDE.md): `GET /api/external?href=<url-encoded file: URL>` — the
  href goes in a **URL-encoded query param, not a `:ref` path segment** (a
  `file:/Users/...` URL has slashes and a scheme; it can't sit in one path
  segment — codex #6). It returns a **JSON envelope**
  `{ contentBase64, contentType, markers }`, **not** raw bytes with markers
  bolted on (you can't cleanly return a raw body *and* structured metadata —
  codex #6). **Registered only when a dev flag is set** (the deployed server at
  `/opt/callback/` never mounts it).
- **`buildVersionMarkers(absPath)` (server).** Returns the marker set:
  `sha256:<short-hex>` of the current on-disk bytes — the **drift primary** —
  plus `git:<rev>` = the **last commit that modified the path**
  (`git log -1 --format=%h -- <path>`, falling back to HEAD) for the diff
  affordance only (codex #2: a worktree HEAD is not a file version). Used by the
  route (current markers) and Track D synthesis (stamping an anchor) — one
  helper, one definition of "version," so creation and drift-check agree. The
  "creating the versions" unit the functional tests target.
- **Allowlist.** Permitted resolved roots: the worktrees root and the main
  checkout root. `WORKTREES_ROOT` is a **non-exported** const in the executable
  `bin/router.ts:55` (codex #6), so this is *not* free reuse — export it (and a
  main-checkout-root) from a shared module, or have the resolver read the same
  config. Resolved prefixes, compared via `path.relative` as above.

**Vocabulary lock-ins.**
- `href` carries a full URL; `file:` is the only scheme the read route
  resolves. The resolver is the **only** code that turns a `file:` URL into a
  filesystem path; viewer and synthesis never construct paths themselves.

**First implementation chunk.** `resolveExternalRef` + its allowlist/denylist
+ `ExternalRefError`, as a pure-ish function with a doctest covering: a valid
`file:` URL under an allowed root, traversal attempt
(`file:/…/../../etc/passwd` → realpath escapes allowlist → error), denylisted
path (`.git/config` → error), and a `file:` URL outside all roots → error.
Land `buildVersionMarkers` alongside, with a **functional test** (filesystem
tier, `makeTmpBox()`/a tmp git repo) that builds markers for a committed file
and a dirty file: the content hash matches the bytes in both, and `git:<rev>`
is present when tracked and absent for an untracked/external path. Route
mounting comes in a later chunk.

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
- **Schema** (`cardSchema("commentary", …)`, registered in `registry.ts:63-89`),
  **body-bearing like `doc`/`briefing`** (`body(z.string())`, `doc.tsx:17`;
  codex #9 — *not* body-less `gdoc`). Frontmatter declares the render canvas +
  the agent's default target:
  ```
  ---
  type: commentary
  defaultHref: file:/Users/.../callback-box/docs/plans/box-commentary-surface.md  # default target (xor defaultRef)
  targets:                               # optional; additional URLs to render for compare
    - file:/Users/.../callback-mono/callback-box/docs/plans/box-commentary-surface.md
  ---
  ```
  `defaultHref` **xor** `defaultRef` (Zod refinement rejects both). **No
  `defaultVersion`** — version is per-anchor (codex #3). The body is freeform
  Markdoc commentary; every `{% source %}` anchor is **explicit** (its own
  `ref`/`href` + `version`), stamped from the default by the synthesis, not
  inherited at render time. The frontmatter declares the canvas (an empty card
  still shows its target(s) to select against). Multi-file / cross-worktree
  compare falls out of `targets:` being a list — absolute `file:` paths
  distinguish the worktrees.
- **Renderer** (`renderers/commentary.tsx`): one column per rendered target
  (`defaultHref`/`defaultRef` + `targets:`); each column renders resolved
  content through the existing markdown/plaintext renderer, wrapped in
  `SelectionCapture`; the commentary body renders alongside, each `{% source %}`
  anchor linking to its span in the column matching the anchor's **explicit**
  `href`/`ref`. Drift: compare the anchor's content hash to the target's current
  hash; mismatch paints the anchor stale.
- **Selection → composer (bigger than "one href branch" — codex #4).** The
  capture *mechanism* (FileView wrapping the renderer in `SelectionCapture`,
  `FileView.tsx:283-285`) is reused, but the selection pipeline is `ref`-bound
  end to end, so generalizing to `href` touches four spots: `FileView.tsx:244`
  derives the `ref` from the file path (the commentary renderer must instead
  stamp the pane's `href`); the capture/`SelectionItem` types are `ref`-only
  (`selection-position.ts:36`); the serializer emits `ref`/`position`
  (`selection-serialize.ts:69`); the sent-message pill parses only
  `ref`/`position` (`user-message.tsx:31`). Each takes an `href` branch — a real
  frontend change, not free reuse.

**Vocabulary lock-ins.**
- Card type literal: `commentary`; file shape `*.commentary.card`.
- Frontmatter keys: `defaultHref` **xor** `defaultRef` (the default target),
  `targets` (optional array of additional render targets). No `defaultVersion`
  — version is per-anchor.

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
- Schema `instructions`: when a `<user-selection>` arrives, append a
  `{% source %}` block in the body. The tag body = the user's exact selected
  span **escaped to valid Markdown/Markdoc** (code-wrap `` `<…>` ``, escape
  stray `` ` ``/`{%`/`%}`) — faithful rendering of what was displayed, not
  paraphrase. Write **explicit** `href` (or `ref`) and `version` on *every*
  anchor — stamp the card's default target unless the selection was against a
  different one, and compute `version` via `buildVersionMarkers` (content hash +
  last-modifying-commit; the few-seconds synthesis window is not racy, per the
  boxholder). Copy `pos` (and `placement`, if any) from the selection. The
  agent's own remark goes as prose adjacent to (not inside) the `{% source %}`
  (mirrors `agent-guide/source.ts`'s "your framing is yours, the tag marks what
  came from elsewhere"). One commentary card per coherent target-set.
- Box usage: a dedicated persistent box at `~/src/boxes/<name>/` (served at
  `/main/<name>/`), seeded with commentary cards whose `targets:` point at this
  worktree's IA docs.

**Vocabulary lock-ins.** None new; consumes A's tag and C's card.

**First implementation chunk.** Write the `commentary` schema `instructions`
prose, plus a **functional test of the synthesis transform** — given a
captured `<user-selection>` (`href` + `pos` + `placement`) and a resolved
target, assert it produces a `{% source %}` carrying those exact selector
fields and the `buildVersionMarkers` output, with the agent's remark as
adjacent prose (not inside the tag). Include a case where the **selected span
contains markup** (`<…>`, a `{%`) and assert it's escaped to valid
Markdown/Markdoc in the quote. This is the second half of the "creating the
selectors/versions" coverage the boxholder asked for: Track B tests marker
*creation*, this tests selection → anchored `{% source %}`.
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
| `file:` href escapes allowlist via `../` or symlink | Yes — Track B chunk doctest | Yes — realpath + allowlist `startsWith`, `ExternalRefError` 403 | Clear (403) |
| `file:` href points at a removed/outside-roots path | Yes — Track B doctest | Yes — realpath miss / not-under-roots → `ExternalRefError` | Clear (resolver error; viewer shows "target unavailable") |
| Selected span contains Markdoc/Markdown-breaking chars (`<…>`, `` ` ``, `{%`/`%}`) | Yes — synthesis functional test includes a markup span (Track D) | Yes — agent escapes the span to valid Markdown/Markdoc when quoting | Clear (renders as written; tag stays intact) |
| Wrapped target edited since anchor | Yes — `buildVersionMarkers` unit test + drift-check functional test (Track C) | Yes — compare the anchor's **content hash** to the target's current hash; mismatch paints stale (git rev is diff-only, never the drift signal — codex #2) | Clear (stale flag) — *the core drift case; silent here would be confidently-wrong commentary* |
| Target has no git history, only the content hash | n/a (expected for external/web resources) | Content hash alone detects drift; no diff affordance | Clear (drift flagged; diff-view simply unavailable for that target) |
| Selection over a `.ts` (plaintext) target → no `pos` | n/a (degraded, not failure) | plaintext is one `<Pre>` with no headings/paragraphs/`data-line`, so `pos` is usually **empty** for code (codex #8); the quoted span is the only anchor. (Optional later: emit `data-line` from the plaintext renderer for line anchors.) | Clear (span-only anchor; quoted body still present) |
| Dev route accidentally mounted in prod | Yes — route-gating route-doctest (Track B route chunk) | Dev flag gates mounting; deployed server never sets it | Clear (route 404 in prod) |
| Commentary card body hand-edited with malformed/anchor-less `{% source %}` | Yes — card-lint doctest (Track A) | The new exactly-one-of-`ref`/`href` validate, **wired into `card-lint` for `*.commentary.card`** (codex #7: `Markdoc.validate` is not otherwise invoked; `body-refs.ts:49` swallows parse errors) | Clear (lint error) |
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
- **Hand-edit drift** — boxholder hand-writes `{%source%}` (no spaces) or an
  anchor-less source. **ADDRESSED via the new card-lint** (Track A): codex #7
  showed `cb validate` does *not* catch this today — `Markdoc.validate` is never
  invoked and `extractBodyRefs` (`body-refs.ts:49`) swallows parse errors — so
  the plan adds the exactly-one-of-`ref`/`href` validate into `card-lint` for
  `*.commentary.card`. (A truly unparseable tag still degrades to raw text in
  the renderer rather than crashing; the lint is what surfaces it.)
- **Fabricated free-form value** — agent invents `version` or `pos` rather
  than measuring. **ADDRESSED by making honesty easy** — `version` is computed
  from the live target (Track D synthesis), not authored; `pos` is copied from
  the selection string, not invented. The one free-form field, `as`, already
  has the "describe reality, don't enum-fit" guidance in `agent-guide/source.ts`.
- **Validation error UX** — does a bad `{% source %}` read well to the agent?
  **ADDRESSED via the new card-lint check** — it names the offending tag
  (missing/both `ref`/`href`), surfaced through the existing `cb validate
  --hook` PostToolUse path. (Per #7 this is new work, not an existing
  guarantee.)
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
  `plaintext.tsx`. Rationale: highlighting doesn't change the loop. (Note: code
  selection has no `pos` — codex #8 — so the quoted span is the anchor; emitting
  `data-line` from the plaintext renderer for line anchors is a small optional
  follow-on, not a blocker.)
- **Live-rendering `http(s):` web targets in a pane.** Web hrefs are
  storable/quotable now (you can comment on a web page), but fetching and
  rendering one live in a column (CORS, sanitization, iframe) is a separate
  build. Rationale: the `file:` local case is the immediate need; web targets
  ride the same `href` vocabulary without the rendering work.
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

## Codex review — what was applied / declined

A cross-model review (codex, read-only repo access; run via the `/codex` skill)
read the source and falsified several claims. Applied: **#2** (content hash is
the drift primary; `git:<rev>` demoted to a diff affordance and set to the
last-modifying-commit per the boxholder); **#3** (no frontmatter-default
*inheritance* — anchors carry explicit target + `version`; `defaultVersion`
removed); **#5** (don't weaken the global `source` schema — `ref`/`href` is
exactly-one, enforced for commentary via card-lint); **#4** (the `ref`→`href`
selection-pipeline change is re-scoped as real frontend work, not free reuse);
**#6** (route is a JSON envelope on a `?href=` query param, allowlist via
`path.relative`, `WORKTREES_ROOT` must be exported); **#7** (`cb validate` does
*not* catch malformed Markdoc today — the plan adds the check to card-lint);
**#8** (`.ts` plaintext selection yields *no* `pos`, not line-only); **#9**
(precedent is body-bearing `doc`/`briefing`, not body-less `gdoc`). Declined:
**#1** ("cut the whole live-wrapper build") — codex independently reinvented the
cheaper dogfood-with-an-in-box-doc path the boxholder already considered and
rejected in favour of the live wrapper; recorded, not adopted. **#10** (memory/
doctest citations "out of bounds") — those are legitimate project artifacts.

## Open design questions

- **External addressing — SETTLED.** `href` for external targets (full URLs:
  `file:`, `http(s):`), `ref` for in-box (box-relative, `cb mv`-tracked); a
  source carries exactly one. Scheme is plain `file:<abs-path>` (an absolute
  path names the worktree; the former `wt:main` question dissolved). Frontmatter
  declares one default, `defaultHref` **xor** `defaultRef`; the synthesis
  **stamps** it onto each anchor explicitly (no render-time inheritance — codex
  #3). Per-box-data exemption covers the `/Users/...` literal. The `cb mv`
  difference justifies the two-attribute split.
- **`version` encoding — SETTLED.** Content hash `sha256:<git-style-short-hex>`
  as the drift primary; `git:<rev>` (last-modifying-commit) supplementary for
  diffing. Truncation length is an implementation detail of `buildVersionMarkers`.
- **Compare-card anchor verbosity** (minor, open). Anchors are now always
  explicit, so a compare anchor repeats the full `href`. Nuance: let anchors
  reference a `targets:` entry by a short label instead. **Lean:** full `href`
  for now; revisit if compare cards get noisy.
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
2. **Track B resolver chunk** — `resolveExternalRef` (`file:` → allowlisted
   path) + denylist + `ExternalRefError` + `buildVersionMarkers`, with their
   doctests. Depends on nothing in A; sequenced second as the riskier surface.
3. **Track B route chunk** — dev-gated `/api/external/:ref` route returning
   bytes + current markers. Depends on the resolver.
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
