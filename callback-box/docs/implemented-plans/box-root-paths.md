# Box-root paths everywhere

**Status:** implemented 2026-07 — box-root-relative refs are now the taught/generated/validated
canonical form across the resolver, chat, nav, and landmarks, with `attach/` as the
sole exception; see the Status section below for the track → commit map.

Make box-root-based paths (leading `/`) the canonical form for every
cross-card/file reference in a box — authored, taught, generated, and
validated — with `attach/` (a card's own attachment scope) as the single
deliberate exception. Document-relative forms keep *resolving* forever
(no flag day for stored data); this plan changes what the system writes,
teaches, and nudges toward, and consolidates the three divergent resolver
implementations into one shared module so the convention has a single
enforcement point.

Decision record: `issues/decisions/2026-07-30-always-box-root-relative-links.md`
(boxholder call, 2026-07-30). The concrete symptom motivating it: agents
persistently author wrong relative link paths in chat and landmarks because a
bare path's base is per-surface bookkeeping an LLM doesn't reliably track.

## Stated preferences this plan trades against

- `docs/engineering-principles.md` — #3 validate-at-boundaries (refs are
  boundary data: LLM- and hand-authored), #5 resilient-not-silent (a broken
  ref must warn, not silently mis-render), #8 one-way-to-do-it (three resolver
  implementations and three per-schema conventions are the disease),
  #10 exhaustiveness (per-surface ref handling should derive from one spec,
  not be re-decided per call site).
- `callback-box/CLAUDE.md` "Read before writing" and the validation contract
  (`cb validate --staged` blocks invalid cards); "keep source and docs
  generic."
- `code-style.md` — shared modules in `src/shared/` must stay Node-free (the
  `attach-path.ts` precedent); no new exports beyond need; fail-hard on broken
  invariants vs degrade-visibly at boundaries.
- Boxholder standing preferences: bias toward strict (fail-closed
  containment); consolidate duplicates even across caller churn rather than
  preserving drift; plans are end-to-end, no fog-of-war.
- Shipped precedent: `src/shared/attach-path.ts` — the one piece of path
  algebra already extracted and shared backend/frontend; this plan extends
  that pattern to the rest of the ref grammar.

## What already exists

The full surface map was built in this worktree's analysis session (subagent
surveys + Codex cross-review). Essentials, all verified against source:

**The 3-form rule** (leading `/` → box root; `attach/…` → referring card's
`<basename>.attach/` scope; else → document-relative) exists in three
independent implementations that agree on the rule and diverge at edges:

- `src/core/ref-exists.ts:33-53` — `resolveRefToPath` + `resolveContainedRef`
  (validate path; rejects `..`-escapes via `containWithinBox`).
- `src/core/rewrite-card-refs.ts:54-97` — `resolveRefToAbs` + `restyleRef`
  (`cb mv`; style-preserving: absolute stays absolute, relative stays
  relative). Reused, not rebuilt — the rewriter's resolution-based design is
  exactly what makes opt-in normalization cheap.
- `src/frontend/src/lib/view-url.ts:119-153` — `resolveRelativePath`
  (frontend; **clamps** `..`-escapes into the box instead of rejecting, and
  reimplements the attach algebra instead of importing
  `src/shared/attach-path.ts`).

**Extractors** feeding validation: `extractRefs`
(`src/cards/schema.ts:401-431`, frontmatter keys literally named
`ref`/`refs`, any depth), `extractBodyRefs` (`src/core/body-refs.ts:46-74`,
Markdoc `ref="…"` attributes), `extractViewRefs`
(`src/core/views/refs.ts:35-47`, `cardRef="…"` in `.tsx` views). Card-body
inline markdown links have **no** extractor on the validate side, though
`cb mv` rewrites them (`rewrite-card-refs.ts` `applyTransform` link regex).

**CB002** (`src/core/markdown-lint-rules.ts:146-158`, `resolveInternalLink`)
already resolves leading `/` against the box root for plain `.md` dossiers —
so the decision's "no `.md` exemption" needs no validator change. It shares
its resolver with `cb relink` (`src/core/link-repair.ts`).

