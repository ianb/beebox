---
title: "refresh-maps: one source of truth, stampable correct maps, no reviewer without a criterion"
status: active
workstream: refresh-maps-correctness
issues:
  - ../../../issues/bugs/2026-08-24-map-children-git-vs-disk.md
  - ../../../issues/bugs/2026-08-24-validate-judge-lacks-ignore-policy.md
  - ../../../issues/bugs/2026-09-16-refresh-maps-reports-existing-maps-as-create-forever.md
---
# refresh-maps: one source of truth, stampable correct maps, no reviewer without a criterion

refresh-maps cannot tell correct work from incomplete work. It lists a
directory from disk on one branch and from git on another. It cannot stamp a
MAP.md that is already correct. Its validate step asks a review model a
question that a diff cannot answer. This plan makes all listings come from
the git tree, stamps any map that a mechanical check shows is correct, and
removes the review instruction.

**Issues addressed:**
[map-children-git-vs-disk](../../../issues/bugs/2026-08-24-map-children-git-vs-disk.md),
[validate-judge-lacks-ignore-policy](../../../issues/bugs/2026-08-24-validate-judge-lacks-ignore-policy.md),
[existing-maps-as-create-forever](../../../issues/bugs/2026-09-16-refresh-maps-reports-existing-maps-as-create-forever.md).
Related, not closed:
[procedure-templates-ship-pre-one-root-paths](../../../issues/bugs/2026-09-12-procedure-templates-ship-pre-one-root-paths.md)
(this plan fixes the refresh-maps row of its table only; the other two
templates stay broken).

## Smallest fix and budget

Smallest fix per issue:

- Issue 1: build the listing, the walker, and bootstrap from one
  `git ls-tree` of HEAD. Delete `listChildrenOnDisk`.
- Issue 2: delete the `instructions:` block from the refresh-maps template.
- Issue 3: in finalize, stamp a task when its MAP.md passes a coverage check,
  even if the agent did not change it. Stop `--brief` from overwriting the
  saved brief.

That is the chosen design. Estimate: about 250 changed source lines
(`precheck-listing.ts`, `precheck.ts`, new `verify.ts`, `finalize.ts`,
`refresh-maps.ts`), about 350 changed test lines (two doctests extended, one
new), about 40 changed template lines. Not a BIG CHANGE.

The boxholder decided on 2026-09-18: git is the source of truth (decision 1);
remove the review instruction instead of giving the reviewer the ignore policy
(decision 2); stamp maps that pass verification (decision 3).

Change from the lean presented to the boxholder: the lean included a one-time
repair of migrated state keys and stale `# Map:` headers. This plan drops the
repair. See *Could this be simpler?*.

## Stated preferences this plan trades against

- Boxholder, 2026-09-18: `children` comes from git. A directory whose only
  contents are gitignored no longer appears in any map. This is accepted.
- Minimize invented concepts (boxholder memory, "prefer primitives"). This is
  why decision 2 removes an instruction instead of adding a
  "policy for the reviewer" mechanism to the procedure engine.
- Bias toward strict (boxholder memory). The coverage check is exact: the
  header must match, every subdirectory must be named in its exact form, and
  every named entry must exist. A strict check never stamps a wrong map. The
  cost of a false "not verified" is one agent rewrite, after which the map is
  stamped because it changed.
- `refresh-maps.procedure.card` `whys:` — *"Finalize only stamps a MAP.md it
  can prove was rewritten, so a silently-missed dirty map is left unstamped
  rather than marked current."* This plan widens "prove was rewritten" to
  "prove was rewritten OR prove is correct". The intent (never mark a stale
  map current) holds, because the check tests correctness directly.

## What already exists

- `beebox/src/core/maps/precheck-listing.ts:156` `listChildrenAtCommit` —
  git listing of one directory at one commit. Reused in shape; replaced by a
  whole-tree read so HEAD is read once, not once per directory.
- `beebox/src/core/maps/precheck-listing.ts:184` `listChildrenOnDisk` and
  `:40` `listMappableDirs` (`fs.readdir` walk). Rebuilt on the git tree: they
  are the disk half of the disagreement.
- `beebox/src/core/maps/precheck-listing.ts:106` `commitResolves` — keeps its
  role: an unresolvable `asOf` is still an anomaly.
- `beebox/src/core/maps/precheck-ignore.ts:167` `isIgnored` — unchanged; the
  tree reader filters with it exactly as the listings do today.
- `beebox/src/core/maps/finalize.ts:74` `mapWasRewritten` — kept. Stamping
  becomes `rewritten || verified`.
- `beebox/src/cli/commands/refresh-maps.ts:146`: `await saveBrief(boxRoot,
  brief);` runs before `if (options.brief)`, so `--brief` overwrites the
  saved brief. The validate shell claims the opposite: *"Use --brief (not the
  bare command) so we don't re-save the brief file."*
