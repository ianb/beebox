---
title: "One-root box layout (shapeVersion 3)"
status: partial
workstream: box-layout-criteria
issues:
  - ../../../issues/closed/code-quality/2026-08-17-package-root-vs-content-dir-keeps-causing-bugs.md
---
# One-root box layout (shapeVersion 3)

A box currently has two roots: the package root (`package.json`, `src/`,
`.claude/`) and the operational root (`content/`, everywhere called `boxRoot`).
Callers keep picking the wrong one — four filed instances of the bug family,
plus a fifth found during this plan's research (see "The evidence" below).
This plan collapses the layout to **one root**: the package root becomes the
box root, and the operational areas become a closed, underscore-marked
vocabulary of top-level directories. `content/` shrinks to `_content/` and
holds only user content. The wrong-root bug class is removed structurally —
there is no second plausible root to pass — rather than defended against.

The criteria this layout is a consequence of were agreed with the boxholder
in the box-layout-criteria workstream session (2026-09-02..04):

1. **Wrong root fails hard.** No interface silently accepts the wrong
   directory; there should ideally be no wrong directory to pass.
2. **Closed vocabulary at the box root.** A fixed set of top-level names;
   anything else is a validation error. Open vocabulary *inside* `_content/`.
3. **Every path says what it is relative to.** One meaning for a leading `/`
   in box refs. Box paths are recognizable *as* box paths: because agents also
   handle real filesystem-absolute paths, the box namespace carries a visible
   marker — the underscore prefix on its root vocabulary — so
   `/_config/box.json` cannot be confused with `/etc/hosts` ("the `C:`
   concept": the namespace itself is unambiguous, boxholder 2026-09-04).
4. **No absolute machine paths** in cards, refs, prompts, or generated docs.
5. **Agents never rely on cwd** for authored content (already the written
   rule; extended to host-side code).
6. **Installability stays.** A box remains a package pinning its own engine
   (`docs/implemented-plans/boxes-as-packages-v2.md`).
7. **One migration.** Boundary, vocabulary, and interior depth change
   together so the fleet moves once.

This retires v2's "decision 1" ("the root for normal operations must be a
single directory that does NOT contain `package.json`",
`docs/implemented-plans/boxes-as-packages-v2.md:23-25`) — explicitly, with the
boxholder's consent, not by erosion. What that decision protected survives in
other forms: user content is still one clean subtree (`_content/`), and
machinery is fenced by the closed vocabulary and ref validation instead of by
directory nesting.

**Issues addressed:**
`issues/code-quality/2026-08-17-package-root-vs-content-dir-keeps-causing-bugs.md`
(the anchor; fully resolved). Related but NOT resolved here:
`issues/bugs/2026-08-17-add-box-script-targets-a-service-that-no-longer-exists.md`
(the deploy script needs its own rewrite; this plan changes the paths it must
use, so do it after or with Track E),
`issues/code-quality/2026-07-19-thread-authoritative-box-slug.md` (slug
derivation from disk — orthogonal; the slug source directory does not change),
`issues/features/2026-07-28-directories-as-viewable-things.md` (what a
directory *is* inside a box — this plan only moves directories, it does not
redefine them). Grep of the queue for `layout`, `box-shape`, `package root`,
`content dir`, `slug` found no other open items (closed:
`2026-07-11-v2-box-slug-from-boxroot-basename.md`,
`2026-08-21-dashboard-header-names-the-box-content.md` — both symptoms of the
two-root shape this plan removes).

## The evidence (why now)

The anchor issue records four instances of one bug family. Research for this
plan found a fifth, live and undetected for two months: on 2026-07-04,
immediately after `box-packageify` converted `test1`, a template-sync run was
handed the package root and **committed** a full parallel template set
(~2,000 lines — guide cards, personality, procedures, schedules,
`template-versions.json`, `views/CLAUDE.md`) into `<packageRoot>/config/`
(test1 commit `678cc30f "Sync templates from upstream"`, immediately after
`e7152b50 "migrate: box-packageify"`). Both copies have since diverged.
Nothing crashed and nothing warned: the wrong-root write *succeeded* and
produced a plausible-looking tree. Under this plan that write is impossible
(there is no second root) and, if some future bug recreated the shape, the
closed-vocabulary check (Track C) flags it within one `bbx validate`.

