# Box migration to frontmatter (subplan of remove-cardworks-package)

Migrate every box's on-disk card data from legacy XML to YAML frontmatter, so
the gated box-local-XML removal (`remove-cardworks-package.md`, task #11) and
the final cardworks deletion (Track C) can land without stranding card data.
This is the data-side counterpart to the code-side breakoff already shipped.

Parent plan: [remove-cardworks-package.md](./remove-cardworks-package.md). Both
ship together: the parent's Track C (delete cardworks) cannot complete until
every box this subplan covers is migrated and the XML loader path has no users.

## Scale (measured 2026-06-19)

~9,000 XML-bodied `.card` files across 14 local boxes (`~/src/boxes/*`), plus
the production server's boxes (`boxCount: 6`). XML card counts by type:

```
image 3367 · news-item 1216 · record 562 · capture-session 154 · email-message 120 ·
procedure-run 105 · audio 103 · procedure 86 · landmark 84 · guide 60 ·
scheduled-script 52 · email-thread 50 · sheet 26 · job 21 · workflow 20 ·
news-brief 13 · person 12 · bill 12 · personality 9 · briefing 9 · memo 8 ·
question 6 · todo-list 3 · file 3 · email-outbound 2 · …
```

Per-box XML totals: `hearth-test` 2390, `ledger-shrink-test` 2242, `hearthside`
1290, `scenarios` 57, `studio` 17, `ledger`/`hearth`/`hearth`/`seminar` 13-15,
`test1` 11, `ledger-copy` 26, others single digits.

## Stated preferences this plan trades against

- **`callback-box/CLAUDE.md`** — the cards contract: filename `Foo.<type>.card`
  is the discriminator, **no `type:` field** in frontmatter; `cb validate`
  output is the correctness gate; "don't add features beyond what the task
  requires."
- **`docs/migrations.md`** — the established migration framework: `cb migrate`
  drives the ordered `MIGRATIONS` manifest (`src/core/migrations.ts`), each box
  tracks applied entries in `config/migrations.jsonl`, a failed entry halts the
  run and is not recorded. New transforms are added as **manifest entries**, not
  ad-hoc scripts. The manifest is append-only — "never reorder or remove
  existing entries — the name is the manifest key" (`migrations.ts:6`).
- **`feedback_run_authored_verification`** — verification I author (here:
  `cb validate` per box) gets RUN, not handed off.
- **`project_test1_demo_threads_pending_triage`** — `test1` schedules are all
  `enabled:false`; never trigger a wakeup as a side effect of migrating it.

## What already exists

- **`cb migrate --apply`** + the 28-entry ordered manifest
  (`src/core/migrations.ts:25-52`) covering the built-in types: attachments,
  card-frontmatter, email-thread/message, briefing, doc-sheet, file, image,
  audio, record-person, memo, misc, jobs, personality, scheduled-script,
  question, chat-thread, doc-to-gdoc, strip-type-field, repair-refs,
  asset-marker, webpage-card, landmark, recipe, procedure-run, procedure, guide,
  capture-session. **Reuse** — these run per box and cover the bulk of the
  ~9k cards. The shared harness (`scripts/migrate/_harness.ts`) handles arg
  parsing, file walk, dry-run/apply, per-file warning collection.
- **`cb validate`** — the correctness gate; runs the absorbed `formatLintResults`
  + each schema's `validate` hook. **Reuse** as the per-box acceptance check.
- **Box-local XML still loads** — `loadBoxSchemas` populates `elementSchemas`
  and `loadXmlCard` is intact (`card-io.ts`), so a box mid-migration keeps
  working. This is the safety net that lets migration be incremental per box.

## Prior art (external)

None — this is purely internal data transformation against our own schemas and
migration framework. No third-party tool or format is in play. (Searched: no
external dependency governs `.card` XML→YAML conversion.)

## Tracks / scope

Ordered by dependency, then risk.

### Track 0 — Delete deprecated types (no migration)

**What.** `news-item` (1216), `news-brief` (13), and `workflow` (20) are
deprecated with **no schema** (none in `config/schemas/`, none in the registry)
and **no code references** (`workflow`: only an unrelated UI label at
`CommitDetail-commit.tsx:142`; `news-*`: nothing). User confirmed
news-item/news-brief are deletable; `workflow` is the pre-procedures engine,
fully superseded.

**Why change.** These are schema-less dead data — `cb validate` can neither
validate nor migrate them; they'd block a clean "no XML remains" end state.

**Direction.** A single deletion migration entry `delete-deprecated-cards` (new
manifest tail entry) whose `convert` removes `*.news-item.card`,
`*.news-brief.card`, `*.workflow.card`, and prunes now-empty `config/workflows/`
and `box/inbox/news/` dirs. Tracked in the manifest so it's recorded per box and
idempotent. **Open question:** delete vs. archive-then-delete — lean delete
(git history is the archive; these are dead).

**First chunk.** `scripts/migrate/delete-deprecated-cards.ts` + manifest entry +
a doctest on a tmp box proving the three globs are removed and other cards
survive.

### Track 1 — `bill` box-local schema (ledger only)

**What.** `bill` (12 cards) is the only box-local **XML** schema, defined as
`element("bill", …)` in `ledger-copy/config/schemas/bill.ts` and
`ledger-shrink-test/config/schemas/bill.ts`. No migrator exists.

**Why change.** Box-local XML support is being dropped (parent plan, settled
decision); `bill` must become a frontmatter `cardSchema` or its cards strand.

**Direction.** (a) Rewrite each box's `config/schemas/bill.ts` from `element()`
to `cardSchema("bill", { fields, … })` importing from `callback-box/cards` (the
specifier shipped this session). (b) A `bill` migrator converting `*.bill.card`
XML → frontmatter. Because `bill` is box-local, the migrator lives **in the
box** (ledger boxes have their own migration story) OR as a manifest entry whose
`match` no-ops on boxes without `.bill.card`. **Open question:** box-local
migrator location — lean a manifest entry that no-ops elsewhere, for uniformity
with `cb migrate`.

**First chunk.** Read the two `bill.ts` element schemas + a sample `.bill.card`;
derive the frontmatter field shape; write the schema rewrite + migrator + a
doctest.

### Track 2 — Procedure-job XML feature (its own decision)

**What.** Procedure-job cards are still XML (`<procedure ref="…">`), detected
live for every job by `detectProcedureInJob` (`procedure-trampoline.ts:22`,
called from `engine.ts:344`), and actively generated by the docs
(`generate-docs-procedure-guide.ts:40`) and triage
(`triage-instructions.ts`/`handle.ts`). This is an **un-migrated feature**, not
dead data (parent plan correction, commit `35daf6c2`; task #12).

**Why change.** As long as procedure jobs are authored as XML, the cardworks XML
parser can't be removed. This is the last *functional* XML dependency.

**Direction.** Needs design: a frontmatter procedure-job representation (a
`procedure-job` schema? a field on the existing job card?), a rewritten
detector that reads frontmatter, a migrator for existing `<procedure>` job
cards, and updated doc/triage generators. **This is large enough to warrant its
own sub-subplan** (`procedure-job-frontmatter.subplan.md`) — flagged, not
designed here.

**First chunk.** None until the sub-subplan settles the representation.

### Track 3 — Run the migration per box

**What.** For each box, in a safe order: `cb migrate --apply` (runs Tracks 0-1
entries + the 28 existing), then `cb validate`, then commit within the box repo.

**Direction.** Order: `test1` first (playground, low stakes, schedules disabled
— but warn before any wakeup), then a small real box (`hearth`, 14 cards) as a
proof, then the large boxes (`hearthside`, `hearth-test`,
`ledger-shrink-test`). `ledger-copy`/`ledger-shrink-test` also need Track 1.
Each box: dry-run (`cb migrate` status) → `--apply` → `cb validate` → inspect
residual XML (`head -c1` scan) → commit. A box is "done" when `cb validate` is
clean and zero `.card` files start with `<` (excluding any Track-2 procedure
jobs, explicitly deferred).

**First chunk.** Migrate `test1` end-to-end as the proof; capture the per-box
runbook (commands + checks) before touching real boxes.

## Failure modes (load-bearing)

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A migrator drops/garbles a field (e.g. XML attr not mapped) | `_warnings.ts` field-loss detection per migrator; per-schema doctests | `cb validate` fails the box; commit is gated on it | **Clear** — warning dump + validate error |
| `delete-deprecated-cards` glob over-matches (deletes a live card) | New doctest (Track 0 first chunk) | Idempotent + git-revertible per box | **Clear** if the doctest pins the globs; else silent |
| `bill` frontmatter shape misses an XML attr | Track 1 doctest + `cb validate` | validate fails | **Clear** |
| Procedure job silently stops trampolining after migration | task #12 / sub-subplan must add a frontmatter-detector test | none yet | **Critical gap — deferred to Track 2 sub-subplan** |
| A box has no `config/migrations.jsonl` (legacy) | `cb migrate` hard-errors | user runs `--mark-all-applied` deliberately | **Clear** (hard error) |
| Migrating a box triggers a wakeup / schedule side effect | — | test1 schedules `enabled:false`; don't invoke wakeup | **Clear if we never call wakeup** |
| Production server boxes diverge from local `~/src/boxes` | — | unknown — see open questions | **Silent** until inspected |

**Critical gap:** procedure-job trampoline — migrating the cards without a
frontmatter detector silently breaks the trampoline (jobs fall through to an
agent session or fail). Resolved only by the Track 2 sub-subplan; do **not**
migrate procedure-job cards until then.

## Agent-flow / user-flow edge cases

- **Partial migration / transition state** — ADDRESSED: box-local XML + the XML
  loader stay intact, so a box mid-run keeps loading; `cb validate` distinguishes
  done from pending.
- **Stale ref after a type rename** — ADDRESSED: `repair-refs` is already in the
  manifest (`migrations.ts:44`).
- **Hand-edit drift / unknown keys** — ADDRESSED: the loader strips unknown
  keys to a warning, not a load failure.
- **Two boxes sharing a slug (worktree clones)** — DEFERRED: migrate the real
  `~/src/boxes/*`, not worktree clones; note which tree is canonical.
- **Production vs local boxes** — GAP: this plan measured local boxes; the
  server's `boxCount: 6` set may differ. Open question below.

## NOT in scope

- **The procedure-job feature redesign** — Track 2 flags it; its design is a
  separate sub-subplan (changes a live data shape across boxes).
- **Deleting cardworks / the XML loader paths** — that's the parent plan's
  task #11/Track C, *unblocked by* this subplan, not part of it.
- **Re-running historical migrations on already-migrated boxes** — `cb migrate`
  skips applied entries; this plan only adds the missing transforms.
- **Migrating `scenarios/`** test-fixture boxes beyond what their tests need —
  they're fixtures; migrate only if a test depends on it.

## Open design questions

1. **Production server boxes vs local `~/src/boxes`** — are they the same data,
   or does the server hold the canonical hearth box? Migration must target the
   canonical copy and deploy/sync afterward. Lean: confirm with boxholder before
   touching server data.
2. **`bill` migrator location** — manifest entry (no-ops off-ledger) vs.
   box-local migration. Lean: manifest entry, uniform with `cb migrate`.
3. **Deprecated-card deletion: hard delete vs archive** — lean hard delete (git
   history suffices).
4. **Procedure-job representation** — deferred to the Track 2 sub-subplan.

## Knowledge audits

This subplan introduces no new agent-facing *concept* (it's data migration via an
existing framework). The Track 2 sub-subplan, when written, must add a
`knows_directly` audit for the new procedure-job authoring shape (it changes how
agents create procedure jobs). Skip-with-rationale here: nothing agent-facing
changes until Track 2.

## Implementation order

1. **Track 0** — `delete-deprecated-cards` migrator + manifest entry + doctest.
2. **Track 1** — `bill` schema rewrite + migrator + doctest (ledger boxes).
3. **Track 3 proof** — migrate `test1`, then `hearth`, end-to-end; lock the
   per-box runbook.
4. **Track 2 sub-subplan** — design + implement the procedure-job frontmatter
   migration (gates the large boxes that carry procedure jobs, and the final
   cardworks deletion).
5. **Track 3 bulk** — migrate the remaining boxes (large ones last), `cb validate`
   + commit per box; reconcile production-server boxes per open question 1.
6. **Unblocks parent** — task #11 (drop box-local XML support) then Track C
   (delete cardworks).

## Rollout shape

- **Test posture:** each new migrator (Track 0, Track 1) lands with a tmp-box
  doctest before it touches real data; `cb validate` is the per-box acceptance
  gate, run (not deferred).
- **Migration approach:** incremental per box, git-committed per box, revertible.
  Boxes migrate independently; the plan completes when all are clean and the
  procedure-job feature is migrated, which unblocks (does not itself perform) the
  cardworks deletion.
- **No partial-ship of the parent:** cardworks stays until every box is migrated
  and the XML loader has no users — that's the parent plan's completion gate.
