# Remove box-shape v1 (legacy) + de-template box skills

All boxes are shapeVersion 2 (boxholder ruling, 2026-07). This plan removes the
v1/legacy box shape entirely — the bilingual shape predicate, the resolve-hook
machinery it required, the in-place conversion script, and the docs/tests that
carry the migration as live — and de-templates the two managed box skills that
were parameterized (`tricks` on shape, `calendar` on timezone) so every managed
skill becomes a static constant.

## Stated preferences this plan trades against

- `callback-box/docs/engineering-principles.md` — most load-bearing: **#4
  Resilient AND never silent / never resilient to the impossible** (the missing
  `.cb-box` fallback currently *invents* a v1 shape — post-removal an
  unrecognizable shape should fail loud, not silently synthesize), **#8 One way
  to do each thing** (collapse the two-arm `boxCodePaths` and the tricks-skill
  fork to a single form), **#1 Types are structure** (drop `LEGACY_SHAPE_VERSION`
  and the shape-note fields that only encoded the v1/v2 difference).
- `callback-box/CLAUDE.md` — "don't add features beyond what the task requires";
  the migration-manifest append-only invariant (`docs/migrations.md`).
- `callback-box/code-style.md` — no default params, exhaustiveness, strict casts.
- Boxholder decisions in-thread (2026-07-11): "remove the migration entirely,
  everything is migrated, consider v1 migrated and done"; "use a label like
  `BOX_TZ` to refer to [the timezone] and make it easy to find."
- Precedent: `docs/implemented-plans/boxes-as-packages-v2.md` Track H — this plan
  is the completion of H4 ("deletions"), whose resolve-hook removal was
  *explicitly deferred until every box is confirmed v2* (`boxes-as-packages-v2.md:532-538`).

## What already exists

Grounded in a full-footprint inventory (2026-07-11). Reused/removed, not rebuilt:

- **The shape predicate.** `src/lib/box-shape.ts`: `getBoxShape` (`:65-86`) reads
  `.cb-box`; `getBoxShapeOrLegacyFallback` (`:97-105`) swallows non-`BoxShapeError`
  failures and synthesizes `{shapeVersion:1, packageRoot:boxRoot}`;
  `LEGACY_SHAPE_VERSION=1` (`:23`); the v1 arm of `getBoxShape` (`:78`);
  `boxCodePaths`/`boxCodePathsRelativeToBoxRoot` (`:205-236`, the v1/v2 path
  table); `findLegacySchemaFiles`/`describeLegacySchemaFiles` (`:178-200`).
- **10 real shape branches** (v1 arm → deletion): `engine-version.ts:48`,
  `box/index.ts:90` (`skipClaudeDir`) & `:157` (tricks `.gitignore` block),
  `box/skills.ts:49` (tricks skill fork), `box/templates.ts:356/408/433`
  (installTricks/Schemas/ViewsGuide), `node-view-runtime.ts:56` (v1 symlink
  dance), `schemas/registry.ts:333` (resolve-hook install), `health-engine.ts:34`
  (`>=2` engine-link check), `serve.ts:35` (slug basename), `upgrade.ts:256`
  (`LegacyBoxUpgradeError` guard). Plus the shape-branch-shaped helpers
  `agent-guide/box-shape.ts:68` and `compiler.ts:61` `defaultBoxShape()`
  (hardcoded `shapeVersion:1`).
- **~19 non-branching callers** of the shape lookup (`init-rules.ts:72`,
  `install-validation-hooks.ts:394`, `compile-exposition-rules.ts:82`,
  `list-cards.ts:90`, `docs-gen/index.ts:327/492`, `trick.ts:153`, `health.ts:149`,
  `box-guard.ts:78`, `schema-watcher.ts:37`, `supervisor.ts:414`, `status.ts:107`,
  `validate.ts:110`, csp-digest/report, …) — these need a `BoxShape` object for
  `packageRoot`/`boxCodePaths`, which is NOT v1-specific. **They stay**; only the
  shape *value* they receive changes.