**Divergent per-surface conventions** this plan retires:

- Chat (`src/frontend/src/components/chat/markdown-rendering.tsx`): bare
  links + non-image embeds resolve against the chat's `contextDir`
  (`:133-159`); bare *image* embeds resolve from the box root (`:149-154`,
  the `49d881ca` half-fix). Prompt text
  (`src/core/chat/session/prompts.ts:86-88`) describes the pre-fix uniform
  behavior.
- Landmark (`src/schemas/landmark.ts:38,147`): `ref`/`src` documented as
  relative to the landmark's directory; render-layer `buildLink`
  (`src/core/landmark/resolve.ts:230-242`) does a bare `path.resolve`, so a
  leading-`/` ref mis-resolves to an OS path at render time while
  validate/mv handle it fine. `symbol.src`
  (`src/webapp/trpc/routers/landmarks.ts:54-63`) has its own one-off
  resolver and no validation. `expand[].template-ref` default `${path}`
  emits landmark-dir-relative refs (`src/core/landmark/resolve.ts:149-165`).
- Nav (`src/core/nav.ts:93-106`): bare-only box-root-relative; a leading `/`
  is rejected as a validation problem; `nav.card` is pinned to the box root
  (`NAV_CARD_PATH`, `nav.ts:20`) so the bare form is unambiguous in practice.
- Fragments/queries: `feedback.target.ref` is documented as `path#fragment`
  (`src/schemas/feedback.tsx:58-60`) but `resolveRefToPath` passes the
  fragment to the filesystem → false broken-ref warnings; the mv rewriter
  strips `#` only (`rewrite-card-refs.ts:41-45`), the frontend strips `?`
  before resolving (`view-url.ts:89-93`), CB002 strips `#` but not `?view=`.

**Convention-independent bugs** found during mapping (fixed by this plan):

- `create-after-success[].path`: `handleCreateAfterSuccess` does
  `path.join(boxRoot, chain.path)` + `mkdir -p` + write with no containment
  (`src/cli/commands/tick-utils.ts:154,184`) — a `../../…` path writes
  outside the box.
- `moveDir` rewrites refs in cards + views but not `.md` dossiers
  (`src/core/commands/move-operations.ts:107` vs `moveOne`'s referrer list
  at `:216-220` which includes `listBoxMarkdownFiles`).

Existing containment helpers to reuse, not rebuild: `containWithinBox` /
`resolveBoxRelativeRef` (`src/lib/box-containment.ts`), `realpathContained`
(same module family) — Track B's write-path fix is a call site, not new
machinery.

## Prior art (external)

