# Box Migrations

How box data migrations work, how to apply them, and how to write new ones.

A migration is a one-shot transformation of card data on disk — schema renames, field strips, layout flips, refactors. The system tracks which migrations a box has had applied so future runs only do the missing work.

**Box configuration counts too.** `annex-config-2026-08` re-applies `annex.largefiles` and `.git/info/attributes` from the current renderings; it transforms no cards and leaves the working tree untouched. Config written once at `bbx init` goes stale whenever the code's idea of it changes, and a migration is the one mechanism that records per box whether the convergence happened. The catch is in the name: a manifest key runs once, so **the next rendering change needs a new dated entry** — forgetting to add one is silent. Whether something should re-apply box configuration without being asked is open (`issues/bugs/2026-08-18-stale-annex-largefiles-never-reapplies.md`).

`gitignore-2026-09` is the second configuration migration: it rewrites the box's `.gitignore` from the current rendering (`writeBoxGitignore`, the function `bbx init` uses) and untracks the state directory, box-root locks, and pid file that the pre-rename ignore file had let autocommit sweep in. It leaves `.beebox/box.json` tracked. See `scripts/migrate/box-gitignore.ts` for why the untrack list is an explicit allowlist rather than "everything now ignored".

`hooks-2026-09` reinstalls the managed git hooks and the package-root Claude settings through `installValidationHooks`, the same call `bbx init` makes: the hooks bake in the CLI path and name, and boxes that predate the rename were still looking for the former CLI at a checkout that no longer exists.

## `bbx migrate` is the entry point

Each box has `config/migrations.jsonl` — append-only JSONL, one `{name, applied-at}` per line — recording which migrations it's seen. `bbx migrate` compares against the canonical ordered list in `src/core/migrations.ts` and runs anything missing in order, appending an entry after each success.

```bash
bbx migrate                      # status — show applied + pending
bbx migrate --apply              # run all pending in order
bbx migrate --mark-all-applied   # seed the manifest as if every known migration ran
                                # (legacy box that was already fully migrated before this command existed)
bbx migrate --mark-applied bill  # record ONE migration as applied without running it
```

`bbx init` writes a seeded manifest (all-applied) for new boxes automatically — new boxes don't need to run historical migrations. A missing manifest in an existing box is a hard error; the user must explicitly `--mark-all-applied` to declare "this box is already up to date."

`--mark-applied <name>` is the single-entry escape hatch: it records one migration as applied **without running it**, for a box already in that migration's post-state that never got the manifest line. The motivating case is a **retired migrator** — e.g. `bill` (the cardworks XML→frontmatter conversion) always exits non-zero now that the `cardworks` parser is gone, so a box already in frontmatter shape but missing the `bill` entry would halt `bbx migrate --apply` on it forever. Marking it applied unblocks the sweep. It refuses an unknown name or a manifest-less box (use `--mark-all-applied` for the latter), and is an idempotent no-op if the migration is already recorded. Like the other write paths it leaves the manifest edit uncommitted for review.

If a migration fails, the manifest is **not** updated for the failing entry and subsequent migrations are not attempted. Fix the underlying problem and re-run; the loop picks up where it stopped.

## The deploy sweep runs them automatically

`deploy/deploy.sh` converges every box on the server after shipping new engine
code, in the at-rest window between `bbx-wait-quiet` and the service restart. Two
steps per box, in order: `bbx migrate --sweep` (the card data) then
`bbx docs refresh` (the generated guidance — see below). A box with nothing pending prints nothing; anything else prints
one line into the deploy log. **The sweep never fails the deploy** — a box that
needs a human is a box to look at, not a reason to abandon a shipped release.

`--sweep` is deliberately narrower than `--apply`, because nobody is watching:

| | `bbx migrate --apply` | `bbx migrate --sweep` |
|---|---|---|
| dirty tree | refuses | skips the box, reports, retries next deploy |
| procedure-kind (agent) migrations | runs them | stops there and reports |
| provisioning | runs `bbx init` first | does not |
| result | left uncommitted for review | one commit per migration, `Created-By: migration-sweep` |