A call-site inventory (research pass, 2026-09-02) found: ~60 interior call
sites take `boxRoot` meaning the content dir, consistently; ~8 need the
package root via `BoxShape`; **three** separate bilingual resolvers exist
(`resolveBoxRoot` `src/hub/child-spawn.ts:80`, `resolveServableBoxRoot`
`src/cli/commands/serve.ts:67`, `resolveOperationalRoot`
`src/lib/box-shape.ts:139`) with different tolerance; and the two manifests
disagree (`hub.json` stores package roots — `src/hub/hub-config.ts:140-159`
resolves them — while `~/.config/beebox/boxes.json` stores content dirs and
its scheduler consumer uses them unresolved). The interior is fine; every bug
lives at the edges where a raw string arrives. One root removes the edge.

## Stated preferences this plan trades against

- **Principle 1 (Types are structure)** and **Principle 3 (Validate at
  boundaries)** — `docs/engineering-principles.md:12,37`: the box path
  becomes one meaning; the one resolver validates the marker at the boundary
  and interior code trusts the type.
- **Principle 8 (One way to do each thing)** — `:95`: three resolvers become
  one; two manifest path forms become one.
- **Principle 7 (Hierarchy is a discoverability contract)** — `:87`: the root
  vocabulary is the contract; `_content/` open below, root closed.
- **Principle 11 (Enforcement beats convention)** — `:127`: the closed
  vocabulary and the underscore reservation are validate/status checks, not
  prose.
- **Boxholder standing preferences** (monorepo memory + CLAUDE.md): bias
  toward strict/fail-closed; consolidate and migrate on-disk data rather than
  preserve drift; minimize invented concepts (the underscore prefix reuses an
  existing in-box convention — `_unsure/`, `_template-updates/` — rather than
  inventing a registry or a type tier).
- **`beebox/CLAUDE.md` "The filesystem is state, Git is history"**: the
  migration is `git mv` + ref rewrite, atomic per box, one commit.
- **Traded against:** v2 decision 1 (retired, above), and the Ghost-style
  "operational root owned by the user, package owned by the tool" split
  (`boxes-as-packages-v2.md:118-124`) — weakened deliberately: the backup
  unit becomes `_content/` (user content only), arguably a *better* unit than
  content+plumbing was.

## What already exists

| Piece | Where | Reuse or replace |
|---|---|---|
| Layout spec + drift-guarded doc tables | `src/lib/box-layout-spec.ts` (`BOX_LAYOUT`), doctest `test/cli/lib/box-layout-spec.doctest.md`, `docs/box-layout.md` | **Reuse the mechanism**, rewrite the data: the spec gains the root vocabulary (dirs AND spec'd root files) and the underscore reservation |
| Shape resolver | `src/lib/box-shape.ts:71` `getBoxShape` (marker `.beebox/box.json`, `BOX_MARKER` at `:20`) | **Rewrite for v3**: marker at the box root; `BoxShape` collapses to one root + derived areas; `MIN_KNOWN_SHAPE_VERSION` → 3 with a migration-pointing error for v2 |
| Bilingual resolvers ×3 | `src/hub/child-spawn.ts:80`, `src/cli/commands/serve.ts:67`, `src/lib/box-shape.ts:139` | **Delete all three**; one `resolveBoxRoot` in `src/lib/box-shape.ts` remains, accepting the root and (transitionally) a stale `…/content` path with a clear "this manifest predates v3" error |
| Dir lookup | `src/lib/paths.ts:184` `getBoxDir`, `BOX_DIRS` | **Reuse**, table re-pointed at the new vocabulary |
| Ref parsing, fail-closed | `src/shared/ref-path.ts` (3-form rule, `..` escape → `null`), `src/shared/box-path.ts` | **Reuse unchanged mechanics**; the root the forms resolve against moves; relative refs tighten (Track B) |
| Ref rewriting machinery | `canonical-refs.ts` (prefers leading-`/` form), `link-repair.ts` (writes box-root-absolute replacements), `rewrite-card-refs.ts` (preserves original absolute-vs-relative style; explicitly skips YAML inline-map forms, `rewrite-card-refs.ts:29-33`) | **Patterns only — the migration needs its own rewriter.** The existing three each do a narrower job than the migration needs (cross-model review, 2026-09-04); Track E builds a dedicated rewriter on `resolveRefPath` that covers markdown links, YAML ref fields (inline maps included), embeds, and attach scopes |
| Migration registry + runbook | `src/core/migrations.ts`, `docs/migrations.md`, precedent `box-packageify` (`boxes-as-packages-v2.md` Track H) | **Reuse**: `one-root` lands as a registry migration, scratch-clone tested first |
| Agent guide generation | `src/core/agent-guide/` (`REF_PATH_RULE` `source.ts:14-17`, `box-shape.ts:58-81` teaches the `../src` climb) | **Reuse**; the climb section is deleted (src is under the root now); ref rule text updated |
| Session spawn plumbing | `src/core/agent/run.ts:74` (`cwd: options.cwd ?? options.boxRoot`), landmark scoping `src/core/chat/session/start.ts:122,157-159` | **Reuse**: `boxRoot` just becomes the one root; landmark pattern generalizes unchanged |
| Slug derivation | `defaultSlugFor` (`src/cli/commands/serve.ts`) from the **package root** basename; single helper `src/lib/box-slug.ts` | **Reuse unchanged** — the root basename is the same directory, so every slug is stable across the migration |
| Claude Code project identity | keyed to the git root (= the one root; unchanged by this plan) | **No change**: settings, rules, hooks, memory symlink all keep working; verified semantics 2026-09-02 research pass |
| Git-hooks cd-into-content workaround | `src/core/install-validation-hooks.ts` (hooks `cd content/` because git runs them at the repo root — `docs/box-layout.md:52-57`) | **Delete the workaround**: hooks now already run at the box root |

## Prior art (external)

- **Underscore-marked machine vocabulary at a content root** — Jekyll
  (`_site/`, `_posts/`, `_data/`, `_config.yml`) and Eleventy (`_data/`,
  `_includes/`) are the established precedent: underscore-prefixed names mark
  directories owned by the tool, living beside user content, excluded from
  "content" semantics (https://jekyllrb.com/docs/structure/,
  https://www.11ty.dev/docs/config/). Our reservation rule (no ad hoc `_`
  names at the root) is stricter than either; neither enforces reservation —
  that part is ours, per Principle 11.
- **App-owns-root layouts** — Hermes Agent's `$HERMES_HOME` (the data dir
  owns the checkout) and npm packages with content subtrees are the
  one-root precedent; Ghost is the two-root precedent this plan steps away
  from (all three surveyed with URLs in `boxes-as-packages-v2.md:118-173`;
  not re-searched — the survey is 2 months old and layout precedent does not
  churn).