- **Obsidian's link-format setting** is the direct precedent: three formats —
  "shortest path", "relative path from current note", "absolute path in
  vault" — with vault-absolute written *bare* (like our nav) and relative
  justified by co-move portability, the exact trade we resolved the other
  way for agent-authoring reasons. Obsidian pairs the convention with an
  automatic link-updater on rename — the analogue of `cb mv`'s rewriter —
  which is what makes a single canonical form livable.
  [Internal links — Obsidian Help](https://obsidianmd-obsidian-help.mintlify.app/linking/internal-links),
  [Toggle shortest and absolute path in vault — Obsidian Forum](https://forum.obsidian.md/t/toggle-shortest-and-absolute-path-in-vault/46744)
- **GitHub-flavored markdown** resolves leading-`/` links against the repo
  root when rendering in-repo files, so box `.md` dossiers viewed on a git
  host degrade less than feared — but generic editors/exports still break
  them; the decision accepts this.
- No named pattern found for "resolve-liberal / author-strict" path
  migration specifically; it is the standard lenient-reader/strict-writer
  posture (Postel) applied to stored refs. No further search targets — the
  mechanism is internal.

## Tracks / scope

Ordered by implementation dependency, then size.

### Track A — one shared ref algebra (`src/shared/ref-path.ts`)

**What.** A Node-free module (like `attach-path.ts`) owning the full ref
grammar: `parseRef(raw) → {path, query?, fragment?}` (scheme/`//`-detection
for externals stays with callers that need it), plus
`resolveRefPath({fromPath, ref, kind})` implementing the 3-form rule, plus a
single containment posture (resolve, contain, **fail closed** — an escaping
ref is null/broken everywhere, never clamped).

**Why.** Five resolver implementations (core validate, mv rewriter, frontend,
CB002, landmark render ×2) drift today: fragment/query handling differs per
layer, escape handling differs core-vs-frontend, the frontend reimplements
attach. Every drift is a live bug class (traces to one-way-to-do-it).

**Direction.** Consumers migrate in place, keeping their public signatures:
`ref-exists.ts` delegates path algebra but keeps `resolveContainedRef` as the
`BoxRelativePath` producer; `rewrite-card-refs.ts` uses `parseRef` so
`#fragment` *and* `?query` survive rewriting; `view-url.ts` keeps its
URL-building exports but drops its private algebra (imports via the `@shared`
alias, the `attach-path` precedent); CB002's `resolveInternalLink` delegates
(keeping its `.md`-has-no-attach-scope behavior via `kind: "markdown"` — see
vocabulary below); landmark `buildLink` and `readSymbol` switch to it, which
fixes leading-`/` landmark refs at render time. Fragment-bearing refs
(feedback `path#fragment`) stop false-flagging because existence checks run
on `parsed.path`.

**Vocabulary lock-ins.** `parseRef`, `resolveRefPath`, and a `RefKind`
union: `"card"` (attach form legal), `"markdown"` (no attach scope),
`"write-target"` (no attach form, containment mandatory). Names final at
first commit.

**Discoverability (boxholder emphasis: singular routines).** The module is
THE home for ref/path algebra, and that must be findable without archaeology:
`callback-box/CLAUDE.md` gets a one-line behavioral note ("All box ref/path
parsing and resolution goes through `src/shared/ref-path.ts` — never
hand-roll `path.resolve`/string-splitting on a ref"), `docs/module-map.md`
gets the entry, and the module's own doc comment names the consumers so the
next resolver-shaped temptation finds the existing one. Per
`callback-box/CLAUDE.md`: "new infrastructure isn't done until it's
discoverable."

**First implementation chunk.** `src/shared/ref-path.ts` + doctest
(`test/shared/ref-path.doctest.md`) covering the 3-form rule, fragment/query
splitting, attach-scope forms, and escape rejection; migrate `ref-exists.ts`
and `view-url.ts` onto it in the same chunk so the module has two real
consumers from day one.

### Track B — convention-independent bug fixes

**What.** (1) Contain `create-after-success[].path` writes:
`resolveBoxRelativeRef` (as `write-target`) before `mkdir`/write; an escaping
path is a logged per-chain error, skip the entry. (2) `moveDir` gains the
`listBoxMarkdownFiles` pass `moveOne` already has. (3) `cb validate` checks
inline markdown links in `.card` bodies: a new extractor over the body text
(same regex family the mv rewriter uses) feeding `resolveRefExists`, severity
warning like other broken refs.

**Why.** (1) is a box-escape write hole; (2) silently dangles `.md` links on
directory moves; (3) is the mv/validate asymmetry — mv rewrites what validate
never checks (traces to validate-at-boundaries, resilient-not-silent).

**Direction.** (1) and (2) are call-site fixes. (3): extraction lives next to
`extractBodyRefs` in `src/core/body-refs.ts`; reuse the mv rewriter's link
regex by exporting it from one place rather than a third copy.

**First implementation chunk.** All three plus doctests: a tick doctest
proving an escaping chain path is refused; a move doctest with a `.md`
referrer across `moveDir`; a card-lint doctest with a broken body link.

### Track C — chat re-base

**What.** All chat message markdown resolves bare paths from the box root:
links and card/file embeds join images (`makeLink`'s chat `basePath` and
`ChatImg`'s `resolveContentTarget` call go box-root). Update
`prompts.ts` Links/Embeds text ("always a leading `/`"; drop the
working-directory sentence) and the stale `MarkdownContent` doc comment.

**Why.** Completes the `49d881ca` half-fix; one message currently carries two
resolution bases. The decision explicitly accepts that old directory-bound
transcripts' bare links retarget on re-render (most bare links were intended
as box-root — that was the recurring bug).

**Direction.** `contextDir` remains the agent's *cwd* for file tools and the
session registry; it stops being a link-resolution base. Depends on nothing
(pure frontend + prompt text); listed after A only because A touches the same
file and landing A first avoids rebasing C's edits.

**First implementation chunk.** The rendering change + prompt text + comment,
with a frontend doctest/unit on chat link resolution in a directory-bound
chat.

### Track D — nav and landmark alignment

**What.** Nav: accept a leading `/` as equivalent to the bare form (drop the
rejection at `nav.ts:99-106`; both forms resolve box-root); schema prose and
examples switch to leading-`/`. Landmark: `ref`/`src` re-documented as box
paths with leading-`/` exemplars; `buildLink`/`readSymbol` on the shared
resolver (from A) so both forms render correctly; `symbol.src` gains
existence validation; `expand[].template-ref`'s default `${path}` emits the
box-root form (`/`-prefixed).

**Why.** Nav and landmark are the two schemas running private conventions in
opposite directions; both self-contradict or mis-render today (traces to
one-way-to-do-it; the landmark render split is resilient-not-silent).

**Direction.** `symbol.src` validation: rather than a general
declared-path-fields mechanism, landmark's existing schema-specific lint hook
(the same layer that validates its other structures) checks `symbol.src`
existence via `resolveContainedRef`; `figure.entry` gets the same targeted
existence check in the figure schema's lint (boxholder ruling — closes the
last known unvalidated path field). A general mechanism is NOT in scope
(below). Existing relative landmark/nav refs keep resolving unchanged.
Template-emitted refs are generated data, so changing the generator is not a
migration.

**First implementation chunk.** Nav acceptance + prose/example fix +
doctest (leading-`/` nav ref resolves; bare still resolves). Landmark chunk
follows as its own commit(s), dependent on A.

### Track E — guidance sweep + non-chat agent guidance

**What.** State the rule once, everywhere agents read: `agent-guide/cards.ts`
and `source.ts` change from "prefer the leading `/`" to the rule — *always a
leading `/`; the only exception is `attach/` for the card's own attachments;
never `../`* — with document-relative mentioned only as a legacy form that
still resolves. Sweep every exemplar to leading-`/` (landmark, nav, briefing
`key-people` example, gdoc/gsheet/recipe instruction snippets, the
capture-session example that omits its own required `attach/` prefix,
`docs/cards-as-markdown.md`). Add the link rule to reactor/procedure prompt
surfaces, which currently have none.

**Why.** Guidance is the lever that actually stops the recurring agent error;
mixed exemplars are why the model treats relative as fine (per the
bare-card-filenames investigation: the dominant pattern wins over the stated
rule).

**Direction.** Follow the "copy the style" precedent from the bare-filenames
fix — edit exemplars in place, add one prohibition line, no prompt growth
beyond that. The reactor/procedure addition is one short paragraph in their
shared guide surface, not a new guide.

**First implementation chunk.** The whole sweep is one chunk (mechanical,
one commit), after C and D so the prose describes shipped behavior.

### Track F — canonical-form validation + opt-in normalization

**What.** (1) `cb validate --canonical`: reports non-canonical refs (bare
document-relative cross-card refs, non-`attach/`) as warnings with a summary
count, off by default. Formal `[desc](link)` links in plain `.md` dossiers
are included (boxholder ruling), reported as their own summary bucket so
card-ref and dossier-link counts stay distinguishable. (2)
`cb validate --canonical --fix`: rewrites relative refs *that resolve* to
leading-`/` using the mv rewriter's resolution machinery (resolve against
the referring document, re-express from the box root); refs that don't
resolve are reported, never rewritten. This is the resurrection of
`issues/code-quality/2026-03-16-ref-path-normalization.md` and the migration
lever for existing boxes.

**Why.** The convention needs a mechanical backstop, but a default-on warning
would bury real broken-ref warnings under thousands of legacy-relative hits
(the ledger lesson: validator noise trains the boxholder to ignore it).
Off-by-default + `--fix` gives a box a one-command migration instead of a
permanent nag (traces to resilient-not-silent — keep the *broken* signal
clean).

**Direction.** Implemented on the shared resolver + existing extractors, so
its coverage is exactly validate's coverage. After a box is normalized the
boxholder can leave `--canonical` on in that box's habits; promoting it to a
default is a later call, not this plan.

**First implementation chunk.** Report mode + doctest; `--fix` as the second
chunk reusing `restyleRef`-adjacent machinery.

## Subplans

None. The one candidate — a general schema-declared path-field registry with
mv-rewrite coverage — is deliberately cut (NOT in scope) rather than
subplanned; Track D's targeted `symbol.src` validation covers the live gap.

## Failure modes

**Critical gap (accepted as documented risk):** old directory-bound chat
transcripts whose bare links *correctly* used `contextDir` retarget silently
on re-render after Track C. No test can distinguish intent; the decision
record accepts this (most bare links were intended box-root). Mitigation is
the guidance sweep making new transcripts unambiguous.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A ref escapes the box via `..` after Track A unification | A doctest (escape → null) | fail-closed everywhere (was: frontend clamp) | clear — broken-ref warning / dead link |
| `create-after-success[].path` written as `../../…` | B doctest | refused, per-chain logged error | clear |
| `#fragment` ref checked for existence | A doctest (feedback-form ref) | existence on `parsed.path` | clear — warning disappears (was false-positive) |
| `cb mv` drops `?view=` from a rewritten embed | A doctest (query survives rewrite) | `parseRef` round-trip | clear |
| Directory move leaves `.md` links dangling | B move doctest | `moveDir` scans `.md` | clear |
| Broken inline link in a `.card` body | B card-lint doctest | new extractor → warning | clear |
| Leading-`/` landmark ref rendered | D doctest on `buildLink` | shared resolver | clear (was: silent wrong path) |
| `symbol.src` target missing | D doctest | landmark lint existence check | clear (was: silent broken icon) |
| Leading-`/` nav ref | D doctest | accepted, resolves box-root | clear (was: validation error) |
| Old bare nav/landmark refs after the change | D doctests (bare still resolves) | resolve-liberal kept | clear |
| `--canonical --fix` rewrites a ref whose target doesn't exist | F doctest | skip + report (can't verify a resolution that resolves to nothing) | clear |
| Agent authors a bare relative ref post-change | knowledge audit (below) | still resolves (liberal); `--canonical` flags it | clear when `--canonical` run; silent otherwise — accepted, that's the opt-in design |