The commit is the notable difference. Leaving changes uncommitted is right for a
human at a terminal and wrong unattended: a dirty box is exactly what the next
sweep skips, so one un-reviewed migration would silently stop every later one.
The manifest entry and the changes it describes land in the **same** commit, so
a box can never claim a migration whose effects are not in its history. When the
commit fails — the box's own pre-commit hook rejecting a card a migrator
produced, say — the manifest entry is rolled back and the migrator's changes are
left in the tree for review.

The whole sweep runs under the box git lock (`withBoxGitLock`), because
`stageAll` is `git add -A`: without it, a connector or wakeup committing between
the clean check and the commit would have its files swept into a
`migration-sweep` commit. That guarantee is **cooperative** — a box agent
shelling out to raw `git` is outside it, which is why the deploy runs the sweep
in the at-rest window rather than at an arbitrary moment.

A box left behind — dirty tree, pending procedure migration — is reported by
`bbx health` as `box-migrations` (warning), so the drift is visible after the
deploy log scrolls away.

### `bbx docs refresh` — the generated-docs half

Migrating a box's cards is only half of converging it. Its `.claude/rules/card-*.md`,
`.claude/skills/`, and `_content/docs/generated/` are regenerated from the schema registry
by `generateDocs`, which is cache-gated on the running engine's version — so it
regenerates the first time it runs after a deploy, but only when *something runs
it*, and its triggers are all activity (a chat session start, a `bbx wakeup`
reactor cycle, `bbx init`). A box nobody talks to kept the previous engine's
guidance indefinitely: the 2026-08-24 `document`→`pdf` rename left 3 of 6 prod
boxes teaching a card type that no longer existed until a manual `bbx init` pass.

`bbx docs refresh` closes that gap and takes the sweep's shape deliberately — the
normal cache (silent no-op on a box that already regenerated), a dirty box
skipped and retried next deploy, and the result committed rather than left in
the tree — two commits: `commitTemplateSyncChanges` takes the template-managed
paths (`Triggered-By: generateDocs`), then the refresh commits the residue
`generateDocs` writes afterwards (`AGENTS.md`, includes, briefing;
`Created-By: docs-refresh`), sound because the tree was verified clean under
the box git lock first. Policy lives in `src/core/docs-refresh.ts`.
It is script plumbing — reach for `bbx init` when you want a box converged by
hand.

## Writing a new migration

1. **Write the script** at `scripts/migrate/<name>.ts`. New migrators should use the shared harness (`scripts/migrate/_harness.ts`), which handles arg parsing, the file walk, dry-run/apply, per-file error collection, and the final warning dump:

   ```ts
   #!/usr/bin/env tsx
   import { runMigration } from "./_harness.js";
   import { WarningCollector, checkElement, type ElementSpec } from "./_warnings.js";

   const SPEC: ElementSpec = {
     attrs: ["status", "version"],
     children: { /* ... */ },
   };

   await runMigration({
     description: "*.thing.card: XML → flat YAML.",
     match: (name) => name.endsWith(".thing.card"),
     convert: async (absPath, { warnings }) => {
       // read file, parse, checkElement({ node, source: absPath, spec: SPEC, warnings }),
       // write new content if changed — return "converted" or "already".
     },
   });
   ```

   Existing migrators in this directory predate the harness and still carry their own scaffolding; mirror one (e.g. `scripts/migrate/image.ts`) only if you can't fit the harness's shape.

2. **Be idempotent.** Detect the post-migration shape and skip cards already in it — second runs should report "already migrated N" rather than re-doing work or erroring. Two patterns we use:
   - Filename-based: skip cards whose name already has the new extension.
   - Content-based: skip cards whose frontmatter already has the target shape (e.g., a specific key present, or matching a regex marker).
   `bbx migrate` re-runs partially-applied migrations on retry, and admins occasionally run individual scripts manually for debugging — idempotency makes both safe.