- **The conversion script** `scripts/migrate/box-packageify.ts` (537 lines),
  registered `src/core/migrations.ts:95-99`, tested by two doctests, documented
  `docs/migrations.md:202-296`. This is the actual v1→v2 logic (upgrade.ts is
  NOT — it's an unrelated engine-version bumper with one incidental v1 guard).
- **The resolve-hook machinery** in `schemas/registry.ts` (`ensureEsmPackageJson`,
  `ensureResolveHooks`, `registerHooks`/`SCHEMA_DEPS`/`CB_VIRTUAL_PARENT`,
  ~`:150-200`) — only needed because a v1 box's `config/schemas/` had no
  `node_modules`. Dead in a v2-only world.
- **The two managed skills.** `box/skills.ts:49` tricks fork
  (`TRICKS_SKILL` vs `TRICKS_SKILL_V2 = TRICKS_SKILL.replaceAll("tricks/scripts/",
  "src/tricks/scripts/")`, `skills-content.ts:413,434`). `calendarSkill`
  (`skills-content.ts:251-288`) — parameterized on `{timezone, vtimezone}`,
  **not** on shape; the box timezone is *already* injected into the agent's
  system prompt (`buildTimezoneContext` → `box/config.ts:67`, `agent/run.ts:204`).
- **`cb calendar`** (`cli/commands/calendar.ts`) — today view-only; the plan adds
  a subcommand. `vtimezoneBlock(timezone)` already exists
  (`connectors/google-calendar-ics.ts`).

## Prior art (external)

Purely internal refactor — no third-party dependency in play; no external search
warranted. The one "prior art" is internal: the v2 plan
(`boxes-as-packages-v2.md`) designed this removal as Track H4 and named the
resolve-hook deletion's precondition ("every box confirmed v2"). This plan
discharges that.

## Tracks / scope

Ordered by dependency, smallest-independent-first.

### Track 1 — De-template the two managed skills (independent, ship first)

**What.** Make `tricks` and `calendar` static constants.

**Why.** They're the only non-static managed skills; making them static is the
precondition for reasoning about skill distribution as a whole, and the calendar
half is a direct boxholder request. The tricks half is also a down-payment on
Track 2 (its fork is one of the 10 shape branches).

**Direction.**
- **tricks:** rewrite `TRICKS_SKILL` (`skills-content.ts:413`) to say
  `src/tricks/scripts/` directly; delete the derived `TRICKS_SKILL_V2`
  (`:434`); `box/skills.ts:48-49` drops the shape lookup and ternary —
  `{ name: "tricks", content: TRICKS_SKILL }`. (`buildBoxSkills` no longer needs
  `getBoxShapeOrLegacyFallback` at all once this and Track 2 land; until Track 2,
  `generateSkills` still uses it for `packageRoot`.)
- **calendar (`BOX_TZ`):** replace the baked `${timezone}` with the literal
  placeholder token **`BOX_TZ`** in the `.ics` example (`TZID=BOX_TZ:…`) and
  define it once in the skill prose: *"`BOX_TZ` is this box's timezone — it's on
  the `Timezone:` line already in your system context."* This establishes a
  `BOX_*` placeholder convention for any per-box scalar a static skill references.
- **calendar (VTIMEZONE):** the DST block can't be a placeholder. Add
  `cb calendar vtimezone` — a thin wrapper over the existing `vtimezoneBlock()`
  that prints the box's VTIMEZONE — and have the skill say *"get the VTIMEZONE
  for `BOX_TZ` with `cb calendar vtimezone`, paste it verbatim."* `calendarSkill`
  becomes a plain `export const CALENDAR_SKILL` (no params); `buildBoxSkills` drops
  the `loadBoxTimezone`/`vtimezone` computation.

**Vocabulary lock-ins.** Placeholder token `BOX_TZ` (uppercase, underscore).
Command `cb calendar vtimezone`.

**First chunk.** All of Track 1 is one commit-sized unit (skills-content edits,
skills.ts simplification, the `cb calendar vtimezone` subcommand, box-skills
doctest update). Ships independently of Track 2.

### Track 2 — Remove the v1 shape

**What.** Delete the legacy shape: predicate arms, the 10 branches, the
resolve-hook machinery, the conversion script + registration + docs, and the
tests/docs that carry it.

**Why.** All boxes are v2; the bilingual code is dead weight and the resolve-hook
machinery is a real complexity sink whose deletion was gated on exactly this.

**Direction.**
- **`getBoxShape` becomes strict.** A `.cb-box` with `shapeVersion` absent or
  `< 2` is no longer silently v1 — it's a `BoxShapeError` ("box predates the v2
  package layout; convert with box-packageify" — but see Open Questions on
  whether that message can even fire given box-packageify is being deleted).
  `LEGACY_SHAPE_VERSION` deleted; `MAX_KNOWN_SHAPE_VERSION=2` stays as the ceiling.