## Agent-flow / user-flow edge cases

- **Wrong form (bare where `/` wanted)** — ADDRESSED: still resolves
  (liberal); guidance sweep (E) attacks the cause; `--canonical` (F) detects;
  audits verify recall.
- **Stale ref after move** — ADDRESSED: unchanged `cb mv` rewriting, now with
  `.md` coverage on directory moves (B) and query/fragment preservation (A).
- **Two agents touching the same card** — ADDRESSED (no change): ref
  rewriting stays inside `cb mv`'s existing whole-file rewrite; no new
  concurrent-edit surface is introduced.
- **Hand-edit drift** (boxholder writes a relative ref by hand) — ADDRESSED:
  resolves fine forever; `--canonical --fix` normalizes when the box opts in.
- **Fabricated value** — not applicable: paths are checked against the
  filesystem; a fabricated path is a broken ref, covered above.
- **Validation error UX** — ADDRESSED: nav's new acceptance *removes* a
  confusing error ("must be box-relative (no leading /)" fired on the form
  every other surface teaches); `--canonical` warnings name the file, the
  ref, and the canonical rewrite.
- **Partial migration / transition state** — ADDRESSED by design: there is
  no transition state; liberal resolution is permanent, normalization is
  per-box opt-in, `cb mv` preserves whichever style a file has.