3. **Be noisy about data loss.** Every migrator must use the `scripts/migrate/_warnings.ts` helper to declare what attrs/children it knows how to map, and warn about anything outside that allow-list. The harness above already plumbs the `WarningCollector` through; what you write per-migration is just the spec + per-element check:

   ```ts
   const SPEC: ElementSpec = {
     attrs: ["status", "version"],
     children: {
       filename: { attrs: ["ref", "captured", "source"] },
       description: { attrs: [] },
       // ...
     },
   };

   // inside convert(), after parsing the card:
   checkElement({ node, source: absPath, spec: SPEC, warnings });
   ```

   At the end of a run, anything outside the spec prints with file path + field path:

   ```
   3 warning(s) about unrecognized fields:
     ledger.briefing.card: unknown child at <briefing>: <legal>
     store/.../Amherdt_Handwritten_Letter.record.card: unknown attr at <record> > <person>: role="Amherdt Group"
   ```

   A warning means data the migrator silently drops. When you see one against real data, the response is normally **extend the migrator**: add the field to the spec, map it in the converter, extend the target schema in `src/schemas/`. Re-run from a clean baseline. Accepting silent loss is rarely the right call; the warning is a prompt to think about each unmapped field.

4. **Register it.** Append a `{name, script}` entry to `MIGRATIONS` at the bottom of `src/core/migrations.ts`. **Never reorder, rename, or remove** existing entries — the `name` is the manifest key, so reordering changes which migrations a box thinks it has applied. New entries always go at the end.

5. **Document it.** Update the migrator table in this file (below) and mention any non-obvious behavior (e.g., the script renames files, deletes orphans, mutates non-card files). Commit migrator + registry entry + doc update together.

6. **Test it.** Run dry-run against a real box you can reset; then `--apply` and validate with `bbx validate`. Confirm the manifest got an entry. If you have a noisy-mode warning, decide explicitly whether to handle it or accept the loss — and document the call.

   **A type/schema migration also has to converge each box's generated docs — the deploy now does this for you, so verify rather than plan it.** `.claude/rules/card-*.md`, `.claude/skills/`, and `_content/docs/generated/` are regenerated from the schema registry, and until 2026-08-24 that happened only on `bbx init`, a chat-session start, or a `bbx wakeup` reactor cycle — so boxes with no such activity kept rules teaching the retired type (the `document`→`pdf` rename left 3 of 6 prod boxes on stale `card-document.md` until a manual `bbx init` pass). `deploy.sh` now runs `bbx docs refresh` per box right after the migration sweep, which regenerates and commits them. What is left for you is the check: a box that was **dirty** at deploy time is skipped and retried next deploy, so after a rollout `grep -rl` the old type name across each box (generated docs included) rather than assuming either half finished the job.

7. **Defer removal of the legacy support.** A migration almost always leaves code behind that exists only to tolerate the *old* shape — a fallback branch, a lenient parse, a compatibility field, a "both spellings accepted" reader. That code should survive a short, explicit settling period, not live forever, and **you are the last person who can name it precisely**: months later nobody can tell which branches are legacy tolerance and which are load-bearing. Write the cleanup issue when the migration ships, while you can list those paths, but keep it out of the active queue until its removal date.

   File it under `issues/deferred/` with an `activate-on` date after the intended settling period and `category: code-quality`. This is a known-date cleanup, not an upstream `watch/` item. The `deferred-issues` schedule will activate it into `issues/code-quality/` when due. It should name:

   - **The exact code that exists only for the old shape** — `file:line` for each fallback, not "legacy handling in the loader."
   - **The migration's manifest name**, since that is how the trigger gets checked.
   - **What makes it safe to remove** — normally "every box that matters has this migration in its `config/migrations.jsonl`." Include the boxes that aren't yours to migrate on demand: prod boxes and any box a developer hasn't run `bbx migrate` on yet lag behind, so a green local sweep is not the signal.
   - **What breaks if it's removed too early** — usually an un-migrated box failing to load rather than anything loud, which is why the trigger has to be checked rather than assumed.

   Don't set `priority:` (that is the developer's call). Choose the activation date deliberately: long enough for the deploy sweep and any skipped dirty boxes to converge, but no longer than the compatibility window actually needs. The issue exists so the debt is *recorded* at the moment it is created without competing in the active queue before it is actionable.