- `beebox/src/lib/staged-files.ts:29` already documents the `core.quotePath`
  hazard: *"a quoted name silently matches nothing downstream"*. The maps
  listing has the same hazard; checked 2026-09-18: `git ls-tree HEAD:d` on a
  file `café.md` prints `"caf\303\251.md"`. The new reader uses `-z`.
- `beebox/src/core/box/defaults.ts:88` `installProcedures` — rolls the
  template change out through `installTemplateFile`. No new rollout code.

Searched `beebox/src/core/procedure/` for any second consumer of "the policy
a reviewer needs" (decision 2's general option). The validate `instructions:`
in `process-pages`, `process-retrospective`, `trick-secret-runtime`, and
`view-card-shape` depend on the diff and the checklist only, not on hidden
config. Found none.

## Prior art (external)

One external premise: `git ls-tree -r -t -z` output. `-r` recurses, `-t`
includes tree entries while recursing, and `-z` gives NUL-terminated,
unquoted paths (git-ls-tree(1)). Annexed files are symlinks, mode `120000`,
type `blob`, so they list as files, the same as today. No other decision
depends on an external premise.

## Tracks / scope

### Track A — one git-derived listing (decision 1)

**What.** A pure in-memory tree read once per commit. The walker
(`listMappableDirs`), the current listing (`children`), and the prior listing
(`prev`) all come from it.

**Why.** Reproduced 2026-09-18 on a scratch box with `*.jpg` gitignored and a
current `store/` state entry. Adding an untracked `store/photos/holiday.jpg`
gave `needsWork=false`. After an unrelated tracked add, the update task's
`children` was `[b.md, c.md, notes/]`. With the state entry removed, the
create task's `children` was `[b.md, c.md, notes/, photos/]`. The folder is
in the map or not depending on which branch ran.

**Direction.**

```ts
/** A commit's box subtree: dirRel ("" = box root) → immediate entries. */
export type BoxTree = ReadonlyMap<string, readonly TreeEntry[]>;
export interface TreeEntry { name: string; isDir: boolean }

/** err only when `commit` does not resolve. */
export async function readBoxTree(boxRoot: string, commit: string): Promise<Result<BoxTree, ListingUnavailable>>;

export function listMappableDirs(tree: BoxTree, patterns: readonly string[]): string[];   // same rules, same doc comment
export function listChildren(tree: BoxTree, dirRel: string, patterns: readonly string[]): string[]; // missing dir → []
```