## NOT in scope

- **General schema-declared path-field registry + mv rewrite coverage for
  arbitrary fields.** Validate-side coverage for the two live gaps
  (`symbol.src` targeted in D; `figure.entry` — see open question 2) doesn't
  need the general mechanism, and mv-side coverage requires
  formatting-preserving YAML rewriting per field — real machinery for a
  long tail with no current instances beyond these. Revisit when a third
  field appears.
- **Removing document-relative resolution.** Permanent back-compat; the
  decision is explicit.
- **Default-on canonical warnings.** Off by default until boxes normalize
  (ledger noise lesson); promoting is a later boxholder call.
- **Pre-commit blocking on broken refs / basename repair job.** Separate
  open issue (`issues/bugs/2026-05-14-stale-image-refs-after-renames.md`);
  unchanged by this plan.
- **`expand[].query` globs and template-`${path}` rewriting under mv.**
  Globs are queries, not refs (by design); template-emitted refs are
  regenerated, not stored references to rewrite.
- **Retired `view:` scheme cleanup.** The legacy-view marker stays until
  controlled boxes are confirmed migrated; orthogonal to this plan.
- **Prod box normalization.** This plan ships the tools; running
  `--canonical --fix` on real boxes is an operational step the boxholder
  triggers per box, not part of the merge.