- **The missing-marker fallback (principle #4).** `getBoxShapeOrLegacyFallback`'s
  job splits: its *legitimate* job (don't crash when a path has no `.cb-box` —
  test fixtures) stays, but the synthesized value must become a **v2** shape, not
  a v1 one. Decision (see Open Questions): rename to `getBoxShapeOrDefault` and
  synthesize `{shapeVersion:2, boxRoot, packageRoot: <resolved>}`; the ~19
  non-branching callers are unaffected (they only read `packageRoot`).
  `compiler.ts:61` `defaultBoxShape()` likewise flips to `shapeVersion:2`.
- **Collapse `boxCodePaths`/`…RelativeToBoxRoot`** to the single v2 arm (pure
  function of `packageRoot`). Keep as a named helper (readability), no branch.
- **Delete the 10 v1 arms** (each an unconditional collapse to its v2 arm — see
  the inventory table for the exact per-site collapse). Notable: `box/index.ts`
  `skipClaudeDir` becomes unconditional and its param dies; the tricks
  `.gitignore` block deletes; `node-view-runtime.ts`'s v1 symlink dance deletes;
  `health-engine.ts` runs `engine-link` unconditionally.
- **Delete the resolve-hook machinery** in `schemas/registry.ts`
  (`ensureEsmPackageJson`, `ensureResolveHooks`, the hook registry) — the largest
  single deletion; discharges `boxes-as-packages-v2.md` H4.
- **Delete `box-packageify`:** the script, its `migrations.ts:95-99` registration
  (pending-migration entry, NOT a manifest history record — verify against the
  append-only invariant, Open Questions), its two doctests, and the
  `docs/migrations.md:202-296` section. Delete `LegacyBoxUpgradeError` +
  `upgrade.ts:256` guard (upgrade.ts otherwise untouched).
- **`findLegacySchemaFiles`:** keep the function (it's a *stray-file-on-a-v2-box*
  detector, still useful), delete only its `=== LEGACY_SHAPE_VERSION` short-circuit.
- **`agent-guide/box-shape.ts:68`** always renders the v2 box-code section; drop
  the empty-string legacy case and the guide-assembler special-case.

**First chunk.** The predicate core: make `getBoxShape` strict + flip the fallback
to v2 + collapse `boxCodePaths`, with all doctests updated. Everything else
depends on this landing (the branch deletions read the collapsed shape).

### Track 3 — Docs + layout-spec cleanup

`docs/box-layout.md:11-64` (rewrite "Shape versions" to single-shape),
`docs/migrations.md` (remove box-packageify section), `docs/adding-a-box.md:91`,
`box-layout-types.ts` `shapeNotes` field + the three `box-layout-spec.ts`
entries whose notes only encoded the v1/v2 difference, and check off Track H4 in
`boxes-as-packages-v2.md`. **Explicitly out:** the unrelated `"legacy"`
`BoxLayoutArea` (ad-hoc dirs like `box/commands`) — different "legacy," do not touch.

## Failure modes

**Critical gap (must resolve in-plan):** `getBoxShape` strictness on a real box.
If *any* deployed box still lacks a `shapeVersion:2` marker, making the missing/low
marker an error hard-fails that box at load. The boxholder asserts all are v2, but
the plan's first action is a **verification sweep** (enumerate every box's `.cb-box`
on the deploy server + local `~/src/boxes`) before flipping strict. Without it, this
is a fail-closed regression.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A box with no/low `.cb-box` marker hits strict `getBoxShape` | planned (box-shape doctest: low marker → BoxShapeError) | throws `BoxShapeError` with a clear message | clear (fail-closed) — but see verification sweep |
| Test fixture with no `.cb-box` (relied on v1 default) | planned (fallback doctest → v2 shape) | `getBoxShapeOrDefault` → v2 synthesized shape | clear |
| `compiler.ts` caller not passing a shape | planned (compiler v2 doctest) | `defaultBoxShape()` → v2 | clear |
| Deleting `box-packageify` registry entry breaks a box's migration ledger | planned (migrations doctest still green) | verify: registry = *pending* set, not applied-history | clear (if invariant holds) |
| An implicit-v1 doctest (no `.cb-box` written) silently changes behavior | planned (grep sweep for `makeTmpBox()` w/o marker) | each updated to write a v2 marker or assert new default | clear |
| Resolve-hook deletion breaks schema loading on some box | planned (box-schemas-v2 doctest, live schema rebuild) | v2 boxes resolve natively via package-root node_modules | clear |

## Agent-flow / user-flow edge cases

