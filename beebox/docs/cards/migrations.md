# Card migrations

Changing cards already on disk: applying migrations, the admission gate, writing a migrator, and the registry.


## What it is

How box data migrations work, how to apply them, and how to write new ones.

A migration is a one-shot transformation of card data on disk — schema renames, field strips, layout flips, refactors. The system tracks which migrations a box has had applied so future runs only do the missing work.

**Box configuration counts too.** A migration can converge configuration written once at `bbx init` (annex settings, `.gitignore`, managed hooks) that went stale when the code's idea of it changed; it transforms no cards, and the manifest records per box whether the convergence happened. The catch is in the name: a manifest key runs once, so **the next rendering change needs a new dated entry** (`annex-config-2026-08`, then `annex-config-2026-10`) — forgetting to add one is silent. Whether something should re-apply box configuration without being asked is open (`issues/closed/bugs/2026-08-18-stale-annex-largefiles-never-reapplies.md`).

## Applying and inspecting migrations

The box's `_config/migrations.jsonl` is append-only JSONL, one `{name,
applied-at}` per entry. The ordered registry in `src/core/migrations.ts` decides
what remains pending. New boxes receive a seeded manifest from `bbx init`;
a missing manifest in an existing box requires an explicit enrollment decision.

```bash
bbx engine migrate                         # human-readable applied and pending lists
bbx engine migrate --status --json          # read-only manifest, pending names, questions
bbx engine migrate --apply                  # apply, commit, and allow bounded agent repair
bbx engine migrate --sweep                  # same runner, scripts only; no repair agent
bbx engine migrate --sweep --repair --json   # unattended application and bounded repair
bbx engine migrate --mark-all-applied       # explicitly enroll an already-migrated box
bbx engine migrate --mark-applied bill      # record one already-completed migration
```

`--status --json` returns `{status: "status", manifest: boolean, pending:
string[], questions: string[]}`. It does not acquire maintenance, generate docs,
create snapshots, or run agents. Use that exact option pair for read-only
inspection; `--json` alone does not select this status representation. Do not
combine status and write options. A missing manifest is reported rather than
inferred to mean current. Human-readable status retains the legacy missing-
manifest error.

`--apply` and `--sweep` both preserve dirty input and commit each successful
migration with its manifest entry. Their distinction is agent authority:
`--apply` runs repair and registered procedure migrations directly; `--sweep`
runs only deterministic scripts unless `--repair` is explicit, which adds
bounded agent repair and procedure migrations under a one-run-per-answer bound
(a failed run writes one `Migration_<name>-N` question and nothing runs again
until it is answered). The hourly convergence schedule passes `--repair`, so a
procedure migration that lands is applied on every idle box at its next hourly
pass without anyone running it by hand; a busy box defers, and a failure or an
unanswered question is reported. A procedure still needs its machine
validation gate.
The mark-applied
commands only edit the manifest, leave that edit uncommitted for review, and
never establish that the conversion actually happened.

## Admission, snapshots, and failures

Migration, generated-docs refresh, supervised reload, and deployment share the
box admission gate in `src/lib/box-maintenance.ts`. Maintenance closes admission
before waiting up to ten minutes for already accepted work to finish. New
requests, independent CLI actions, queued chat turns, and scheduled deliveries
cannot extend that drain. Accepted agents and scripts retain a validated,
box-scoped permission for their descendant tool calls. Their tools can finish
while new independent work is refused. Due chat timers stay pending.

Closing costs the box its live work, so the sweep and the docs refresh look
before they close: each reads its inputs under an ordinary work lease and
returns `current` without touching the gate when nothing is pending. Only a
box with work is closed. A read refused because a maintenance phase already
exists falls through to the recovery path.

`bbx engine migrate --sweep --yield`, the hourly schedule's mode, defers to a box in
use. An idle chat run holds a lease until the box's server sees the phase and
closes it (the server polls every second), so the pass closes, waits fifteen
seconds instead of ten minutes, and treats work that outlasts the wait as the
box being in use: the result is `deferred` with the holders, exit 0, the box
reopens, and the next pass retries. A deploy already holding the maintenance
owner lock is the other way a box is in use; a yielding pass defers on it too,
naming the owner (`deployment`), and a non-yielding caller is refused with
`Box is closed for deployment (pid …)` rather than a lock error. The schedule reports a deferral only once
the box has held work for a day. Deploy (`bbx maintenance`) and supervised
reload never yield.

Every admission carries a reason (`acquireBoxWork(boxRoot, { reason })`), and
the process's lease sidecar lists the live reasons. A drain that gives up
names them (`Timed out draining box work: deployment; held by chat run <id>
since <time> (pid <n>)`); `boxWorkHolders(boxRoot)` reads them from another
process. A closed box refuses with the maintenance that closed it and, while
draining, the expected wait (`Box is closed for migration; expected to reopen within 10
min`); the HTTP 503 carries `Retry-After`, and the chat client waits it out
once before reporting the refusal.

A dirty tree is normal input. Before a mutation phase, the runner retains
`refs/bbx/migrations/<name>/snapshots/<attempt-id>` using a temporary Git index.
The snapshot stores working-tree versions, tracked deletions, and nonignored
untracked files; its second parent preserves the original staged versions.
Snapshot construction does not change HEAD or the real index. Ignored runtime
state and secrets are not force-added, and an annex pointer still needs its
annex object. No annex content is dropped.

The runner measures paths changed since the snapshot, then commits those paths
and the manifest through the ordinary hooks. Earlier unrelated staging is kept.
Those hooks validate with the code being deployed, so each migration's commit
must leave its cards valid on its own: run planners that convert parts of one
card shape from one script. A touched card that already fails current lint
also blocks the commit.
A changed path can contain earlier human edits; the recovery snapshot preserves
the before-state. If the commit fails, the manifest and original index entries
for attempted paths are restored, while conversion output remains available for
repair. The original output baseline is retained across retries, so an
idempotent converter that writes identical bytes on retry still commits the
previous attempt's output. Each attempt separately snapshots current input and
staging. The gate prevents Bee Box writers from racing this operation; raw Git
commands and external editors remain outside its enforcement.

A hard script or commit failure stops later migrations. With repair enabled,
the configured in-box agent gets at most twelve turns followed by one
deterministic retry. A question records a decision it cannot safely make;
substantive deletion or choosing between divergent content requires the
boxholder's answer. The agent cannot change the migrator, forge the manifest,
weaken validation, rewrite history, or drop annex objects. Small incidental loss
of failed/pending chat inputs is reported, rather than treated as a reason for a
new backup subsystem.

Exit 2 means per-card partial conversion. A repair-enabled pass can commit the
successful output together with an unresolved question and continue later
migrations. Without repair, that migration remains pending and later entries
wait. Outstanding questions remain attention items even when the registry has
no pending names. This `attention` result exits zero because the box is ready
to serve; JSON status and the text warning still identify the questions. Do not
replay a recorded old migration after later migrations;
repair the remaining cards against their current schema. A durable
`refs/bbx/migrations/<name>/repair-started` receipt prevents a crashed repair from
silently starting another agent on every hourly pass.

After draining, the runner starts a fifteen-minute awake-time execution budget.
Scripts, procedure subprocesses, and repair harnesses receive cancellation;
script/procedure process groups get TERM, then bounded KILL, and are awaited
before ownership releases. Git and docs-generation operations are checked
between calls and cannot all be interrupted inside a call. The schedule's outer
25-minute process limit bounds those remaining cases; remote SSH allows 26
minutes. A timeout is not success. An interrupted mutation leaves a record of
unfinished maintenance in the gate file, but the record closes the box only
while the owner's lock is held: a closure cannot outlive its owner, so a
crashed, killed, or failed attempt never leaves a box refusing requests. The
record, the pending migration, and its question stay reported (the
`box-migrations` health check, the hub's 503 while an owner holds the box) until
a later attempt completes. A pre-change drain timeout releases the unchanged box
without forcing active work to stop.

A standalone pass that finds a missing manifest before changing anything
releases its gate. Under deployment a missing manifest keeps the box closed for
the rest of the deployment, including when a previous nested operation had
already declared it ready; the box reopens when the controller exits. A pending
procedure migration is different: the box is consistent, so both passes release
it as ready, the deployment logs the pending procedure, and the next hourly
`--repair` pass applies it.

Before an attempt commits its output it confirms it still holds the owner lock.
A lock lost to a system sleep longer than the lock's stale window, or to a
deployment controller that died under a joined sweep, yields `commit-failed`
with `maintenance ownership lost`: the output stays uncommitted under its
recovery ref and no repair agent is spent on it.

## Automatic convergence and generated guidance

The deployment controller holds affected boxes across activation, migration,
service replacement, and readiness checks. It runs the shared script-only sweep
with a separate ten-minute command limit. A failing box is reported and stays
closed only until the controller exits; a successful process restart alone does
not make its data current. See [deployment operations](../server/deploying.md).

`schedules/box-convergence/` retries hourly and may invoke bounded agent repair.
It runs only from the main checkout on `main`. Local targets come from that
checkout's `beebox/.env` `BOXES=` line. Canonical path checks exclude managed
worktree clones and roots claimed by worktree configuration. Production targets
come from its hub registry and use each box's installed engine, so local code
never decides production's pending migration list. Unknown coverage, failed
conversions, and questions produce an important alert; identical detail is
suppressed until the daily reminder. The four-hour run budget reports unvisited
boxes as unchecked. Schedule dry-run only inspects status and writes no box,
question, notification, or comparison baseline.

The normal migration CLI also refreshes generated guidance after successful or
partial-with-question convergence. `bbx docs refresh` runs that same refresh
independently: cache hits are quiet; changed card rules, managed skills, and
compiled docs get a recovery snapshot and a changed-path commit. It accepts
dirty input. A failed refresh invalidates its generation marker and retains the
original pending snapshot, so retry cannot mistake leftover output for a fresh
baseline. Template customizations still use the existing parked-update policy;
convergence does not overwrite them merely to make a ledger look current.

## Writing a new migration

1. **Write the script** at `src/scripts/migrate/<name>.ts`. `bbx engine migrate` runs it as `<script> <boxRoot> --apply`. Exit 0 on success, 2 when it ran but some cards could not be converted (the migration is recorded and those cards are reported), anything else for a hard failure that stops the queue (`runMigrationScript` in `src/core/migration-run.ts`). The shared card-walking harness (`_harness.ts`) and the warnings helper (`_warnings.ts`) were deleted with the retired migrators on 2026-10-08; restore them from git history when a new migrator walks cards.

2. **Be idempotent.** Detect the post-migration shape and skip cards already in it — second runs should report "already migrated N" rather than re-doing work or erroring. Two patterns we use:
   - Filename-based: skip cards whose name already has the new extension.
   - Content-based: skip cards whose frontmatter already has the target shape (e.g., a specific key present, or matching a regex marker).
   `bbx engine migrate` re-runs partially-applied migrations on retry, and admins occasionally run individual scripts manually for debugging — idempotency makes both safe.

3. **Be noisy about data loss.** Declare which fields the migrator knows how to map and warn, with file path and field path, about anything outside that allow-list. A warning means data the migrator silently drops. When you see one against real data, the response is normally **extend the migrator**: map the field and extend the target schema in `src/schemas/`, then re-run from a clean baseline. Accepting silent loss is rarely the right call.

4. **Register it.** Append a `{name, script}` entry to `MIGRATIONS` at the bottom of `src/core/migrations.ts`. **Never reorder, rename, or remove** existing entries — the `name` is the manifest key, so reordering changes which migrations a box thinks it has applied. New entries always go at the end.

5. **Document it.** Put non-obvious behavior (the script renames files, deletes orphans, mutates non-card files) in the script's module comment and a short comment on the registry entry. Commit migrator, registry entry, and test together.

6. **Test it.** Run dry-run against a real box you can reset; then `--apply` and validate with `bbx validate`. Confirm the manifest got an entry. If you have a noisy-mode warning, decide explicitly whether to handle it or accept the loss — and document the call.

   **Verify generated guidance too.** The shared migration CLI refreshes card
   rules, managed skills, and compiled docs after conversion. Check that the old
   type or field no longer appears in the relevant generated guidance, and check
   outstanding migration questions. A completed deploy or an empty pending list
   alone does not prove every individual card was converted.

7. **Defer removal of the legacy support.** A migration almost always leaves code behind that exists only to tolerate the *old* shape — a fallback branch, a lenient parse, a compatibility field, a "both spellings accepted" reader. That code should survive a short, explicit settling period, not live forever, and **you are the last person who can name it precisely**: months later nobody can tell which branches are legacy tolerance and which are load-bearing. Write the cleanup issue when the migration ships, while you can list those paths, but keep it out of the active queue until its removal date.

   File it under `issues/deferred/` with an `activate-on` date after the intended settling period and `category: code-quality`. This is a known-date cleanup, not an upstream `watch/` item. The `deferred-issues` schedule will activate it into `issues/code-quality/` when due. It should name:

   - **The exact code that exists only for the old shape** — `file:line` for each fallback, not "legacy handling in the loader."
   - **The migration's manifest name**, since that is how the trigger gets checked.
   - **What makes it safe to remove** — normally "every box that matters has this migration in its `_config/migrations.jsonl`." Include the boxes that aren't yours to migrate on demand: prod boxes and any box a developer hasn't run `bbx engine migrate` on yet lag behind, so a green local sweep is not the signal.
   - **What breaks if it's removed too early** — usually an un-migrated box failing to load rather than anything loud, which is why the trigger has to be checked rather than assumed.

   Don't set `priority:` (that is the developer's call). Choose the activation date deliberately: long enough for the deploy sweep, hourly retries, and outstanding questions to settle, but no longer than the compatibility window actually needs. The issue exists so the debt is *recorded* at the moment it is created without competing in the active queue before it is actionable.

Migrations are written for cards that already exist on disk; you almost never need to think about schema-level migrations (the schema files in `src/schemas/` evolve freely as long as old data still parses, or has a migrator to bring it forward).

## Writing an agent-applied (procedure) migration

Some changes can't be a deterministic script: the thing to transform is
arbitrary box-authored code or prose that needs *judgment* to rewrite (the first
case was `view-card-shape`, now retired — box-local `.tsx` views that had to be
ported to a new `ViewCard` interface). For those, a migration runs a **procedure** that
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
  (the other kind is `{ name, script }`). `bbx engine migrate` dispatches it to
  `bbx procedure run <name>` and records the manifest entry only on a clean
  `completed`. The retired `view-card-shape.procedure.card` (in git history) is
  the worked example.

### Non-negotiables (each one is a scar from the first migration)

1. **Gate on a machine check, never the agent's word.** `validate.shells` with
   `severity: abort` is the only thing the engine actually enforces — model
   judgment (`validate.instructions`) and `severity: review` retry are
   unimplemented (they pass/warn-and-continue). `bbx engine migrate` **refuses** to run a
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
procedure parses + passes `bbx engine migrate`'s gate guard, `bbx engine migrate --status` lists
it). Then run it for real on one box and watch the agent — every fix above came
from a real run surfacing a gap, not from review. Sweep the rest only after one
works end-to-end.

## Retired migrations

Every migration registered on 2026-10-08 had been applied by every box, so each
entry now runs the shared no-op `src/scripts/migrate/retired.ts`. The entries
keep their names and order because the manifest is append-only. The migrators
themselves, their tests, and the two migration procedure templates are in git
history; the early rollout is in [the rollout report](../reports/migration-rollout-2026-05-23.md).

A box outside the fleet (a restored backup, an archived or soft-launch box) that has not applied a retired migration needs that migrator restored from git history and run by hand. This includes `one-root`: `getBoxShape` refuses a shapeVersion 2 box, and the v2 bootstrap path in `bbx migrate` is deleted.

## Manual runs (for debugging)

A migrator script is runnable standalone (`npx tsx src/scripts/migrate/<name>.ts <boxRoot> --apply`). Useful for debugging a single migration or for one-off boxes. The manifest is **not** updated when scripts are run directly — that only happens via `bbx engine migrate`. If you do this and want it to count, append the entry yourself or run `bbx engine migrate --apply` afterwards.

## Maintenance tools

- `src/scripts/clean-broken-refs.ts` — not a migration; a one-off data-hygiene tool. Deletes orphan image cards (whose `filename.ref` target is gone), prunes dead refs from capture-sessions / records / jobs, and rewrites `../../../people/Foo.person.card` style relative refs to absolute form when the target exists. Idempotent; safe to re-run.

## See also

- [Card format](format.md), the shape these migrators target; the [RFC](../implemented-plans/cards-as-markdown-rfc.md) for the design rationale.
- [Schemas](schemas.md), when a schema change rather than a migrator is the right move.
- [Maintenance](../development/maintenance.md), where `bbx engine migrate` and `clean-broken-refs.ts` sit among the periodic tools.

## Recovery and reversal

An interrupted box serves as soon as its maintenance owner is gone, with the
partial output uncommitted in its tree. Inspect the recorded input and that
output before retrying. Find the retained snapshots without changing data:

```bash
git for-each-ref --format='%(refname)' refs/bbx/migrations/
git show <recovery-ref>:path/to/file
git show <recovery-ref>^2:path/to/file  # original staged version
```

Restore selected paths deliberately, for example `git restore
--source=<recovery-ref> -- path/to/file`; restoring original staging is a separate
`git restore --staged --source=<recovery-ref>^2 -- path/to/file` decision. Do not
blindly reset the whole tree: the original input may be dirty and later
successful migrations may have changed the schema. Reverting a completed
migration also requires reconciling its manifest entry and any later dependent
changes. A recovery ref is retained locally; it is not a claim that ignored
state or annex content was independently backed up.

`bbx engine migrate --sweep --repair` takes over an interrupted attempt,
inspects retained repair receipts, and retries pending deterministic work.
Answer an outstanding question when a human decision is required. Successful
completion clears the record of unfinished maintenance; deleting the gate file
by hand only discards that record.

A pending migration's recovery question is answered like any other, from its
question card in the UI, in chat, or with:

```bash
bbx answer _bookkeeping/questions/Migration_<name>-0.question.card "Keep both versions"
bbx engine migrate --sweep --repair
```

The answer's follow-up job carries the question's directive, which authorizes
one bounded repair; the next sweep also reads the answer. While a maintenance
owner holds the box, the answer is refused with the owner's reason and can be
retried once it exits.
