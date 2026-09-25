# Migration rollout, May 2026, and retired migrators

Frozen 2026-09-25 from `docs/migrations.md`. The 2026-05-23 production
rollout of the XML-to-frontmatter migrators and its one-off fixes, and the
two retired migrators whose names stay registered as no-ops. The current
runbook is [card migrations](../cards/migrations.md). Do not update in place.

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

## `box-packageify` (retired — v2-assert no-op)

`box-packageify` used to convert a whole box in place from the old flat
(shapeVersion 1) layout into the v2 package layout. Every box is now v2, so the
conversion is gone: `scripts/migrate/box-packageify.ts` is now an **idempotent
no-op** (it asserts the box is a valid `shapeVersion === 2` package and exits 0,
or fails loud otherwise), and the 537-line converter logic, its smoke script, and
its doctests were deleted with the v1 shape (see
`docs/implemented-plans/remove-box-shape-v1.md`).

The name is kept deliberately. `_config/migrations.jsonl` is **append-only** and
`src/core/migrations.ts` is the ordered canonical list `bbx migrate` compares it
against — dropping a name that boxes have already recorded as applied would make
their manifests reference a migration the engine no longer knows, breaking the
invariant. A registered no-op preserves it: already-migrated boxes match, and a
box that never recorded it runs a harmless v2-assert.

## `retire-process-captures` (prune — retired pipeline cleanup)

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
