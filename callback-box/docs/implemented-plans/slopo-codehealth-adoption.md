---
title: "slopo adoption + duplication triage"
status: implemented
workstream: unknown
issues: []
---
# slopo adoption + duplication triage

Adopt `slopo` (embedding-based near-duplicate detector) as an **optional,
agent-triaged deep-scan inside the `cb-codehealth` skill** — never a CI gate —
and act on the concrete cross-module duplication the evaluation already
surfaced in `callback-box/src`. The two are separate tracks: Track A wires the
tool into the health workflow; Track B consolidates the specific duplicates —
combining each into one implementation and pushing the change upstream to
callers, *drifted* copies first (they're latent bugs) but not stopping there.
Consolidation is the goal; a wide diff or a data migration is accepted cost, not
a reason to leave a duplicate standing. What stays out of Track B is *noise*
(trivial one-line comparators, within-file repetition) — routed to
`slopo.ignore.txt`, not consolidated — and the systemic REST/tRPC duplication,
which is a seam decision deferred to a subplan.

The evaluation that motivates this plan is recorded at
`docs/implemented-plans/slopo-evaluation.md`: 105 clusters on a clean run,
~68 cross-file, with a clear signal/noise split.

## Status — implemented 2026-07-02

Track A (slopo wired into `cb-codehealth`, config at `tools/slopo/`) and Track B
(the duplication consolidations) shipped; see the `feat(codehealth)` and
`refactor(dedup)` commits. Re-running slopo on the consolidated tree confirmed
all consolidated helpers dropped out of the report. Two places the
implementation diverged from the proposal below:

- **The `slugify` data migration proved unnecessary.** Checking callers showed
  the feedback slug only feeds a timestamp-prefixed, write-once filename that is
  never looked up by recomputed slug, so unifying to the canonical `slugify`
  changes only the cosmetic slug portion of *future* filenames — no on-disk
  migration (the "verify callers before assuming" path in the posture below).
- **The REST/tRPC systemic consolidation remains an open follow-up** — its own
  subplan, never part of this plan's committed scope. Those clusters are left
  visible in the slopo report (out of `slopo.ignore.txt`), not consolidated.

## Stated preferences this plan trades against

- **`callback-box/CLAUDE.md`** — project conventions; doctests are the primary
  test format (`callback-box/CLAUDE.md:101`: *"Doctests are the primary test
  format."*).
- **`callback-box/code-style.md`** — style preferences; the centralise-a-cast
  pattern (`callback-box/code-style.md:55`: *"centralize the cast in a single
  well-named typed helper … that does it once and is reused"*) is the same
  instinct that justifies consolidating a genuinely-duplicated helper.
- **`.claude/skills/cb-codehealth/SKILL.md`** — the health philosophy this
  plan must not violate. Two load-bearing citations:
  - `SKILL.md:16-19` (the aim is **deep modules**, *"interface nearly as
    complex as the implementation"* is the enemy) — so consolidation is only
    a win when it concentrates complexity, not when it smears a shallow
    "utils" grab-bag into existence.
  - `SKILL.md:118` (*"One adapter = a hypothetical seam; two = a real one.
    Don't introduce the interface until a second implementation actually
    exists."*) — slopo's job is precisely to *find the second adapter*, which
    is why it fits, but the same rule guards against over-consolidating.
- **`docs/testing.md`** — tests are not for coverage (`docs/testing.md:11`:
  *"What tests are NOT for: … achieving coverage percentages"*); consolidations
  get a regression doctest only where a real codepath changes.

Every finding below traces to one of these.

## What already exists

- **`cb-codehealth` already has a "Scan for friction" step** built on runnable
  tooling — `SKILL.md:45-51` lists `pnpm lint:knip`, `pnpm lint:circular`,
  `pnpm lint:oxlint`. slopo slots in here as a fourth concrete signal. The skill
  already names *"duplicated logic"* as a friction to note
  (`SKILL.md:70-71`). **Track A reuses this section, does not rebuild it.**
- **Runnable health scripts exist** in `package.json:40-42`
  (`lint:oxlint`/`lint:knip`/`lint:circular`). A slopo invocation is a
  peer of these but is *not* added to `package.json` (see Failure modes —
  it needs an API key and network, unlike the offline linters).
- **A shared `src/lib/` already exists** (`filename.ts`, `exec-with-timeout.ts`,
  `errors.ts`, `awake-timeout.ts`, …) and already exports a canonical
  `slugify` — `callback-box/src/lib/filename.ts:63`:
  *"export function slugify(text: string, options?: SlugifyOptions): string"*.
  Track B **reuses this home** for genuinely-shared helpers rather than
  inventing a new one.
- **The evaluation config + report** exist at `slopo-eval/` in this worktree,
  but are **currently untracked** — nothing has been committed and no `.gitignore`
  entries exist yet. Track A is what *creates* the committed state: it moves the
  config to a committed home, populates `slopo.ignore.txt`, and adds `.gitignore`
  entries for `slopo.db` (30 MB) and the report dir. Do not read this bullet as
  "already done"; it describes the raw material Track A turns into the committed
  artifact.

## Prior art (external)

- **slopo itself** — `github.com/rafal-qa/slopo`. Verified during the eval:
  installs via `uv tool install slopo`; `init/index/embed/analyze`; LiteLLM
  backend (Voyage recommended for code, OpenAI works); `slopo.ignore.txt`
  persists reviewed clusters across runs; some config keys (`source_dir`,
  `embedding_model`, `embedding_dimensions`, `body_node_count_threshold`) are
  frozen after first index. Source of truth over any summary.
- **Verified limitation (from the eval, not the docs):** `source_dir_exclude`
  does **not** exclude `node_modules` by default — the first run was 71%
  vite-bundle noise until `**/node_modules/**` was added. This is a real
  gotcha the committed config must encode.
- **No prior art searched for "how to integrate a near-dup detector into an
  internal health skill"** — this is an internal workflow decision with no
  external dependency; skip-with-rationale applies.
- **The deep-module philosophy** (`cb-codehealth`'s frame) is Ousterhout's
  *A Philosophy of Software Design*; already the skill's stated basis, no new
  search needed.

## Tracks / scope

### Track A — wire slopo into cb-codehealth (do first; unblocks nothing but is the smaller surface)

**What.** Add slopo as an *optional deep-scan* the health pass can run over one
package, with an agent-triage step that filters clusters through the
deep-module lens and records won't-fix decisions in `slopo.ignore.txt`.

**Why this needs to change.** The eval showed slopo finds cross-module
duplication that `knip`/`oxlint`/`madge` structurally cannot — especially
*drifted* copies (same function, diverged bodies) that are latent bugs. But
its raw output is ~1/3 noise (trivial one-line comparators, within-file
adjacent arrows, one semantic false positive pairing opposite predicates).
It is only useful *with* a judgment pass, which is exactly what an
agent-triaged skill step provides and a CI gate cannot.

**Direction.**
- Add a new subsection to `SKILL.md` §1 ("Scan for friction"), after the
  offline-linter list, titled roughly *"Optional: near-duplicate deep-scan
  (slopo)"*. It documents: prerequisites (`uv tool install slopo`, an OpenAI
  embeddings key in env), the one-package scoping rule, and the triage loop.
- The triage loop is the load-bearing part and must state the **filter
  criteria** explicitly, because the skill's own philosophy rejects mechanical
  dedup (`SKILL.md:16-19`, `SKILL.md:118`):
  1. **Drifted duplicates first** — copies whose bodies have diverged are
     ranked highest; they are bug signals, not just cruft.
  2. **Systemic duplication second** — many clusters pointing at one seam
     (e.g. the REST/tRPC pair) is an architecture conversation, not N edits.
  3. **Trivial one-liners and within-file repetition → straight to
     `slopo.ignore.txt`** — consolidating `(a,b) => a.name.localeCompare(...)`
     buys nothing and a shared-util grab-bag is *anti*-depth.
- Commit `slopo-eval/slopo.conf.yaml` (renamed/moved to a committed home —
  see open questions) with the `node_modules`/`dist`/`build`/test excludes,
  plus an initially-populated `slopo.ignore.txt`. Gitignore `slopo.db` and the
  report dir.
- **Explicitly not** added to `package.json` scripts, and **explicitly not** a
  husky hook or CI step (the boxholder ruled out CI gating; the network+key
  dependency makes it a poor fit for the offline linter row anyway).

**Vocabulary lock-ins.** Use the skill's existing vocabulary
(`SKILL.md:23-24`: *"module / interface / implementation / depth / seam /
adapter / leverage / locality"*). A slopo cluster is evidence of a possible
**seam**, not a mandate to extract one. Do not introduce "duplication score"
or "clone" as new first-class terms.

**First implementation chunk.** Write the `SKILL.md` §1 subsection + the
triage-loop criteria; land the committed `slopo.conf.yaml` at its committed home
+ `.gitignore` entries for `slopo.db` and the report dir. Two things the eval
left undone that this chunk must actually do, not assume:
- **Populate `slopo.ignore.txt`.** The eval's ignore file is a bare header with
  zero dismissed hashes, so the "trivial one-liners stay quiet" behaviour is
  *claimed but unverified*. This chunk runs the triage once and writes the
  trivial-cluster hashes (the localeCompare/comparator clusters, the
  opposite-predicate false positive, the within-file arrows) into
  `slopo.ignore.txt`, then re-runs `analyze` to confirm they drop out. That
  re-run *is* the verification.
- **Pin the index root so ignore hashes stay stable.** slopo's cluster hashes
  depend on file paths relative to the index root. Moving the config to its
  committed home changes `source_dir`'s resolution, which can invalidate every
  ignored hash. The skill subsection must document the exact working directory +
  `source_dir` the committed config assumes, so a future run reproduces the same
  hashes and `slopo.ignore.txt` keeps matching. (Verify by re-running from the
  documented root and checking the ignored clusters still resolve.)

No open questions inside this chunk.

### Track B — consolidate the surfaced duplication (do second; depends on nothing in Track A but is the larger, riskier surface)

**What.** Act on the concrete clusters from the eval, in priority order. Each
is a separate commit; a couple are real seam decisions that may themselves
warrant a subplan.

**Consolidation posture (the governing rule for this track).** Default to
*full* consolidation. When two functions do the same job, **combine them into
one and push the change upstream to every caller** — changed signatures, new
imports, and wide diffs are acceptable and expected here; cleanliness is the
priority, not minimizing the diff. Where two copies differ only in a default or
small policy, unify to one helper and move the differing bit to a
**caller-supplied argument** (a real parameterisation, not a shallow
mode-flag). Where consolidation changes on-disk data (filenames, hashes),
**migrate the existing data** rather than preserve the old drifted shape — the
migration is real work to plan, not a reason to skip. This posture overrides
the "a 2-line helper may be cheaper duplicated" hedge; the deep-module rule
still applies to *shape* (don't build a shallow `utils` grab-bag; give shared
helpers real homes in `src/lib/` or a subsystem), but "avoid touching callers"
is not a reason to leave a duplicate standing. The one genuine exception: two
functions that only *look* alike but encode different intent — verify the
callers before assuming that, don't assume it to save work.

**Why this needs to change.** Several clusters are *drifted* — same-named
function, diverged behaviour — which means a caller gets subtly different
results depending on which copy it reached. That is a latent-bug class, and it
traces directly to the health frame (`SKILL.md:70-71` names duplicated logic as
friction).

**Direction — the concrete inventory (all line numbers verified):**

*Drifted duplicates (bug signal — highest priority):*
- `mimetypeToExtension` — `core/commands/create.ts:231` vs
  `webapp/routes/commands.ts:216`. The maps have **diverged**: one has
  `heic/heif/video/*`, the other has `pdf/txt/json`. Reconcile into the
  **union** map, home it (likely `src/lib/`), delete both copies, update both
  call sites.
- `slugify` — `cli/commands/feedback.ts:23` duplicates and *drifts from* the
  canonical `lib/filename.ts:63`. The two are **not interchangeable**: feedback
  keeps underscores (`\w`), defaults to 40 chars, and does *not* trim trailing
  hyphens after slicing; the canonical drops underscores, defaults to 50, and
  trims after slicing. So a blind import changes the slugs feedback produces.
  Per the consolidation posture, the resolution is **unify to the canonical
  `lib/filename.ts` and migrate**, not preserve the drift: (a) delete the
  `feedback.ts` copy and call `slugify` from `lib/filename.ts` with an explicit
  `maxLength: 40` if 40 is still wanted; (b) since this changes future feedback
  filenames, **migrate existing feedback-card filenames** to the canonical shape
  (a `scripts/migrate/*.ts` pass — this is the real work, see Rollout) and
  update any refs; (c) a compatibility doctest pins the *new* canonical shape.
  (Note: `shared/markdoc-config.ts:73` `slugifyHeading` is a genuinely
  *different* function — heading anchors — and is **not** in scope; it's the
  "different intent" exception.)
- `getPublicUrl` — `core/chat-session-pool.ts:20` (`""` fallback, used at
  `chat-session-pool.ts:179` to *omit* `sessionViewBaseUrl` when empty) vs
  `webapp/auth.ts:51` (`"http://localhost:3210"` fallback, needed to build an
  OAuth redirect URI). **This one needs a caller check first** — the differing
  fallbacks may encode two real policies (auth *requires* a concrete base;
  chat deliberately emits nothing). Per the posture, the resolution is still to
  **unify to one `getPublicUrl(fallback)` helper and push the fallback to each
  caller** (auth passes `"http://localhost:3210"`, chat passes `""`), not to
  keep two copies — but this is a *parameterisation*, and it must not silently
  flip either caller's behaviour. Verify the two call sites before landing;
  demoted out of the first chunk because it needs that check.
- `baseServerUrl` — `webapp/routes/admin.ts:50` vs
  `webapp/trpc/routers/admin.ts:12` (the route copy trims a trailing slash, the
  tRPC copy doesn't — this is **URL-normalisation drift**, not error handling).
  Folds into the systemic item below.

*Clean shared-util candidates (real homes, per the posture):*
- `entrySelfNotes` / `getSelfNotes` — `frontend/.../chat/message-parsing.ts:18`
  vs `cli/commands/session-render.ts:63`. **Exact same body, different names**,
  both already sitting on shared `core/self-note` semantics — the single most
  obviously-reusable item in the eval. Pick one name, home it next to
  `parseSelfNotes`, delete the other, update both callers. Strongest candidate
  in this group.
- `contentHash`/`hashContent` sha256-slice(16) ×4 — three connectors
  (`connectors/drive-handler-sheets.ts:30`, `drive-handler-docs.ts:49`,
  `google-calendar-state.ts:44`) + `core/search/search-store.ts:100`. Unify to
  one exported helper; the three connector copies are the clearest case.
- `sleep(ms)` ×4 — `cli/lib/git-internal.ts:61` (already exported),
  `core/commands/scan-import-helpers.ts:162`, `core/reactor/engine.ts:399`,
  `webapp/tts-mock.ts:35`. Consolidate to one `src/lib/` export and update the
  four call sites. (Earlier lean was "maybe leave it"; the consolidation
  posture overrides that — combine.)
- Others from the report (`decodeXmlAttr`, `isRecord`, `parseAttrs`,
  `fileExists` ×3, `dropUndefined`, `wordCount`, the `log()` prefix helper
  ×6 across `core/chat-session-*.ts`) — consolidate each into a real home;
  use the deletion test (`SKILL.md:37-39`) only to pick the *home*, not to
  decide whether to act.

*Systemic (its own decision — candidate subplan):*
- **REST routes ⇄ tRPC routers** — `webapp/routes/*` and
  `webapp/trpc/routers/*` are parallel implementations of the same endpoints
  (status, admin, commands, calendar, debugLog, inbox — ~13 clusters). The
  concrete evidence in-hand is *behavioural* drift between paired handlers: the
  telegram-disconnect pair (`routes/admin.ts` vs `trpc/routers/admin.ts`, eval
  cluster C35) swallows `ENOENT` differently, and `baseServerUrl` above
  normalises URLs differently. Whether the drift is broader than these specific
  pairs is exactly what the subplan must establish — don't assert
  "drifted in error handling" wholesale without the per-endpoint audit. This is
  a real **seam** question (which side is canonical, per
  `callback-box/CLAUDE.md`'s "raw routes are tech debt — migrate when you touch
  the area"), not a mechanical dedup, and warrants its own design step.

**Vocabulary lock-ins.** None new. Consolidated helpers keep their existing
names where a canonical one exists (`slugify`, `sleep`, `contentHash`).

**First implementation chunk.** The two *unambiguous* consolidations —
`mimetypeToExtension` (union map) and `entrySelfNotes`/`getSelfNotes` (exact
duplicate) — each a self-contained commit with a regression doctest and no open
questions inside. `slugify` (needs a filename migration) and `getPublicUrl`
(needs a caller check) are chunk 2, not chunk 1, because each has a real
decision inside it.

## Subplans

- **REST/tRPC consolidation** (`slopo-codehealth-adoption.rest-trpc.subplan.md`,
  to be written if Track B reaches it). It has its own decisions: is tRPC the
  survivor and REST the tech-debt layer (or vice-versa), what's the migration
  order, what behaviour is load-bearing (Hyrum's Law, `SKILL.md:99-101`). This
  does **not** belong inline — it's a genuine architecture decision, and the
  eval only surfaces *that* the duplication exists, not *which* side wins.
  The parent plan links it as a dependency; both ship together only if the
  boxholder chooses to take it on.

## Failure modes

**Critical gap:** none. The riskiest codepath is a consolidated helper changing
behaviour for one of its former callers — addressed below with regression
doctests + the drifted-copy reconciliation being an explicit *decision*, not a
silent pick-one.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Consolidating `mimetypeToExtension` silently drops a mapping one caller relied on (e.g. webapp's `pdf`/`json`, or core's `heic`/`video`) | No — add doctest asserting the **union** map | The reconciliation is a deliberate merge of both maps, not pick-one | Would be silent (`?? ".bin"` fallback hides a missing key) — the doctest makes it clear |
| `getPublicUrl` unification flips a caller's fallback (chat starts building a localhost URL, or auth starts getting `""` and produces a broken OAuth redirect) | No — add doctest per caller's expected fallback | Push the fallback to a caller arg; verify both call sites (`chat-session-pool.ts:179`, auth redirect build) preserve current behaviour | Silent (a broken redirect URI or a spurious `sessionViewBaseUrl` surfaces far downstream) — **caller check before landing** |
| `slugify` unification changes an existing on-disk slug for `feedback` cards → filename churn / broken refs | No — add doctest pinning the new canonical slug on representative inputs | **Migrate** existing feedback-card filenames + refs to the canonical shape (a `scripts/migrate/*.ts` pass), don't preserve the drift | Silent until a ref breaks — the migration is the handling, not a "verify then maybe skip" |
| slopo run in the skill hits no API key / offline | N/A (skill step) | Skill documents the key prereq and treats absence as "skip the deep-scan," not an error | Clear — the step is optional by design |
| `slopo.db` (30 MB) accidentally committed | N/A | `.gitignore` entry lands with Track A chunk 1 (does not exist yet) | Clear — git status shows it |
| slopo re-run after code changes re-flags an already-triaged cluster | Yes — Track A chunk 1 populates `slopo.ignore.txt` and re-runs `analyze` to confirm | `slopo.ignore.txt` persists decisions; hashes stay stable only if the index root is pinned (Track A documents it) | Clear *once populated* — the eval's ignore file was empty, so this is a build task, not a given |

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — **N/A**. This plan adds no card schema or tag;
  it's tooling + refactor.
- **Stale ref** — **ADDRESSED** (as a migration): the `slugify` unification
  changes feedback-card filenames, which could orphan a ref; the resolution is
  a `scripts/migrate/*.ts` pass that rewrites the filenames *and* their refs
  together, not a "leave it alone" — see the Failure-modes row and Rollout.
- **Two agents touching the same card** — **N/A**. No card mutation.
- **Hand-edit drift** — **N/A**. No new hand-editable surface.
- **Fabricated free-form value** — **ADDRESSED** by design: the triage loop
  ranks *drifted* and *systemic* clusters and sends trivial ones to
  `slopo.ignore.txt`, so the agent isn't invited to invent consolidations for
  noise (`SKILL.md:16-19` is the guard).
- **Validation error UX** — **N/A**. No validation path added.
- **Partial migration / transition state** — **ADDRESSED**: Track B commits are
  independent; a drifted-util reconciliation lands whole (both copies replaced
  in one commit) so there's no window where callers see two behaviours. The
  REST/tRPC subplan is where a real transition state would live, and it's
  explicitly deferred to its own design.

## NOT in scope

- **CI gating / husky hook / `package.json` script for slopo** — the boxholder
  ruled out CI gating; the network+key dependency makes it a poor offline-lint
  peer. slopo stays a manual, skill-invoked step.
- **Running slopo across the whole monorepo** (callback-clerk, agent-doctest,
  personal-vibe-check) — Track A scopes to one package at a time;
  `callback-box/src` is the surface with the most cross-module drift. Widen
  later only if cheap and useful.
- **The REST/tRPC consolidation itself** — surfaced here, deferred to a subplan;
  it's an architecture decision, not a dedup, and shipping Track A/B doesn't
  require settling it.
- **Voyage `voyage-code-3` embeddings** — OpenAI `text-embedding-3-small`
  produced actionable results at ~$0.02; a code-tuned embedder is optional
  polish, not a blocker. Left as an open question, not scope.
- **Auto-applying slopo's suggestions** — slopo surfaces, humans/agents triage.
  No code auto-applier (consistent with the boxholder's standing preference to
  arrange context, not automate judgment).

## Open design questions

- **Where does the committed slopo config live?** Lean: a small
  `callback-box/tools/slopo/` (or `dev/`) dir holding `slopo.conf.yaml` +
  `slopo.ignore.txt`, referenced from the skill. Not `slopo-eval/` (that's the
  throwaway eval dir).
- **Which home for each consolidated helper?** Not *whether* to consolidate
  (the posture settles that — combine), but *where*: `sleep`/`dropUndefined`/
  `wordCount` into `src/lib/`; `contentHash` likely alongside the search/hash
  code or `src/lib/`; `entrySelfNotes` next to `parseSelfNotes` in
  `core/self-note`. Pick the home that keeps the helper near its center of
  gravity, not a catch-all `utils.ts`.
- **Voyage vs OpenAI embeddings** — worth one comparison run if a Voyage key
  appears; not otherwise. No lean beyond "OpenAI is sufficient."
- **Does the REST/tRPC subplan get taken on now or shelved?** Boxholder's call;
  the parent plan completes without it.

## Knowledge audits

**Skip-with-rationale.** This plan is infrastructural + a refactor. Track A adds
a *skill workflow step*, not a box-agent-facing convention (the box agent
running in `~/src/boxes/*` never invokes `cb-codehealth`; that's a dev-repo
skill). Track B consolidates helpers without introducing any new
"this is how you do X" rule an agent must recall. No
`knowledge-audits.yaml` entry is warranted. (If the skill edit ends up
teaching a durable *dev-agent* convention worth recall-testing, revisit — but
the skill body is loaded on invocation, so an audit adds little.)

## Implementation order

1. **Track A, chunk 1** — `SKILL.md` §1 slopo subsection + triage criteria;
   commit the slopo config to its committed home; **populate `slopo.ignore.txt`
   and re-run `analyze` to verify** the trivial clusters drop; document the
   pinned index root; `.gitignore` for `slopo.db`/report dir.
2. **Track B, chunk 1** — the two unambiguous consolidations
   (`mimetypeToExtension` union map; `entrySelfNotes`/`getSelfNotes` exact
   duplicate), each its own commit with a regression doctest. No decisions
   inside.
3. **Track B, chunk 2** — the consolidations with a decision inside: `slugify`
   (unify to canonical **+ filename migration** for existing feedback cards),
   `getPublicUrl` (unify to one `getPublicUrl(fallback)` **after** the two-caller
   check), and the remaining clean utils (`contentHash` trio, `sleep` ×4,
   `decodeXmlAttr`, `isRecord`, `parseAttrs`, `fileExists`, `dropUndefined`,
   `wordCount`, `log()` ×6) — each combined and pushed to callers.
4. **Subplan (optional)** — write and, if the boxholder chooses, execute the
   REST/tRPC consolidation as its own plan.

Tracks A and B are independent (Track A doesn't block Track B); ordered here by
surface size and bug-value. The plan completes when chunks 1–3 land; the subplan
ships with it only if taken on.

## Rollout shape

- **Test posture.** Per `docs/testing.md:11` (tests are not for coverage), the
  behaviour-changing consolidations get a doctest, and the doctest is the design
  tool: each gets a doctest asserting the *reconciled* contract (the union
  mimetype map; the chosen slug shape for representative inputs; each
  `getPublicUrl` caller's preserved fallback) **before** the merge, so
  "done-when" is a passing assertion, not a vibe. Pure-mechanical consolidations
  where behaviour is provably identical (`entrySelfNotes`/`getSelfNotes` — byte-
  identical bodies) get a doctest only if one didn't already cover the path. The
  skill edit (Track A) has no runtime codepath and gets no test.
- **Knowledge-audit entries.** None (see Knowledge audits).
- **Migration approach.** One real stored-data migration: the `slugify`
  unification changes the slug that `feedback` cards are named with, so existing
  feedback-card filenames (and any refs to them) must be rewritten to the
  canonical shape. This is a `scripts/migrate/*.ts` pass following the existing
  migrator pattern (`callback-box/CLAUDE.md`: *"`scripts/migrate/*.ts` … are the
  per-schema migrators with noisy-mode field-loss detection"*), run against
  every box during rollout — **not** avoided by preserving the drifted shape.
  Per the consolidation posture, migrating the data is the correct cost; keeping
  two slug functions to dodge it is not. `mimetypeToExtension`, `getPublicUrl`,
  and the util consolidations touch no stored data. If the migration surface
  turns out larger than a single script (e.g. refs embedded in many card
  bodies), the `slugify` item escalates to `cb-migration` for its own pass.
- **Ship as one unit.** Track A + Track B chunks 1–3 land together on the
  worktree branch and merge only on the boxholder's explicit signal; the
  REST/tRPC subplan is a separate ship decision.
