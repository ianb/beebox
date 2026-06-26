---
name: cb-migration
description: Use when a change you're making leaves existing box data in an old shape — renaming/removing a card field, changing a card's format or `type`, renaming a card extension, splitting/merging fields, moving data between cards, or any schema change where boxes already on disk hold the old form. Triggers include "do I need a migration?", "rename this field across cards", "change this card format", "old boxes still have X". Not for net-new schemas with no existing data.
allowed-tools: Bash, Read, Edit, Write, Grep, Glob
---

# cb-migration

A migration is a **one-shot transform of card data already on disk** — renames,
field strips, format flips, refactors. The full how-to (the `cb migrate` runner,
the per-box `config/migrations.jsonl` manifest, the harness, the migrator table)
lives in **`callback-box/docs/migrations.md`** — read it before writing one.
This skill is the part the runbook can't enforce: deciding *whether* you need a
migration, *which kind*, and not repeating the scars.

## First: do you actually need one?

Schemas in `src/schemas/` evolve **freely** — *as long as old data still parses
AND still means the right thing*. So:

- **Additive / optional change** (a new optional field, a looser validation) →
  **no migration.** Old cards load unchanged. See `docs/adding-schemas.md`.
- **Old data would no longer load** (a now-required field, a renamed key the
  loader needs, a removed `type`) → **migration.**
- **Old data still loads but now means the *wrong thing*** → **migration**, and
  this is the trap. **Parsing is not the bar; parsing to the *correct value* is.**
  The cautionary tale you just lived: an un-migrated XML-body `Box.landmark.card`
  *parsed fine* under the new frontmatter loader — to an **inert** landmark with
  no role — so it silently showed wrong on the Landmarks page instead of erroring.
  "It still parses" is exactly when silent corruption hides.

If you're changing on-disk shape and *any* box already holds the old form, you
need a migration. New boxes are seeded all-applied by `cb init`, so they skip it.

## Which kind — script (default) or agent-applied

- **Script migration** (`scripts/migrate/<name>.ts`) — the default for anything
  **deterministic**. Free, exact, repeatable.
- **Agent-applied (procedure) migration** — only when the transform needs
  *judgment* on arbitrary box-authored code/prose (the first was `view-card-shape`,
  porting box-local `.tsx` views to a new interface). It costs turns/money and is
  only as trustworthy as its gate.

**Do the mechanical 80% as a script and let an agent handle only the residual.**
Don't reach for an agent migration because the change is *big*; reach for it only
because the change is *unspecifiable*.

## Writing a script migration (the load-bearing rules)

`docs/migrations.md` has the full template; these are the rules that bite if you
skip them:

- **Use the harness** (`scripts/migrate/_harness.ts`) — it does the file walk,
  dry-run/apply, error collection, and warning dump. Mirror an existing migrator
  (e.g. `image.ts`) only if your shape genuinely doesn't fit.
- **Be noisy about data loss — non-negotiable.** Declare an `ElementSpec` of the
  attrs/children you map and run `checkElement(...)` (`_warnings.ts`) before
  converting. Anything outside the spec prints at the end as a warning. **A
  warning is data the migrator silently drops** — the response is almost always
  *extend the migrator* (add the field to the spec, map it, widen the target
  schema), not accept the loss. This is the single mechanism that catches the
  "missed a field / missed a card type / missed a body" class of bug. (Scars: the
  personality migrator dropped `<boxholder>`; an `email-outbound` type had *no*
  migrator and was left in XML; landmark variants with fields outside
  `<navigation>` slipped through. Every one was a silently-unmapped field.)
- **Be idempotent.** Detect the post-migration shape and skip it — a second run
  reports "already migrated N", never re-does or errors. `cb migrate` re-runs
  partial migrations on retry, and admins run scripts standalone to debug.
- **Register append-only.** Add `{ name, script }` at the **end** of `MIGRATIONS`
  in `src/core/migrations.ts`. **Never reorder/rename/remove** existing entries —
  the `name` is the per-box manifest key; touching the order silently rewrites
  which migrations a box thinks it ran.
- **Cover *every* card that holds the old shape.** The XML-landmark escapee is the
  lesson: a migrator that matches `*.thing.card` but a box has the data under a
  different type/extension/body leaves it behind. Grep the real boxes for the old
  shape and make sure your `match` and spec catch all of it.

## Writing an agent-applied migration (the scars)

Only after you've confirmed no deterministic transform exists. The full shape and
the worked example (`view-card-shape.procedure.card`) are in the runbook; the
non-negotiables, each a scar from the first one:

- **Gate on a machine check, never the agent's word.** Only `validate.shells`
  with `severity: abort` is enforced; `cb migrate` *refuses* a procedure migration
  without one (an agent that does nothing still "completes" a step otherwise).
- **A render/run check misses *silent* breakage.** A renamed field can compile and
  render while doing the wrong thing — add a **static** check against the real
  interface (`cb view typecheck`) and a **textual precheck** for the old shape.
  Layer the gates.
- **Make "done" machine-checkable** — the agent works a `[ ]`/`[x]` checklist; the
  gate greps that no `[ ]` remain *and* runs the objective check.
- **Idempotent precheck** (skip clean boxes, resume after failure), **tolerate
  unrelated pre-existing breakage** (`--allow-invalid-cards`), **budget `max-turns`
  and design for fail-and-resume** (partial work committed, gate blocks
  `completed`, manifest not advanced), and **write only to writable temp** (the
  package tree is read-only on prod).

## Always: test on a real box you can reset

Every fix above came from a real run, not review. Dry-run against a box you can
`git reset --hard`, then `--apply`, then `cb validate`, then confirm the manifest
got its entry. For an agent migration, run it end-to-end on **one** box and watch
the agent before sweeping the rest.

## Common rationalizations

| Excuse | Reality |
|--------|---------|
| "I'll just change the schema; old data still parses." | Parsing ≠ correct. If old data now means the wrong thing (inert, empty, mis-typed), it's silent corruption — migrate. The XML landmark *parsed*. |
| "It's a small rename, no migrator needed." | If a box on disk holds the old field name, the rename is exactly what a migrator is for. Small ≠ no-op. |
| "The migrator warned about a field — I'll ignore it." | A warning is data being silently dropped. Extend the spec/converter/schema; accepting loss is rarely right and never the default. |
| "I'll have an agent do the migration, it's complex." | Complex ≠ unspecifiable. Do the deterministic 80% as a script; agents only for genuine judgment, and only behind a machine gate. |
| "The procedure ran and the agent said done." | The agent's word isn't the gate. Only `validate.shells`+`abort` is enforced; a render check still misses silent breakage. |
| "I tested it by reading the diff." | Every scar surfaced from a real run on real data, not review. Run it on a resettable box. |
| "I'll insert it earlier in the list to keep things ordered." | Reordering `MIGRATIONS` rewrites every box's applied-set. New entries go at the end, always. |

## Red flags — stop

Renaming/removing a card field with no migrator · "old data still parses" as the
whole safety argument · a migrator with no `_warnings` spec · ignoring a
field-loss warning against real data · an agent migration with no `severity:
abort` gate · gating on "it renders" instead of a static check · inserting/reordering
existing `MIGRATIONS` entries · shipping without a dry-run on a real box.