- **No external prior art found** for "reserved directory-name vocabulary
  enforced by a validator" as a first-class contract; closest is Cargo's
  reserved target dirs and npm's `node_modules` special-casing, both
  tool-internal. Finding recorded; the mechanism is small enough to own.

## The target shape

```
<box>/                              THE box root — one root, closed vocabulary
├── package.json  pnpm-lock.yaml  tsconfig.json  node_modules/  .git/   npm namespace
├── CLAUDE.md  .claude/                                                  agent identity
├── .beebox/                        runtime: box.json marker, dbs, logs, generated docs
├── src/                            box code: schemas/ views/ tricks/
│                                                       ── box namespace (underscore) ──
├── _content/                       ONLY user content — open vocabulary below here:
│     briefing.briefing.card  briefing.md  Box.landmark.card  MAP.md
│     inbox/  chat/  docs/  people/  places/  recipes/  todos/  calendar/  drive/
├── _config/                        meta-content: box.json*, connectors/, procedures/,
│                                   schedules/, guides, personality  (*see Open questions)
├── _bookkeeping/                   the machine's paper trail:
│     jobs/  output/  resources/  questions/  archive/{done,failed,processed}  trash/
├── _publish/                       staged public bundles — publicness visible at the root
└── _tmp/                           scratch (absorbs today's content tmp/ + capture staging)
```

Semantics locked in:

- **`boxRoot` means this root, everywhere.** `BoxShape` becomes
  `{ shapeVersion, boxRoot }` plus derived area accessors; `packageRoot` is
  deleted from the type. Manifests (`hub.json`, `boxes.json`) both store this
  root.
- **Marker:** `.beebox/box.json` at the root, `shapeVersion: 3`. `getBoxShape`
  on a v2 marker (or a path that is a former `content/` dir) fails with a
  clear "this box predates the one-root layout — run `bbx migrate`" error.
  No bilingual *operation* window: the engine is v3-only; `bbx migrate`
  converts. (Precedent: `remove-box-shape-v1.md` — clear-refusal beats silent
  bilingual support; soft-launch users' boxes are handled by the same
  migration path as the fleet, via `bbx upgrade`.)