Migrations are written for cards that already exist on disk; you almost never need to think about schema-level migrations (the schema files in `src/schemas/` evolve freely as long as old data still parses, or has a migrator to bring it forward).

## Writing an agent-applied (procedure) migration

Some changes can't be a deterministic script: the thing to transform is
arbitrary box-authored code or prose that needs *judgment* to rewrite (the first
case was `view-card-shape` — box-local `.tsx` views that had to be ported to a
new `ViewCard` interface). For those, a migration runs a **procedure** that
drives an agent through a checklist, gated by a machine check.

**Default to a script.** Reach for agent-applied only when no deterministic
transform exists. A script is faster, free, and exactly repeatable; an agent
migration costs money/turns and is only as trustworthy as its gate. If 80% of
the change is mechanical, do that 80% as a script migration and let the agent
handle only the residual.

### The shape

- A procedure definition shipped as a template
  (`templates/procedures/<name>.procedure.card`), one step with three phases:
  - **`precheck`** — decide whether there's anything to do (idempotency).
  - **`run.agents`** — the agent, handed an embedded checklist.
  - **`validate`** — the machine gate (`shells` + `severity: abort`).
- Registered in `src/core/migrations.ts` as `{ name, procedure: "<name>" }`
  (the other kind is `{ name, script }`). `bbx migrate` dispatches it to
  `bbx procedure run <name>` and records the manifest entry only on a clean
  `completed`. See `view-card-shape.procedure.card` as the worked example.

### Non-negotiables (each one is a scar from the first migration)

1. **Gate on a machine check, never the agent's word.** `validate.shells` with
   `severity: abort` is the only thing the engine actually enforces — model
   judgment (`validate.instructions`) and `severity: review` retry are
   unimplemented (they pass/warn-and-continue). `bbx migrate` **refuses** to run a
   procedure migration with no `validate.shells`+`abort` step, because an agent
   that does nothing still "completes" a step otherwise.