## Open design questions

None remaining — the three raised during drafting were ruled on by the
boxholder (2026-07-30) and folded into the track Directions:

1. **Nav canonical form**: leading `/` taught for uniformity; bare keeps
   resolving (Track D).
2. **`figure.entry`**: gains a targeted existence check alongside
   `symbol.src` (Track D).
3. **`.md` dossier links**: any formal `[desc](link)` in a `.md` is
   validated and `--fix`-normalized like card refs, reported as its own
   summary bucket (Track F).

The boxholder additionally emphasized: **a singular set of routines** — every
path/ref parse+resolve goes through the one shared module — including the
developer-instruction changes that keep it that way (Track A's
discoverability chunk).

## Knowledge audits

New agent-facing convention → audits are required, and run before the plan
completes (`pnpm knowledge-audit run --box <test-box> --filter links`):

- `links-always-box-root` (`knows_directly`): "You want to link to
  `store/notes/Plan.doc.card` from a chat reply — write the link." Asserts a
  leading-`/` target; regex-fails a bare or `../` form. (Extends the existing
  `chat-reference-card-as-link` / `internal-links-resolve-to-box-root`
  family.)
- `landmark-ref-box-root` (`knows_directly`): landmark `links[].ref`
  authored intuitively → leading-`/` form.
- `attach-is-the-exception` (`knows_directly`): "Where does
  `attach/photo.jpg` in `Trip.record.card` resolve?" — asserts the card's own
  attach scope, guarding the exception from being over-generalized away.

Per the run-what-you-author discipline, all three run against the test box
with status recorded in `knowledge-audits.yaml` before the plan is done.

## Implementation order

