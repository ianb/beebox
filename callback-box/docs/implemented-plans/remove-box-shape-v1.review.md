# Plan review — remove-box-shape-v1 (Codex, gpt-5.6-sol, 2026-07-11)

Cross-model review of the draft `remove-box-shape-v1.md`. Findings verbatim
below (absolute path prefixes normalized to repo-relative). Bottom line: **Track 1
(skills de-templating) is unaffected and safe; Track 2 (v1 removal) is NOT
implementation-ready** — its core root-model mechanism is wrong and its true
cost is redesigning test-fixture construction, not deleting branches.

## Findings (verbatim)

**Bottom line:** The plan is not implementation-ready. Its central "v2 fallback"
creates an invalid `BoxShape`, the compiler change silently breaks metadata
loading, and deleting the migration registry entry directly violates the
documented append-only invariant.

1. **Critical — `compiler.ts` cannot simply flip its synthetic shape from 1 to
   2.** `defaultBoxShape()` (`src/webapp/views/compiler.ts:56-62`) returns shape 1
   with `packageRoot = PACKAGE_ROOT` *deliberately*: it selects module-resolution
   behavior. `node-view-runtime.ts:56-64` builds two symlinks for that mode (the
   engine's shared `node_modules` plus an explicit inner `node_modules/callback-box`
   self-link); the v2 arm (`:64-66`) only links `packageRoot/node_modules`,
   assuming a real box package whose `node_modules` contains `callback-box`. The
   engine's own `node_modules` has no `callback-box` child. Flipping the number
   sends the engine-host shape through the v2 arm, so `callback-box/view-widgets`
   metadata imports fail — swallowed into "Failed to compile" (`compiler.ts:258-275`),
   a silent regression. `defaultBoxShape()` needs to disappear or become an explicit
   "engine-hosted" vs "box-package" resolution mode, not be relabeled v2.

2. **Critical — `{shapeVersion:2, packageRoot:boxRoot}` is an impossible shape,
   and several "non-branching" callers depend on the distinction.** The v2 contract
   says packageRoot is the *parent* of boxRoot and validates the parent's
   package.json (`box-shape.ts:52-84`). The proposed fallback bypasses that while
   claiming the validated shape. Concrete breakage: `boxCodePaths()` resolves
   `boxRoot/src/...` not `dirname(boxRoot)/src/...` (`box-shape.ts:204-216`),
   consumed by `list-cards.ts:82-98` and `registry.ts:304-318`; `installTricksFiles()`
   writes the wrong tree (`templates.ts:346-359`); `generateRules()` /
   `compileExpositionRules()` use `relative(packageRoot, boxRoot)` for the required
   `content/` prefix — the proposed shape yields `""`, i.e. legacy semantics
   (`init-rules.ts:71-84`, `compile-exposition-rules.ts:81-100`);
   `installValidationHooks()` mislocates `.claude`/`.git/hooks`
   (`install-validation-hooks.ts:393-430`); `engineHealthChecks()` inspects the
   wrong `node_modules/callback-box` (`health-engine.ts:30-52`). The "~19 callers
   unaffected" claim is false.

3. **High — deleting the `box-packageify` registry entry is definitively unsafe.**
   `migrations.ts:2-8`: canonical ordered list, "never reorder or remove existing
   entries." `migrations.md:80-84`: "Never reorder, rename, or remove."
   `migrate.ts:93-96` computes pending = MIGRATIONS − manifest; removing the name
   makes `cb migrate --mark-applied box-packageify` an "unknown migration"
   (`migrate.ts:104-118`). Preserve the stable name as a retired/tombstone
   migration (idempotent no-op / v2 assertion), don't delete.

4. **High — the implicit-v1 inventory misses the actual fixture constructors.**
   `makeTmpBox()` always writes an **empty marker**, which currently means v1
   (`test/helpers/doctest-helpers.ts:33-40`) — ~579 calls. `initBox()` defaults
   fresh direct callers to explicit `shapeVersion: 1` (`box/index.ts:31-39,67-79`)
   — 55 sites. The shared route-server fixture calls `initBox(dir)` with no
   package scaffolding (`test-server.ts:68-74`). `detectBoxTarget()` classifies any
   marker at the root as `update-legacy` (`box/package.ts:25-64`). This is not a
   handful of doctests — fixture construction and the init target model must be
   redesigned: helpers should create a package root + `content/.cb-box`, not
   fabricate v2 by changing one marker field in a flat tree.