2. **A render/run check misses *silent* breakage.** The headline lesson: a
   renamed field (`card.tagName` → `card.type`) can compile (esbuild strips
   types) and render without throwing — it just silently does the wrong thing
   (`hearth`'s map matched nothing and showed empty). So gate on more than
   "it runs": add a **static check** against the real interface (`bbx view
   typecheck`) and a **textual precheck** for the old shape. Layer the gates;
   each catches what the others miss.

3. **Make "done" machine-checkable, not self-reported.** The agent works a
   `[ ]`/`[x]` checklist file; the gate greps that no `[ ]` remain (completeness)
   *and* runs the objective check. Agent honesty + the committed checklist + the
   per-migration diff (human review) cover whether a *checked* box is truthful —
   that residual can't be machine-closed, so don't pretend it is.

4. **Idempotent precheck.** Skip the step when the box is already done (e.g.
   `bbx view check` green *and* `bbx view typecheck` green *and* no textual old-shape
   refs). This is what makes a box sweep safe — clean boxes skip with no agent
   run, and a re-run after a failure resumes instead of redoing.

5. **Tolerate pre-existing, unrelated breakage.** A migration about *views* must
   not fail because a *card* a view depends on is invalid (it happened:
   `ledger-shrink-test` had a bill card missing `vendor`). Use the escape hatch
   (`bbx view check --allow-invalid-cards`) so the gate judges *your* concern, not
   someone else's. Pre-existing problems are for `bbx validate`, not this.

6. **Budget the turns, and let failure be safe.** A multi-item migration eats
   turns (set `max-turns` on the agent — the default 20 wasn't enough for a box
   with a heavy view). When it does run out, it must fail *cleanly*: partial work
   committed, gate blocks `completed`, manifest not advanced — so **re-running
   resumes** from the committed progress. Design for "fails and resumes," not
   "must finish in one shot."

7. **Watch where it writes.** The runner ran a per-view render in a temp dir
   under the read-only `/opt/beebox` on prod and hit `EACCES`. Anything an
   agent-migration tool writes at runtime must use a writable location (an
   OS-temp dir, not the package tree).

### Test it the way the others were tested

Verify deterministically first (the gate command on a real broken box, the
procedure parses + passes `bbx migrate`'s gate guard, `bbx migrate --status` lists
it). Then run it for real on one box and watch the agent — every fix above came
from a real run surfacing a gap, not from review. Sweep the rest only after one
works end-to-end.

## The migrators

In the canonical order (same order they run via `bbx migrate --apply`):

All scripts live in `scripts/migrate/`.

| # | Name | Script | What it does |
|---|------|--------|---|
| 1 | `attachments`       | `attachments.ts`       | Structural: move flat sibling attachments into `<basename>.attach/` directories |
| 2 | `card-frontmatter`  | `card-frontmatter.ts`  | Phase 1: wrap every `.card` in `---\ncontent-type: application/x-card+xml\n---` so the loader treats them uniformly |
| 3 | `email-thread`      | `email-thread.ts`      | `*.email-thread.card`: XML → flat YAML frontmatter |
| 4 | `email-message`     | `email-message.ts`     | `*.email-message.card`: XML → flat YAML |
| 5 | `briefing`          | `briefing.ts`          | `*.briefing.card`: XML → YAML frontmatter + markdown body |
| 6 | `doc-sheet`         | `doc-sheet.ts`         | `*.doc.card`, `*.sheet.card`: XML → flat YAML (note: `.doc.card` was the Google-Doc type at the time; renamed to `gdoc` later — see #18) |
| 7 | `file`              | `file.ts`              | `*.file.card`: XML → flat YAML |
| 8 | `image`             | `image.ts`             | `*.image.card`: XML → flat YAML |
| 9 | `audio`             | `audio.ts`             | `*.audio.card`: XML → flat YAML |
| 10 | `record-person`    | `record-person.ts`     | `*.record.card`, `*.person.card`: XML → YAML + markdown body |
| 11 | `memo`             | `memo.ts`              | `*.memo.card`: XML → YAML + markdown body |
| 12 | `misc`             | `misc.ts`              | `*.todo-list.card`, `*.telegram-message.card`, `*.feedback.card` |
| 13 | `jobs`             | `jobs.ts`              | The four job schemas (intake, calendar-review, chat, question-followup) |
| 14 | `personality`      | `personality.ts`       | `*.personality.card`: XML → YAML + markdown body |
| 15 | `scheduled-script` | `scheduled-script.ts`  | `*.scheduled-script.card`: XML → flat YAML |
| 16 | `question`         | `question.ts`          | `*.question.card`: XML → flat YAML |
| 17 | `chat-thread`      | `chat-thread.ts`       | `*.chat-thread.card`: XML → YAML with discriminated entries[] |
| 18 | `doc-to-gdoc`      | `doc-to-gdoc.ts`       | Rename Google-Doc `.doc.card` → `.gdoc.card` and flip the YAML `type:` so the `doc` type name can be reused for a generic in-box document type |
| 19 | `strip-type-field` | `strip-type-field.ts`  | Remove the redundant `type:` field from every card's frontmatter — filename is the canonical type discriminator. Also renames `.X.job.card` → `.X-job.card` so the filename actually carries the canonical type for jobs |

(This table stops at #19 — later migrators registered in `src/core/migrations.ts` after `strip-type-field`, up through `question-lifecycle`, aren't reflected here; each one's own doc comment is the source of truth until this table is refreshed.)

`question-lifecycle` (`scripts/migrate/question-lifecycle-run.ts`, pure transform in `scripts/migrate/question-lifecycle.ts`) is the Track A cleanup for `docs/implemented-plans/questions-end-to-end.md`: strips the retired `answered-by:` field, backfills `asked-at:` on pending questions from the card's earliest `git add` date, relocates question cards living outside `box/questions/` (scan-import's attach-scope questions) into `box/questions/` with a `context:` ref back to their original scope, rewrites directives that reference the retired briefing `<agent-needs-to-know>` element to the current `{% correction %}` vocabulary, and reports (never silently fixes) any `select` question with fewer than two options.

### `box-packageify` (retired — v2-assert no-op)

`box-packageify` used to convert a whole box in place from the old flat
(shapeVersion 1) layout into the v2 package layout. Every box is now v2, so the
conversion is gone: `scripts/migrate/box-packageify.ts` is now an **idempotent
no-op** (it asserts the box is a valid `shapeVersion === 2` package and exits 0,
or fails loud otherwise), and the 537-line converter logic, its smoke script, and
its doctests were deleted with the v1 shape (see
`docs/implemented-plans/remove-box-shape-v1.md`).

The name is kept deliberately. `config/migrations.jsonl` is **append-only** and
`src/core/migrations.ts` is the ordered canonical list `bbx migrate` compares it
against — dropping a name that boxes have already recorded as applied would make
their manifests reference a migration the engine no longer knows, breaking the
invariant. A registered no-op preserves it: already-migrated boxes match, and a
box that never recorded it runs a harmless v2-assert.

### `retire-process-captures` (prune — retired pipeline cleanup)

`scripts/migrate/retire-process-captures.ts` is a **prune**, not a card
conversion: it removes the retired `process-captures` procedure card and its
one-shot trigger from a box, because `installProcedures` only ever adds/updates
template files — it never prunes — so deleting the template upstream leaves the
stale copies behind on every already-initialized box, now calling deleted `bbx`
commands (a wakeup-time failure). Behavior worth knowing:

- **Hash-gated delete vs. park.** `config/procedures/process-captures.procedure.card`
  is deleted only when its content hash matches one of the shipped stock versions
  enumerated in the script (`SHIPPED_PROCEDURE_HASHES` — the same canonical form
  `installTemplateFile` compares: raw bytes, since a procedure card has no
  `normalize`/`boxOwnedFields`). A boxholder-**modified** copy is not destroyed —
  it's parked to `config/_template-updates/config/procedures/…` (the standard
  template-review location) and cleared from the active procedures dir so it stops
  firing the deleted commands. Recompute/extend the hash list from
  `git show <ref>:beebox/templates/procedures/process-captures.procedure.card | shasum -a 256`.
  **Expect PARK on long-lived boxes, and treat it as success:** only two
  frontmatter-era template versions ever shipped, and box-side migrations
  (the XML→frontmatter card conversion, box-packageify) rewrote installed
  copies in place — so any box older than 2026-06-18, or migrated since,
  won't byte-match a shipped hash even if the boxholder never touched the
  card (observed on test1: parked, correctly). The parked file needs no
  merge work — review it for custom steps worth keeping, then delete it.
- **The trigger** (`config/schedules/process-captures.scheduled-script.card`) is
  auto-generated box state (never boxholder-authored) and always broken once the
  procedure is gone, so it's removed whenever present.
- **Legacy inbox capture-session cards are intentionally left in place.** In-flight
  `*.capture-session.card` files in `box/inbox/` (including the prod retry-loop
  victim, `issues/closed/bugs/2026-07-07-capture-pipeline-retries-broken-capture-forever.md`)
  stay as ordinary cards for the normal triage/agent flow — they are legacy data,
  not something this migration touches.
- Idempotent: a box with neither file (already retired, or one that never had the
  pipeline) is a clean no-op.

## Manual runs (for debugging)

The per-schema scripts are runnable standalone (`npx tsx scripts/migrate/<name>.ts <boxRoot> --apply`). Useful for debugging a single migration or for one-off boxes. The manifest is **not** updated when scripts are run directly — that only happens via `bbx migrate`. If you do this and want it to count, append the entry yourself or run `bbx migrate --apply` afterwards.

## Maintenance tools

- `scripts/clean-broken-refs.ts` — not a migration; a one-off data-hygiene tool. Deletes orphan image cards (whose `filename.ref` target is gone), prunes dead refs from capture-sessions / records / jobs, and rewrites `../../../people/Foo.person.card` style relative refs to absolute form when the target exists. Idempotent; safe to re-run.

## Production rollout history (box.example.com)

For reference. May 23–24, 2026.

1. Pushed migrators + `bbx migrate` to GitHub; post-commit hook deploys to `/opt/beebox/beebox/`.
2. Stopped `beebox-serve` + `beebox-scheduler` to avoid races.
3. Per-box backup: pre-migration commit SHA + a compact tar (text-only) into `/home/beebox/backups/pre-migration-<timestamp>/`. The card data is already in git; the tar is belt-and-suspenders for non-git state.
4. For each box: seeded the manifest (sometimes partially for legacy boxes), ran `bbx migrate --apply`, committed.
5. Some boxes hit pre-commit validation blocks from pre-existing data drift (broken refs, malformed templates). Cleaned those up via `scripts/clean-broken-refs.ts` plus hand-fixes; see commit history.
6. Restarted services.

Residual data fixes that were one-offs (won't apply to other boxes):

- `personal/config/main.personality.card` `<boxholder ref="...">` attr restored after the personality migrator dropped it. Migrator fixed to preserve.
- `hearth/Test_Timer*.memo.card` had `<memo created="...">` attr instead of a `<created>` child. Hand-converted; the migrator was not extended (one-off shape).
- `personal/store/beebox/beebox-interaction-primitives.memo.card` legacy `<card type="memo">` root. Hand-converted.
- Ledger's eulogy `.md` moved into a proper `.attach/` scope; trash duplicate removed.
- Several boxes had `Box.landmark.card` with `<label>` / `<symbol>` directly under `<landmark>` instead of inside `<navigation>`. Wrapped via perl one-liner.
- Ledger had two `*.email-outbound.card` files still in XML (no migrator existed for that type). Hand-converted to YAML.

### `todo-list-to-doc` (retirement — todo-list → doc + `{% todo %}`)

Registered after `retire-process-captures`. Converts every `*.todo-list.card`
into a sibling `*.doc.card` (same basename): `name` → `title`, `details` →
opening body paragraph, `items[]` → a markdown list with each item wrapped in
`{% todo %}…{% /todo %}` (status mapped pending→open/done/`status="dropped"`
for cancelled/`status="parked"` for deferred; nested `items` → indented
sub-lists; item `completed`/`agent-notes` preserved as trailing parenthetical
text inside the wrapper so nothing is silently dropped), card-level
`agent-notes` → a trailing blockquote. Rewrites any other card/markdown/view
that referenced the old path via the same resolution-based machinery `bbx mv`
uses (`rewrite-card-refs.ts`). Superseded by the universal `{% todo %}`
annotation (`docs/implemented-plans/todo-annotation.md`); see
`scripts/migrate/todo-list-to-doc.ts` (pure transform) and
`scripts/migrate/todo-list-to-doc-run.ts` (CLI driver) for the full mapping.
Idempotent: a box with no `*.todo-list.card` files is a clean no-op.

### `document-to-pdf` (rename — `document` → `pdf`)

Registered at the end of `MIGRATIONS`. Renames every `*.document.card` to
`*.pdf.card` (the type comes from the filename, so the rename is the type
change — no frontmatter edit) and rewrites inbound `.document.card`
references across every `.md`/`.card` file in the box. `document` collided
with the unrelated `doc.card` type, and the pipeline only reads PDFs today,
so the generic name (chosen to avoid a future rename — see
`docs/plans/scanner-ingest.md`, Track 4) bought nothing. Modeled on
`gsheet-rename.ts`: no XML variant exists to guard against (the type
post-dates the XML→frontmatter migration), so it's a pure rename + ref
rewrite, same shape as `gsheet-rename`. See
`scripts/migrate/document-to-pdf.ts`. Idempotent: a box with no
`*.document.card` is a clean no-op.

### `one-root` (shape migration — v2 two-root → v3 one-root layout)

Registered at the end of `MIGRATIONS`, but unlike every migrator above it,
`one-root` runs against a box that ISN'T v3 yet — the v3 engine refuses v2
boxes outright (`getBoxShape`), so `bbx migrate` has a bootstrap path
(`src/cli/commands/migrate-bootstrap.ts`) that probes for a v2 box
(`src/core/migrations/one-root-v2-probe.ts`, tolerant of the pre-v3 marker)
and hands it straight to `src/core/migrations/one-root-run.ts`'s
`runOneRootMigration`, entirely outside the normal manifest-driven `pending`
loop (a v2 box has no `_config/migrations.jsonl` yet — the migration MOVES
that file into existence as part of converting `content/config/` →
`_config/`). See `docs/plans/one-root-box-layout.md` Track E for the full
design. In order: preflight (clean tree, no running-process lock files, the
v2 package root's own closed-vocabulary check); `git mv` every `content/`
file per `src/core/migrations/one-root-mapping.ts`'s table (exhaustive,
`assertNever`-terminated over the frozen v2 layout); `content/CLAUDE.md`
merges into the root `CLAUDE.md` instead of moving; `.beebox/` moves by
filesystem rename (gitignored runtime state, not git); marker bumped to
`shapeVersion: 3`; `.gitignore`/`.gitattributes` regenerated (reuses
`initBox`); every card/doc's refs rewritten to canonical `/`-form
(`one-root-ref-rewrite.ts`, YAML-aware — unlike `bbx mv`'s rewriter it DOES
handle inline-map `refs:` forms, since a migration commit reorders
frontmatter keys everywhere anyway); a hard link gate
(`one-root-link-gate.ts`) refuses to commit if the rewrite left any
reference dangling; the full `bbx init` tail regenerates rules/guides/docs/
search index; `hub.json`/`boxes.json` entries pointing at the old
`<root>/content` path are corrected. Everything lands in exactly ONE commit
(`migrate: one-root`) — a `git reset --soft` to the pre-migration SHA folds
in `bbx init`'s own incidental provisioning commit before the final commit,
so the plan's "one migration, one commit" holds even though the reused
init tail commits on its own. Rollback on ANY failure: rename `.beebox`
back under `content/`, `git reset --hard` + clean to the pre-migration SHA
— nothing commits until the very end, so this always fully undoes the
attempt. The bootstrap path (everything v2-shape-aware) is scheduled for
removal once the fleet has converged — see
`issues/deferred/2026-09-04-remove-one-root-v2-bootstrap.md`.

## See also

- `docs/cards-as-markdown.md` — living reference for the YAML-frontmatter format these migrators target; `docs/implemented-plans/cards-as-markdown-rfc.md` for the design rationale
- `docs/maintenance.md` — where `bbx migrate` and `clean-broken-refs.ts` sit in the broader maintenance surface
- `docs/adding-schemas.md` — when a *schema* change (not a data shape change) is the right move instead of a migrator
- `scripts/migrate/_warnings.ts` — the noisy-mode helper every migrator uses
- `scripts/migrate/_harness.ts` — shared scaffold for new migrators

## Rollback

Each pending migration is committed by the user (`bbx migrate` doesn't auto-commit). If a migration produced unwanted changes:

```bash
git -C $BOX reset --hard <pre-migration-sha>
# also: remove the manifest entry for the migration you reverted
sed -i '/"name":"<migration-name>"/d' $BOX/config/migrations.jsonl
```