1. **A** — `shared/ref-path.ts` + migrate `ref-exists.ts`, `view-url.ts`.
2. **A2** — migrate `rewrite-card-refs.ts`, CB002/`relink`, landmark
   `buildLink`/`readSymbol` (unblocks D's landmark chunk).
3. **B** — the three bug fixes (independent of A2 except the fragment fix,
   which A already delivered).
4. **C** — chat re-base + prompt/comment text.
5. **D** — nav acceptance chunk; then landmark chunk (docs, `symbol.src`
   validation, template default emission).
6. **E** — guidance/exemplar sweep + reactor/procedure guidance (after C+D
   so prose matches behavior).
7. **F** — `--canonical` report; then `--fix`.
8. **G** — knowledge audits authored AND run; decision-issue updated to point
   here; `issues/code-quality/2026-03-16-ref-path-normalization.md` closed as
   subsumed (resolution: implemented, pointing at F).

Each numbered step is one-or-few commits in this worktree; the plan ships as
one unit via /finish when all complete (no partial merge to main).

## Rollout shape

- **Tests first, per track**: each track's first chunk names its doctest
  above; the plan's done-when is those doctests passing plus the three
  knowledge audits recorded. New doctests: `test/shared/ref-path.doctest.md`,
  additions to the move-operations, card-lint, tick, nav, and landmark
  doctest files (existing files extended, mirroring src paths).
- **Knowledge audits** land with Track G, run, status recorded.
- **Migration**: none required for correctness (liberal resolution is
  permanent). `--canonical --fix` is the opt-in normalizer; running it on
  test1 is part of G's verification (confirm a real box round-trips), running
  it on prod boxes is a post-ship operational step at the boxholder's
  discretion.
- **Docs**: `docs/cards-as-markdown.md` ref section rewritten to the new
  rule (Track E); this plan moves to `docs/implemented-plans/` at /finish.

## Status (2026-07-30) — complete

Every item in the implementation order landed on `worktree-path-handling-model`:

| Track | Commits |
|-------|---------|
| A — `shared/ref-path.ts` + `ref-exists`/`view-url` migration | `52bcd398`, `087cc66a` |
| A2 — mv rewriter, CB002/`relink`, landmark `buildLink`/`readSymbol` | `509e3852` |
| B — the three bug fixes (`create-after-success` containment, `moveDir` dossiers, body-link validation) | `d1fb9b3d`, `3ce2ec12`, `e2fb7f7e` |
| C — chat re-base + prompt/comment text | `ea4bd901` |
| D — nav acceptance, then landmark (docs, `symbol.src`/`figure.entry` validation) | `3154cde1`, `1b5a187d` |
| E — guidance/exemplar sweep, rule stated once as `REF_PATH_RULE` | `d339b944` |
| F — `cb validate --canonical`, then `--fix` | `2c52f610` (issue bookkeeping: `e714f8df`) |
| G — knowledge audits authored + run, issue bookkeeping | `dbb0320c`, `a1abcdd2` |
| Post-review hardening (cross-model review round) | `21e270f9` |

The hardening round came from a Codex review of the full branch diff: empty
(`""`/`#only`/`?only`) refs and the box root itself are no longer addressable
targets (broken-ref warning instead of a directory passing `access()`); the mv
rewriter classifies externals via the shared `isExternalRef`; frontmatter
rewriting skips YAML block scalars and preserves trailing `# comments`
(previously such refs were silently skipped); `--canonical --fix` is
fence-aware while `cb mv` deliberately still rewrites fenced examples (intent
difference documented at `BodyScanOptions`). Known safe-direction gap recorded
in `rewrite-card-refs.ts`: inline-map ref forms (`- { ref: x }`) are skipped,
never corrupted.

Track G specifics:

- Three audits added to `src/dev/knowledge-audits.yaml` —
  `links-always-box-root`, `landmark-ref-box-root`, `attach-is-the-exception`
  (all `knows_directly`, tagged `links`/`paths`). All three pass on the first
  run against a test1 clone with no guidance change needed; the four existing
  `links`-tagged audits were re-run and still pass. Status recorded in the YAML.
- `--canonical --fix` round-tripped on a real box (test1 clone): 20 refs in 6
  files rewritten to box-root form — including `- ref:` block-list items and a
  `../`-climbing landmark ref — with the remaining ~2.7k non-canonical refs
  left alone because their targets don't exist. Confirms the normalizer touches
  only what resolves.
- The decision issue (`issues/closed/decisions/2026-07-30-always-box-root-relative-links.md`)
  is closed `resolution: implemented` pointing here;
  `issues/bugs/2026-05-14-stale-image-refs-after-renames.md` stays open (its
  repair-job / pre-commit-blocking questions are untouched by this plan) with a
  note that the mv rewriter now covers block-list refs.