- **Hand-edit drift** (a box author wrote a `shapeVersion:1` marker by hand):
  ADDRESSED — strict `getBoxShape` rejects it with a clear message; caught by the
  pre-flip verification sweep.
- **Partial migration / transition state:** ADDRESSED — this plan completes as
  one unit; there is no bilingual window afterward (that's the point). Before it
  lands, nothing changes.
- **Fabricated free-form value / wrong tag / stale ref / two agents:** N/A — no
  card format or agent vocabulary changes here (Track 1's `BOX_TZ` is the only
  agent-facing addition; covered in Knowledge audits).
- **Validation error UX:** ADDRESSED — the strict-shape error message names the
  box and the cause.

## NOT in scope

- **Dropping `shapeVersion` from the `BoxShape` type.** Even v1-gone, keep the
  field (a v3 could exist); removing it is a separate, larger call. One-line
  rationale: types should still name the version axis.
- **The unrelated `"legacy"` `BoxLayoutArea`** (ad-hoc directories) — different
  concept; untouched.
- **`cb upgrade`'s engine-bump machinery** — only its one v1 guard is removed.
- **Calendar skill beyond de-templating** — no behavior change to `.ics` sync.
- **Rename `getBoxShapeOrLegacyFallback`'s ~19 callers' logic** — they keep
  consuming `packageRoot`; only the function's synthesized value changes.

## Open design questions

- **Strict error message vs. deleted converter.** If `box-packageify` is deleted,
  the strict-shape error can't tell the user to "convert with box-packageify."
  Lean: the message says the box predates v2 and points at
  `docs/box-layout.md`; keep `box-packageify.ts` in `scripts/migrate/` as an
  archived/unregistered script *if* we want a lever, else delete. **Recommend
  delete** (everything's migrated; a stray v1 box is a bug to investigate, not
  self-serve convert) — but flagging for the boxholder.
- **`getBoxShapeOrDefault` synthesized `packageRoot`.** For a marker-less path,
  what's `packageRoot`? Today (v1) it's `boxRoot`. v2 fixtures have a real
  package root. Lean: synthesize `packageRoot = boxRoot` still (the fallback is
  for degenerate/test paths where they coincide), and let real boxes always carry
  a marker. Needs a doctest pinning the chosen semantics.
- **Migration-registry deletion vs. append-only.** Confirm `migrations.ts`'s
  array is the *pending-migration* registry (safe to remove a completed one) and
  not the applied-history manifest (`config/migrations.jsonl`, append-only).
  Inventory strongly suggests the former; verify against `docs/migrations.md`
  before deleting.

## Knowledge audits

Track 1 adds one agent-facing concept: the `BOX_TZ` placeholder + `cb calendar
vtimezone`. Add one `knows_about` audit (the calendar skill is on-demand, not
always-loaded): given "add a 2pm event," the agent finds `BOX_TZ` in system
context and uses `cb calendar vtimezone` for the block rather than hand-writing
DST. Run before Track 1 completes. Track 2/3 are infrastructure — no agent recall
(skip-with-rationale).

## Implementation order

1. **Verification sweep** — enumerate every box's `.cb-box` (deploy + local);
   confirm all `shapeVersion:2`. Gate for the whole plan (blocks Track 2).
2. **Track 1** — de-template skills (independent; can land first regardless).
3. **T2-core** — strict `getBoxShape` + v2 fallback + `boxCodePaths` collapse +
   doctests.
4. **T2-branches** — delete the 10 v1 arms + resolve-hook machinery (depends on 3).
5. **T2-converter** — delete `box-packageify` script/registration/doctests.
6. **Track 3** — docs + layout-spec + H4 check-off.

Each chunk is a commit; the plan ships as one unit.

## Rollout shape

- **Tests-first:** the `box-shape` doctest is rewritten as the spec of the new
  single-shape predicate (low-marker → error; no-marker → v2 default); the
  ~19 v1-touching doctests (enumerated in the inventory) are updated in the same
  chunk that changes their code; the implicit-v1 grep sweep (`makeTmpBox()`
  without a `.cb-box` write) runs before calling Track 2 complete.
- **Verification:** full `pnpm test` green; a live `cb init` + `cb serve` on the
  worktree box to confirm a real v2 box still builds skills/schemas/views after
  the resolve-hook deletion.
- **No data migration** — this removes migration *code*; on-disk boxes are already
  v2 and unaffected.
- **Codex cross-model review** of this plan before executing (blast radius +
  the append-only and fail-closed hazards warrant it).
- Ships by merge to main on the boxholder's signal (separate from the already-
  merged screenshot work).