`readBoxTree` runs `git ls-tree -r -t -z --full-tree <commit>`. It keeps paths
under `gitBoxPrefix` and strips that prefix. Each path is added under its
parent directory. `precheck` reads HEAD once and reads each distinct `asOf`
once (a small `Map` cache). The existence of MAP.md comes from the HEAD tree
(`MAP.md` in the directory's raw entries). The precheck already refuses a
dirty tree (`precheck.ts:112`), so this matches disk for tracked files.
`listChildrenOnDisk`, `listChildrenAtCommit`, and the `fs.readdir` walk are
deleted.

**Vocabulary lock-ins.** `BoxTree`, `readBoxTree`, `listChildren`. Internal to
`core/maps/`.

**First chunk.** The reproduction as a doctest that fails today (see *Rollout
shape*). Then `readBoxTree` plus the pure functions, `precheck` rewired, old
functions deleted, existing precheck doctests green.

### Track B — verified maps are stampable (decision 3)

**What.** A pure coverage check. Finalize stamps a task if its map was
rewritten or if it passes the check.

**Why.** A task whose correct result is "no change" can never be stamped
today. `finalize.ts:201` skips it as `skippedUnchanged`. This happens in
two ways:

1. **Lost state.** On this worktree's `test1` (2026-09-18) there is no
   `.bbx-maps-state.json`. The Bee Box rename never renamed the old
   `.cb-maps-state.json`. The one-root pre-migration reconciliation then
   deleted it as a regenerable cache (`78b15d50`,
   `content/.cb-maps-state.json | 56 ------`). Every existing MAP.md then
   becomes `create` in every run. The reporters' boxes show the same
   symptom. This plan does not check which cause applied on each box. The
   fix does not depend on the cause.
2. **Correct no-op updates.** The prompt says: *"List subdirectories, not
   every file."* A plain file added to a mapped directory needs no map
   change. An agent that correctly changes nothing leaves the task
   unstamped, and the task returns in every run.

**Direction.** New `beebox/src/core/maps/verify.ts`:

```ts
export type MapCoverage = { ok: true } | { ok: false; problems: string[] };
export function verifyMapCoverage(p: { dir: string; content: string; children: readonly string[] }): MapCoverage;
```

The rules restate the template's format section:

- The first non-blank line is exactly `# Map: <dir>`. On test1 every header
  names a pre-one-root path (`_content/chat/MAP.md: # Map: store/chat`), so
  each of those maps fails and gets rewritten once.
- Every child ending in `/` appears as a bullet whose first token is
  `` `name/` ``.
- Every child that is an anchor file (`README.md`, `*.briefing.card`,
  `*.landmark.card`) appears as a bullet.
- Every backtick-led bullet names an entry that is in `children`. This
  catches deleted entries and entries hidden by the ignore policy.

`finalize` reads each task's MAP.md from the working tree, runs
`mapWasRewritten` and `verifyMapCoverage` against `task.children`, and stamps
if either passes. `FinalizeResult` gains `verified: string[]` (stamped by the
check without a change). The CLI prints it. A map that was rewritten but
fails the check is still stamped, but its problems are printed as a warning.
This does not gate stamping (see *Open design questions*).

`--brief` stops saving: only the bare command (the procedure's precheck
shell) writes `.beebox/refresh-maps-brief.json`. The validate shell's comment
becomes true.

**Vocabulary lock-ins.** `verifyMapCoverage`, `MapCoverage`,
`FinalizeResult.verified`. The anchor-file list is a named constant in
`verify.ts`.

**First chunk.** `verify.ts` with its own doctest (table of pass/fail
fixtures), no callers.

### Track C — template (decision 2 and the prompt's view of the listing)

**What.** Edit `beebox/templates/procedures/refresh-maps.procedure.card`:

1. Delete `validate.instructions`. It asks whether *"the next precheck should
   be a no-op"*. The validate shell above it already tests that exactly, and
   a diff cannot show it. With no answerable question, the reviewer judged
   map quality without the ignore policy, and that is where the two wrong
   failures came from. The validate `whys:` stays: it explains the shell
   check.
2. Replace the SHELL DIRS example `store/archive/captures/` (a
   pre-one-root path; `_bookkeeping/archive/**` is now hidden entirely) with
   wording tied to `.bbx-maps-ignore` `path/*` patterns, the only remaining
   source of shell directories (no `/*` pattern remains in
   `DEFAULT_IGNORE_PATTERNS` or `SKELETON_HIDDEN_PATHS`).
3. Add one sentence: `children` lists committed content. An entry that `ls`
   shows but `children` omits is gitignored or hidden by the map ignore
   policy. Leave it out. The issue records an agent that spent nine turns on
   this exact discrepancy.
4. Update the `create` bullet: MAP.md may already exist; rewrite it to the
   format, including the header.

**Why.** See *Direction* in Track B for item 4, and the issues for items 1–3.

**First chunk.** The edit plus any test that pins template text.

## Could this be simpler?

The simplest version: Track C item 1 plus the `--brief` fix. It stops the
wrong reviewer failures and the brief overwrite. It fails on the reproduced
case, and on test1 every map stays `create` forever. That is the reported
problem in two of the three issues, so it is not enough.

The one-time repair presented as a lean (rewrite migrated state keys, fix
stale headers) is dropped. On test1 there are no keys to rewrite: the state
file is gone. Stale headers fail the coverage check, so the next run's agent
rewrites them, and a rewrite stamps. The repair would add a migration entry
and a script for data that the normal path already heals within one run.

Track A could keep per-directory `ls-tree` calls instead of one whole-tree
read. The whole-tree read is needed anyway to run the walker on git, so
keeping both would be two readers.

## Subplans

None. No sub-question needs its own design step.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Directory with only gitignored files: the walker counts it, the listing omits it | New: reproduction doctest | Track A: one tree for both | Silent today → cannot happen |
| Non-ASCII filename quoted by `ls-tree` and read as a different name | New: precheck doctest with `café.md` | Track A: `-z` | Silent today |
| `asOf` unresolvable after a history rewrite | Existing (`maps-precheck` "unresolvable asOf") | `readBoxTree` returns `err` | Clear (anomaly) |
| Coverage check passes a map that omits something it should list | New: `verify` doctest | Rules list subdirectories and anchor files; plain files are optional by the prompt's own rule | Silent if the rules are wrong — the doctest pins them |
| Coverage check fails a correct map (bullet format differs) | New: `verify` doctest | The agent rewrites it and the rewrite stamps | Clear (one extra rewrite) |
| Rewritten map is wrong but is stamped | New: finalize doctest asserts the warning | Warning printed by `--finalize` | Clear in the run log; not gating |
| `--brief` overwrites the saved brief, emptying finalize's diff window | New: CLI-level doctest | Track B | Silent today |
| Very large box: `ls-tree -r` output size | No | One call per commit instead of one per directory | Clear (slow, not wrong) |
| Template update parks on a box whose copy was edited | Existing template install tests | Existing parking | Silent (known; see related parked-template issue) |

No critical gap: every new silent path has a test.

## Agent-flow / user-flow edge cases

- **Wrong field.** The agent treats `ls` output as the listing. ADDRESSED:
  Track C item 3.
- **Stale ref.** A directory is deleted between brief and finalize.
  ADDRESSED: existing `skippedMissingDir` (`finalize.ts:193`).
- **Two agents.** A chat agent commits while refresh-maps runs. The precheck
  refuses a dirty tree; finalize verifies against the brief's `children`, so
  a concurrent add may stamp a map that misses it. That add dirties the
  directory at the next run because `prev` is the stamped HEAD, and HEAD then
  contains the add. ADDRESSED by the existing diff.
- **Hand-edit drift.** The boxholder writes a map in a different format.
  ADDRESSED: it fails the check and is rewritten only when a task already
  exists for that directory. A map with no task is not touched.
- **Fabricated value.** The agent could claim coverage it did not write. Not
  possible: the check reads the file.
- **Validation UX.** Coverage problems print one line per problem under the
  finalize summary, naming the directory and the missing or unknown entry.
- **Partial migration.** A box that runs old code with a state file written
  by new code: the state format does not change. The template can park on
  some boxes; old template plus new code works (the removed instruction
  simply stays until the update is accepted).

## NOT in scope

- **Orphan MAP.md files in hidden subtrees.** test1 has
  `_content/chat/MAP.md`, `_content/inbox/MAP.md`, and
  `_bookkeeping/archive/MAP.md`, all under `SKELETON_HIDDEN_PATHS`. No task
  ever reaches them, and their `CLAUDE.md` still imports them. File an issue.
- **Other two templates in the 09-12 issue.** Separate work; they need their
  own path audit.
- **Parked-template resolution.** Tracked by its own issue.
- **Making the coverage check gate stamping of rewritten maps.** See *Open
  design questions*.
- **Precheck skipping tasks that already verify.** It would save one agent
  pass per box, once. The precheck would need to read map contents, and it is
  pure listing today. Not worth it for a one-time cost.
- **Judge inconclusive results as failures** (the pairing noted in the
  judge issue). With no instructions, this step has no judge.

## Open design questions

- Should a rewritten map that fails the check stay unstamped? That is
  stricter. The risk: an agent that consistently writes a format the check
  rejects creates a new forever loop, which is the failure this plan fixes.
  Lean: warn now; decide after the warning shows how often it fires on real
  boxes.

## Knowledge audits

Skipped. The one agent-facing change is in the procedure prompt, which is
passed to the run agent directly and not recalled from box guidance. The
end-to-end procedure run in *Rollout shape* exercises it.

## What will hold this after it ships

- `test/core/maps/maps-precheck.doctest.md`: the reproduction (gitignored
  directory is absent in both create and update paths and does not dirty its
  parent), the non-ASCII name, and the existing cases migrated to the
  tree-based functions.
- `test/core/maps/maps-verify.doctest.md` (new): `verifyMapCoverage` pass and
  fail fixtures. The decision is a pure function, so a doctest reaches it.
- `test/core/maps/maps-finalize.doctest.md`: an unchanged but correct map is
  stamped as `verified`; an unchanged map with a stale header is not; a
  rewritten failing map is stamped with a warning.
- A `--brief` test: it prints but does not save.
- No new test tier and no mocks.

## Implementation order

1. Reproduction doctest (fails today). Commit with Track A.
2. Track A: `readBoxTree`, pure walker and listing, precheck rewired, dead
   code removed.
3. Track B chunk 1: `verify.ts` and its doctest.
4. Track B chunk 2: finalize and CLI (`verified`, warning, `--brief` fix).
5. Track C: template edit.
6. End-to-end: a scratch copy of the worktree's `test1` (committed clean),
   run `bbx refresh-maps --brief`, then `bbx procedure run refresh-maps`
   once, then `--brief` again. Done when the second brief has no task for any
   map the agent reached.
7. Cross-model review of the branch diff.

## Rollout shape

Tests first: the reproduction doctest is written before Track A and must fail
on the current code. Done when the doctests named above pass, typecheck and
ESLint are clean for `beebox/`, and step 6 of *Implementation order* shows the
create-forever loop cleared on the test box copy.

No data migration. The state file format is unchanged. On the first run
after deploy, each box's agent sees its unstamped maps as `create` one more
time. Maps that verify are stamped even if the agent does not reach them;
maps with stale headers are rewritten and stamped. The template change reaches
boxes through `installProcedures`; boxes whose copy was edited park it, as
today. The new code does not depend on the new template.

Nothing runs against `~/src/boxes/*` or production.