- **Refs:** a leading `/` means this root, and box refs must land inside an
  **underscore area — with no exceptions**. There are no ref-addressable root
  files: the box-facing root files (briefing card + md, the root landmark
  card, MAP.md) move into `_content/`, so `/briefing.md` — as ambiguous as
  `/etc/hosts` — cannot be a valid ref (cross-model review finding,
  2026-09-04: root-file ref targets would break the underscore checksum).
  Refs into `node_modules/`, `.git/`, `src/`, `CLAUDE.md`, or any root entry
  are invalid (fail-closed, like `..` today — `ref-path.ts:20-28`). The
  underscore in the first segment is the visible checksum: every valid box
  ref carries it.
- **HTTP surfaces get the same fence.** Today's browse/file APIs check only
  containment under `boxRoot` (`api-browse.ts:42-50` lists every non-dot
  directory; `api-files.ts:88-104` serves any non-dot file;
  `api-files-write.ts:48-64` writes any non-dot, non-card path). Under one
  root that would list `src/` and `node_modules/` and make `package.json`
  *writable* over HTTP. Track B fences all three to the box namespace
  (underscore areas), 403 elsewhere; the browse root lists the underscore
  areas.
- **Reservation:** at the box root, the underscore vocabulary is closed —
  an unlisted `_` entry or any unlisted non-underscore entry is a
  `bbx validate`/`bbx status` error. Below the root, no reservation
  (`_unsure/` etc. keep working).
- **Sessions:** default cwd = the root (`agent/run.ts:74` unchanged in shape,
  `boxRoot` re-pointed). Scoped sessions (landmark chats today,
  `start.ts:122`; inbox-triage or schedule scopes later) keep the pattern:
  cwd = subdir, `additionalDirectories: [boxRoot]`, scope note. `./` and `/`
  now agree for root-cwd sessions; agents still never author cwd-relative
  paths (`REF_PATH_RULE`, unchanged).