5. **High — the fallback stays broader than "missing marker" and still silently
   accepts malformed markers.** `readBoxMarker()` runs `JSON.parse` before Zod
   (`box-shape.ts:107-122`); invalid JSON throws `SyntaxError`, not `BoxShapeError`,
   and `getBoxShapeOrLegacyFallback` catches every non-`BoxShapeError` and
   synthesizes a shape (`box-shape.ts:97-104`), masking permission/IO errors. A
   v2-only fallback, if retained, must distinguish `ENOENT` specifically; invalid
   JSON, unreadable markers, and unexpected FS failures must remain errors.

6. **High — Track 2's stated commit order has broken intermediate states.**
   T2-core makes low markers strict before deleting the converter. But
   `cb migrate --apply` provisions with `cb init` before running pending
   migrations (`migrate.ts:270-295`); for an old box `detectBoxTarget()` returns
   `update-legacy` and `initBox()` reaches shape lookup (`box/index.ts:82-90`), so
   once T2-core rejects shape 1, provisioning fails before `box-packageify` can
   run. And the shared test helpers still create v1 markers, so T2-core can't be a
   green independent commit. Fixture conversion, init/detection changes, strict
   shape handling, and converter retirement must be one atomic chunk (or reverse
   the sequence with a transitional fixture API).

7. **Medium — `box-packageify`'s footprint is larger than claimed.** Resolve-hook
   deletion IS separable (guarded solely by `shapeVersion === 1`,
   `registry.ts:325-336`, with the v2 doctest verifying native resolution). But
   `box-packageify` also has `scripts/smoke-packageify.ts`, the `smoke:packageify`
   package script (`package.json:35-44`), `detectBoxTarget`'s `update-legacy`
   mode, migration-loop root re-resolution (`migrate.ts:337-343`), four knowledge
   audits + context-history entries, and live comments in `git.ts`, `deploy.sh`,
   `upgrade.ts`, migration docs. `detectBoxTarget` and registry identity are
   functional dependencies, not stale-doc cleanup.

8. **Medium — citation/inventory errors.** "10 real shape branches" is actually
   **12**. The registry entry is at `migrations.ts:100`, not `:95-99`. The
   `box-packageify` docs section ends at `migrations.md:235`, not `:296`. "test
   fixture with no `.cb-box`" mis-describes the main helper (it writes an empty
   marker). The "~19 callers only read packageRoot" claim contradicts the cited
   callers using `shapeVersion`/`boxCodePaths`/root-relative prefixes. (The
   `boxes-as-packages-v2.md:532-538` prior-art citation IS accurate.)

**Single most important fix before implementation:** redesign the root model —
remove the synthetic "v2 with `packageRoot = boxRoot`", define valid v2 fixtures
and an explicit engine-hosted compiler resolution mode, then re-inventory every
fallback caller against those real invariants.

## Disposition (plan author)

- **Track 1 (skills de-templating): unaffected — proceeding.** No finding touches
  it; the tricks-fork collapse and the calendar `BOX_TZ` + `cb calendar vtimezone`
  change are shape-model-independent. Executing now.
- **Track 2 (v1 removal): core model superseded — needs redesign before any code.**
  Findings 1, 2, 4 are decisive: the real work is redesigning fixture construction
  (`makeTmpBox`/`initBox` defaults, ~634 sites) to build genuine v2 package
  layouts, plus an explicit "engine-hosted" compiler resolution mode distinct from
  both v1 and box-package v2. Finding 3 converts the `box-packageify` deletion into
  a retirement/tombstone. Finding 6 says the strict-shape flip, fixture redesign,
  init/detect changes, and converter retirement must land as one atomic change, not
  the staged order drafted. This is a substantially larger, standalone effort than
  the draft assumed — reframed for a boxholder scope decision rather than executed
  off this draft. Citation errors (finding 8) noted for any re-draft.