- **No absolute paths persisted or prompted:** the reactor prompt's
  `WORKING DIRECTORY: ${boxRoot}` (`src/core/reactor/prompts.ts:16` — the
  only leak found in a full sweep, 2026-09-02) is replaced with box-relative
  wording; `resolveAgentToken`'s `process.cwd()` fallback
  (`src/core/agent/token.ts:75-85`) is removed (the env var path,
  `buildScriptEnv`, is the contract); `bbx validate` gains an absolute-path
  check for card content (same idea as the monorepo's `path-leak-check`).

## Tracks / scope

Ordered by dependency.

### Track A — Shape v3 core
**What:** `box-shape.ts` v3 (`BoxShape` one-root, marker at root, v2 → clear
migration error); `BOX_LAYOUT` rewritten with the new vocabulary, area
grouping, spec'd root files, and the reservation flag; `paths.ts` `BOX_DIRS`
re-derived; the three bilingual resolvers deleted in favor of one
`resolveBoxRoot` in `src/lib/box-shape.ts` (its stale-`content/`-path branch
returns the migration error, never a silent resolve); `boxCodePaths` returns
`<root>/src/*`.
**Why:** everything else consumes the shape.
**Vocabulary lock-ins:** `boxRoot` (the one root), `shapeVersion: 3`, the
underscore area names above, `_bookkeeping` (boxholder-chosen, 2026-09-04).
**First chunk:** v3 `getBoxShape` + `resolveBoxRoot` + `BOX_LAYOUT` data +
doctests (v3 fixture box; v2 fixture asserting the migration error text). No
open questions inside.

### Track B — Ref, path, and HTTP-surface vocabulary
**What:** `resolveRefPath` box-namespace restriction (underscore areas only;
everything else `null`); the same fence on the HTTP surfaces
(`api-browse.ts`, `api-files.ts`, `api-files-write.ts`: 403 outside the box
namespace; browse root lists the underscore areas); relative refs move from
"legacy, still resolves" to a validate warning this release (error later —
see Open questions); `bbx validate` absolute-path check for card bodies;
agent-guide text: ref rule updated, `../src` climb section deleted,
`_bookkeeping` described in one line, and an explicit off-limits statement
for the npm namespace **kept** (the v2 guide's package-boundary warning,
`agent-guide/box-shape.ts:66-80`, is updated for one root, not deleted —
root-cwd agents run with bypassed permissions, `agent/run.ts:73-77`, so the
guide plus the hook check below are the boundary).
**Why:** criteria 3–4; the ref universe and the HTTP surface must match the
new root on the same commit the layout moves, or every link breaks and the
package machinery becomes browsable/writable.
**First chunk:** namespace restriction + doctest (each area resolves; `src/`,
`node_modules/`, root files, unlisted root names → `null`).

### Track C — Closed-vocabulary enforcement
**What:** `bbx validate`/`bbx status` root check: every root entry must be in
the spec (npm namespace, spec'd files, underscore vocabulary); unlisted
entries and ad hoc `_` names error with "the box root is a closed vocabulary
— user content goes under `/_content/`". Also the wrong-root tripwire for the
recreated-two-root case: a directory named `content/` or any underscore-area
name appearing where the spec doesn't place it is called out specifically.
**Why:** Principle 11; this is the check that turns the test1 incident from
two silent months into one loud validate.
**Hook path:** `bbx validate --hook` today checks only touched lintable
files and exits clean for everything else (`validate-hook.ts:79-108`) — so
the root check must be wired into hook mode explicitly: when the edited path
is at the box root, or on any edit under the npm namespace
(`package.json`, lockfile, `tsconfig.json`, `node_modules/`), the hook
surfaces the violation. One `readdir` of the root per hook run is the cost.
**First chunk:** the check + doctest against a fixture with a stray root dir
and a fixture npm-namespace edit.

### Track D — Session and prompt plumbing
**What:** re-point session cwd (`boxRoot` flows through unchanged code);
landmark `additionalDirectories` now `[boxRoot]` (same code, new value);
`buildScriptEnv` paths; reactor prompt absolute-path fix; `resolveAgentToken`
cwd-fallback removal; `install-validation-hooks.ts` drops the `cd content/`
workaround; regenerate rules/skills/guide.
**Why:** criteria 4–5; the two hazard fixes ride here because they touch the
same lines.
**First chunk:** reactor prompt + token fallback fixes (independent of A–C,
can land first as pure bug fixes).

### Track E — The migration (`one-root`, v2 → v3)
**What:** registry migration, per box, one commit, run with the box's
processes **stopped** (serve/reactor/scheduler down — same offline stance as
`bbx upgrade`, `boxes-as-packages-v2.md:352-368`):

**Bootstrap (design, not an afterthought):** the v3 engine refuses v2 boxes,
but the migration runner must still reach them. `bbx migrate` gets a
v2-tolerant shape probe used *only* by the migration path (reads the v2
marker at `<root>/content/.beebox/box.json` without erroring), and the
migration itself moves the migrations manifest
(`content/config/migrations.jsonl` → `_config/migrations.jsonl` — the
manifest path is currently hardcoded box-relative, `migrations.ts:143`,
`migration-run.ts:35-83`). Doctest: `bbx migrate` on a v2 fixture succeeds;
every *other* `bbx` verb on the same fixture errors with the
migration-pointing message.

1. Preflight: clean tree; processes stopped; **root closed-vocabulary check
   against the v2 spec** — unexpected package-root entries (the test1 stray
   `config/` case) abort with a reconciliation instruction, never a blind
   delete.
2. `git mv` per the mapping table. Old paths are **package-root-relative v2
   paths** (the v2 box root is `content/`): `content/box/inbox →
   _content/inbox`; `content/store/{chat,todos,recipes,drive,calendar} →
   _content/…`; `content/{people,places,docs} → _content/…`;
   `content/config → _config`; `content/box/{jobs,output,questions,resources}
   → _bookkeeping/…`; `content/store/{archive,trash,usage,reviews} →
   _bookkeeping/…`; `content/box/publish → _publish`; `content/tmp → _tmp`;
   `content/{briefing.briefing.card,briefing.md,Box.landmark.card,MAP.md} →
   _content/…`; `content/CLAUDE.md` merged into the root CLAUDE.md (two
   personas, one file — the root one is thin by design). The table is
   exhaustive over `BOX_LAYOUT` v2 entries with `assertNever` on an unmapped
   area, so a spec entry added mid-plan fails compile, not migration.
3. `.beebox/` move is a **filesystem rename, not git**: it is gitignored
   runtime state (dbs, logs, tokens — `git reset --hard` cannot restore it).
   With processes stopped, `rename(content/.beebox → .beebox)` is atomic on
   the same filesystem; on any later step's failure the rollback renames it
   back before the `git reset`. Any pre-existing root `.beebox/` entries
   (none expected; verified none on test1) abort preflight.
4. `.gitignore` and annex policy merge: the package-root ignore
   (`node_modules/`, trick deps — `box/package.ts:105-109`) and the
   operational-root ignore (`.beebox/`, secrets/state, tmp, asset rules —
   `box/index.ts:158-198`) become one root `.gitignore` with paths remapped;
   `.gitattributes` (annex) likewise. Doctested: post-migration `git status`
   on the fixture is clean and an annexed asset still resolves.
5. Ref rewrite across every card and doc with the **dedicated rewriter**
   (Track E code, built on `resolveRefPath`): markdown links, YAML ref
   fields including inline-map forms (`rewrite-card-refs.ts:29-33` skips
   these today — the migration rewriter must not), embeds, attach scopes.
   All rewritten to canonical leading-`/` form (this also discharges the
   relative-ref deprecation for migrated content).
6. **Hard link gate:** broken refs are warnings in normal validate
   (`card-lint.ts:165-191`, pre-commit box-wide scan is warn-only) — the
   migration runs the link check in **error mode** and refuses to commit
   with any dangling ref.
7. Manifest updates: `hub.json` and `boxes.json` entries → the root.
8. Marker bump to `shapeVersion: 3` (marker now at root `.beebox/box.json`);
   `bbx init` tail (regenerate rules, guide, docs, search index); commit
   `migrate: one-root`.

Rollback per box: rename `.beebox` back, `git reset --hard` to the
pre-migration SHA, manifest revert, remove the migrations.jsonl line
(`docs/migrations.md` pattern).

**Fleet rollout and the deploy-ordering trap:** the server deploys the
engine by rsync on main commits (`boxes-as-packages-v2.md:535-540`), and the
hub falls back to the running checkout's `bin/bbx` for boxes without their
own bin (`child-spawn.ts:99-102`) — so "unconverted boxes keep running the
old engine" is NOT automatic. The cutover is therefore one runbook
operation, same stance as v2's accepted critical gap: merge to main, then
immediately run the fleet migration server-side; between deploy and each
box's migration that box errors loudly (the migration-pointing message),
never serves wrong content. Laptop fleet and worktree box clones migrate
before the merge; scratch clone of test1 first; test1's stray-config
reconciliation is a manual pre-step (diverged copies; compare and keep the
real ones — no blind `git rm`).
**Why last:** every prior track must be green on a fixture v3 box before any
real box converts.
**First chunk:** the path-mapping table + its doctest (exhaustive,
`assertNever`-terminated), plus the v2-tolerant migrate probe.

### Track F — Docs
**What:** `docs/box-layout.md` rewritten for v3 (also fixing the existing
drift: it still says the marker is `.bbx-box`; it is `.beebox/box.json`,
`box-shape.ts:20`); `adding-a-box.md`, `deploy/README.md` path updates; the
anchor issue closed; this plan moved to `implemented-plans/`.

## Could this be simpler?

The simplest version that plausibly works: **keep two roots**, consolidate
the three resolvers into one, make both manifests store the same form, and
add a sentinel rename (`content` → `_content`) so wrong-root writes fail on a
basename assert. That is the anchor issue's own "keep it, make it legible"
lean, and it is perhaps a third of this plan's diff.

What the fuller plan buys, traced: the simple version leaves the two-root
ambiguity alive at every *future* edge — each new script, manifest, or
external tool must still choose a root, and the family has already produced
five instances across four different edges (per Principle 3, boundaries are
where validation concentrates; a design with one fewer boundary needs one
fewer defense — and per Principle 8, "a box path" should have one meaning,
which two roots cannot deliver). The interior flattening (`store/`/`box/`
dissolved) rides the same migration; done separately later it would be a
second fleet migration, violating criterion 6 (one migration). The boxholder
explicitly weighed and chose the fuller version (2026-09-03/04).

## Subplans

none — the one candidate (triage-pipeline reshaping inside `inbox/`) is
explicitly NOT in scope.

## Failure modes

> **Critical gap (accepted as documented risk):** external bookmarks and
> chat-history links captured *outside* the box (browser bookmarks, iOS
> deep links, Zulip posts) point at old `/browse/` paths after migration and
> 404. In-box links are rewritten (Track E step 2); out-of-box copies cannot
> be. Accepted: the boxholder controls the fleet, old URLs fail loud (404,
> not wrong content), and a redirect table for renamed prefixes is listed as
> an open question, not silently omitted.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Stale manifest/config path (`…/content`) reaches the resolver post-migration | planned (Track A doctest) | migration-pointing error, never a silent resolve | clear |
| Migration preflight meets an unexpected root entry (stray dirs à la test1) | planned (Track E) | abort with reconciliation instruction | clear |
| Ref rewrite misses a form (bare relative ref, YAML inline map, `attach/` scope, embed) | planned (Track E rewriter doctest per form) | migration-only **error-mode** link gate refuses the commit (normal validate only warns on broken refs, `card-lint.ts:165-191` — the gate is new, not free) | clear |
| A v2 box hits the v3 engine (soft-launch user upgrades; or the server between deploy and fleet migration — the rsync deploy does not wait, `child-spawn.ts:99-102` fallback) | planned (Track A + E bootstrap doctest) | `getBoxShape` error names `bbx migrate`; cutover runbook makes deploy + fleet migration one operation | clear (loud window, accepted) |
| HTTP browse/file APIs expose or write the npm namespace under one root | planned (Track B doctest) | box-namespace fence, 403 outside | clear |
| Agent files user content at the root out of habit (old layout in weights) | planned (Track C doctest) | closed-vocabulary validate error + hook-mode root check (explicitly wired — today's hook exits clean for non-card paths, `validate-hook.ts:79-108`) | clear |
| Root-cwd agent (bypassed permissions, `agent/run.ts:73-77`) edits `package.json`/lockfile | planned (Track C doctest) | hook flags npm-namespace edits; guide keeps the off-limits statement | clear |
| Agent writes into `_bookkeeping/` thinking it is content | partially (validate only checks placement legality, not intent) | guide text says whose desk it is; jobs/output card schemas validate as today | silent-ish; accepted — misfiled cards were already possible and are visible in reviews |
| `.beebox` runtime state lost on rollback (`git reset` cannot restore gitignored dbs/logs) | planned (Track E fixture test) | filesystem rename with rename-back rollback; processes stopped in preflight | clear |
| Worktree box clones (`~/src/box-worktrees/<name>/test1`) left on v2 while the worktree engine is v3 | no (dev-only) | same migration runs on clones; `bin/workstreams` clone step re-checked in Track E | clear (engine refuses v2) |
| iOS app paths break (capture/upload routes embed box-relative paths) | needs check (bbx-ios-overlap) | the HTTP contract is box-relative and the root *semantics* move wholesale; contract doc reviewed in Track F | clear if reviewed; flagged for the review pass |

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong dir** — ADDRESSED: closed vocabulary at the root
  (Track C); inside `_content/` deliberately open (boxholder call,
  2026-09-04: "it's not a closed vocabulary inside there").
- **Stale ref** — ADDRESSED: Track E step 2 rewrites in-box refs atomically
  with the moves; out-of-box copies are the documented critical gap above.
- **Two agents touching the same card** — unchanged; no new concurrent
  surface. NOT IN SCOPE.
- **Hand-edit drift** (boxholder creates `Recipes/` at the root by hand) —
  ADDRESSED: validate error with a message naming `/_content/` (Track C).
- **Fabricated free-form value** — n/a: no new free-form fields.
- **Validation error UX** — ADDRESSED: Track B/C error strings are written
  in the plan's voice ("the box root is a closed vocabulary…") and doctested
  verbatim.
- **Partial migration / transition state** — ADDRESSED by refusing it: no
  bilingual operation; a box is v2 (old engine keeps running it) or v3
  (migrated, new engine). Mid-*migration* state is a dirty git tree that
  either commits or hard-resets (Track E rollback).

## NOT in scope

- **Triage-pipeline reshaping** (`inbox/intake/staged/triaged` internals) —
  the interior of `inbox/` moves as-is; rethinking triage is its own work
  (`docs/triage.md`).
- **Directories as viewable things**
  (`issues/features/2026-07-28-directories-as-viewable-things.md`) — moves
  directories, does not redefine them.
- **`add-box.sh` / deploy-script rewrite** — its issue stands; the script is
  updated only as far as the new paths require, the service-targeting bug is
  its own fix.
- **Session-scope features** (inbox-cwd triage sessions, "administrative"
  scoped sessions) — the layout enables them (landmark pattern generalizes);
  building them is separate.
- **Per-box isolation hardening, npm publish** — unchanged deferrals from
  the v2 plan.
- **Renaming npm-namespace entries** (`src/`, `package.json`) — ecosystem
  names are load-bearing for tools; the two-namespace design exists precisely
  so these keep their conventional names.

## Open design questions

All resolved by the boxholder (2026-09-04, in the box-layout-criteria
session — the message resolving them: "Don't worry about browse URLs. I
guess state should go in bookkeeping. Probably retro goes in content."):

- **Redirect table for old `/browse/` URLs** — NO. Old URLs 404; the
  critical-gap note stands as accepted risk.
- **Connector `*.state.json`** — machine-owned, so it moves to
  `_bookkeeping/connectors/<name>.state.json` (spec key `connectorState`).
  Config (`<name>.json`) and secrets (`<name>.secret.json`, gitignored) stay
  together in `_config/connectors/`.
- **Relative refs → error timing** — one release of warning, then error
  (lean accepted by silence; migrated content is already canonical after
  Track E step 5).
- **`usage/`** — `_bookkeeping/usage`. **`reviews/retro`** — content: the
  retro reports are the boxholder's audit trail and live at
  `_content/reviews/retro/`.

## Knowledge audits

New/changed agent-facing concepts → `src/dev/knowledge-audits.yaml`, landed
RUN against a migrated test1 clone:

- `knows_directly`: "Where does user content live, and may you create new
  directories there?" (expect: `/_content/`, yes — open vocabulary).
- `knows_directly`: "You need to file a completed item's leftovers. Where do
  archived/processed items go, and whose directory is that?" (expect:
  `/_bookkeeping/archive/…`, the machine's records).
- `knows_directly`: "Write a link to a recipe card." (expect leading-`/`
  box-root form landing in `/_content/…`; no cwd-relative form).
- `knows_directly`: "Where do box-local schemas live?" (expect `src/schemas/`
  — unchanged answer, re-verified because the guide text around it changes).
- The four existing `box-packageify` audits are updated or retired (they
  assert the `content/` shape).

## What will hold this after it ships

- The existing spec-drift doctest (`box-layout-spec.doctest.md`) extends to
  the root vocabulary and reservation flags — the doc tables and the
  validate check both derive from `BOX_LAYOUT`, so drift fails a doctest,
  not a reader.
- Pure-function doctests: v3 `getBoxShape`/`resolveBoxRoot` (fixture boxes),
  the ref namespace restriction, the migration path-mapping table
  (exhaustive, `assertNever`-terminated).
- Filesystem-tier doctest (`makeTmpBox()` upgraded to scaffold v3): the
  migration script end-to-end on a fixture v2 box — moves, ref rewrite,
  marker bump, validate green.
- The closed-vocabulary check runs in `bbx validate` (thus the pre-commit
  hook and PostToolUse hook) — the enforcement is in the daily path, not a
  periodic sweep.
- No new test tier needed.

## Implementation order

1. **D-first-chunk** — reactor prompt + token-fallback fixes (pure bug
   fixes, land immediately).
2. **A1** v3 shape + one resolver + `BOX_LAYOUT` data (+ doctests).
3. **A2** consumer re-point sweep (`paths.ts`, `boxCodePaths`, hub/serve
   callers of deleted resolvers).
4. **B1** ref namespace restriction (+ doctests); **B2** relative-ref
   warning + absolute-path card check.
5. **C1** closed-vocabulary validate/status check (+ doctest).
6. **D2** session/env re-point, hooks workaround removal, guide/rules regen.
7. **E1** path-mapping table (+ doctest); **E2** migration script, scratch
   test1 clone end-to-end; **E3** laptop fleet; **E4** server fleet +
   manifests; test1 stray-config reconciliation precedes E3.
8. **F1** docs rewrite (box-layout.md incl. marker drift), redirect decision,
   issue closure.

Each chunk is a commit on this worktree; the plan ships as one unit, and only
when the boxholder says so.

## Rollout shape

Tests first per chunk as named above; done-when = all doctests green, a
scratch test1 clone migrated and serving with `bbx validate` clean and the
knowledge audits passing against it, then the real fleet converted with each
box's migration commit as its rollback point. Cross-model review of this plan
before implementation begins (monorepo CLAUDE.md rule for anything beyond a
small-scope fix).

**Status as landed:** the v3 engine, every migrator, and the doctest suite
(`beebox/src/core/migrations/`, `beebox/scripts/migrate/one-root.ts`) are
implemented and green — code and fixtures only. The done-when bar above is
NOT yet cleared: no scratch or production box has been migrated and walked in
a browser, and the knowledge audits have not run against a migrated box.
Landing this branch ships the v3-only engine, so any box still at
`shapeVersion` < 3 (every box today) will refuse to serve until `bbx migrate
--apply` runs against it — the one-operation cutover window this plan always
intended. Running that migration, box by box, is the outstanding rollout
work.
