<!-- Cross-model review of docs/implemented-plans/plugins.md, round 1. Reviewer: codex gpt-6-astra,
     2026-10-09, read-only, via bin/cross-model-run. Adjudication by the planning
     session follows the reviewer's text; plan edits are in the same commit. -->

# Adjudication (planning session, 2026-10-09)

All eleven findings were checked against the cited source and hold. Disposition:

| # | Finding | Disposition |
|---|---|---|
| 1 | Active-but-incomplete plugins escape the checks | Fixed: checks are computed from effective schemas and from declared-versus-present for active plugins |
| 2 | Removing exposition compilation silently removes guidance | Fixed: instructions and skill text rewritten in the move; a warning for every nonempty legacy `rules`; marked-file cleanup kept across releases |
| 3 | Skill mirroring overwrites box-owned work | Fixed: refuse to overwrite an unmarked same-name skill; retire only marked files |
| 4 | Export-map entries do not produce the shipped library | Fixed: build and declaration pipeline chunk added; packaged-install doctest |
| 5 | Concept-map renderer is not usable as a box view | Deferred, boxholder decision: slice 1 keeps the built-in renderer for the default type name; the view-stub path moves to slice 2 with recipes |
| 6 | Courseware lint cannot move unchanged | Fixed: `lintCards` receives a small engine-provided context; default type names are a documented courseware convention; renamed-type lint support deferred |
| 7 | `extendSchema` does not express its operation | Fixed: delta typed independently, merged fields inferred, `superRefine` composed |
| 8 | Upgrade misses unchanged incompatible cards | Fixed in part: new-engine whole-box validate added to upgrade; block-or-report is a boxholder decision, lean report |
| 9 | Keep-last-good is not removal recovery | Fixed: wording corrected |
| 10 | A no-op procedure is not a migration notice | Fixed: migration entry removed; the warning is computed |
| 11 | Registry violates the layout rules | Fixed: `src/plugins.ts` with `directory: "./plugins"`; contracts in `src/shared/` |

"Could this be simpler" cuts accepted: no harness-directory rename, no `scripts` declaration until a plugin ships one. Citation corrections applied.

---

# Plan Engineering Review — plugins

## What already exists

The typed-library-and-stub direction fits the human decisions. **The plan is not implementation-ready:** several promised safeguards do not follow from the proposed checks, and courseware is not a mechanical move across the existing public boundary.

This was a read-only source review. No implementation, tests, box operations, or forbidden skill reads were performed.

The citations in “What already exists” and “Tracks” largely identify real extension points:

| Existing mechanism | Verified result |
|---|---|
| `cardSchema(type, config)` | The type and configuration are separate: `beebox/src/cards/schema.ts:523`. |
| Box schema override | Box schemas override built-ins: `beebox/src/schemas.ts:426`. Keep-last-good has important lifetime limits; finding 9. |
| View bundling | Imports resolve from the view directory and are bundled: `beebox/src/webapp/views/compiler/compile.ts:199`. This does not establish renderer portability; findings 4–5. |
| Managed skills | Marked stale directories are pruned, but writes do not protect same-name box-authored skills: `beebox/src/core/box/guidance-sync/skills.ts:100`. |
| Agent advertisement and docs | Briefs and inherited instructions supply these surfaces: `beebox/src/core/agent-guide/guide/cards.ts:63`; `beebox/src/core/docs-gen/box-docs.ts:38`. |
| Health, registries, import restrictions | These extension points exist. Their current behavior does not supply the proposed completeness checks or registry layout automatically. |
| Tricks and upgrade | The cited discovery, description parsing, subprocess, trailer, and new-engine typecheck mechanisms exist. Upgrade coverage is narrower than the failure table suggests; finding 8. |

Two smaller citation corrections:

- `LayoutRule` is at `beebox/src/dev/layout/model.ts:152`, not `src/dev/layout/check/model.ts`.
- Track 5 says `renderer-display-label.ts` loses concept-map entries. `beebox/src/frontend/src/lib/renderer-display-label.ts:37` is generic; there is no concept-map entry to remove.

## Ontology (verified against the code's own names)

- **`CardSchemaConfig`** contains fields, prose and hooks; **`CardSchema`** is the resolved schema. Neither is currently a plugin registration.
- **`Registry` / `defineRegistry`** is an existing compiled enumeration. It is still a registry; the plan’s statement that it adds “none” conflicts with its own Track 1. This is a terminology correction, not grounds to reject the later human decision.
- **`HealthCheck`** is a result object. An optional plugin callback does not itself guarantee any particular integrity check.
- **Installed**, **active**, and **usable through stubs** are different states. The proposal stores only active, while actual schema loading depends on stubs.
- A built-in **renderer** consumes `RendererProps`; a box **view** consumes `ViewProps`. Re-exporting one does not adapt it into the other.
- A **procedure migration** executes a procedure. It is not a declarative migration notice.
- “Nothing new runs at runtime” needs qualification: the proposal adds runtime health and lint callback dispatch, although it avoids an event-registration framework.

## Prior art (external) — verified

- Prettier 3 removed automatic plugin searching and directs users to explicit plugin options. The claim is correct; the plan’s heading fragment should be updated to the actual section. [Prettier 3 announcement](https://prettier.io/blog/2023/07/05/3.0.0#plugin-search-feature-has-been-removed)
- ESLint flat configuration explicitly imports plugin objects. [ESLint documentation](https://eslint.org/docs/latest/use/configure/plugins)
- VS Code contribution points are JSON declarations in `package.json`. This supports declarative metadata; it does not establish that importing a TypeScript plugin object executes no code. [VS Code contribution points](https://code.visualstudio.com/api/references/contribution-points)
- TiddlyWiki supports overriding plugin shadows by identity, with fallback after deleting the override. The plan accurately distinguishes that from importing a library. [TiddlyWiki shadow tiddlers](https://tiddlywiki.com/static/ShadowTiddlers.html)

OpenClaw and Hermes claims were accepted as pre-verified, as instructed. “No prior art found” is a bounded research result, not an independently verifiable absence claim.

## Stated preferences this plan trades against

The plan respects the decisions to use project-shipped typed libraries, retain box-owned stubs, activate nothing on new boxes, defer connectors, keep inventory core, and avoid adopting the originating issue’s per-box-plugin proposal as a requirement.

The material tensions are:

- **Must not go unnoticed:** active-but-incomplete setup, retained exposition rules, and some data incompatibilities lack the promised signal.
- **Must not brick the box:** keep-last-good is cited beyond its actual lifetime.
- **Manual, agent-run migration from documentation:** the proposed procedure “pointer” enters automatic upgrade execution.
- **Typesafe against beebox:** the public build and `extendSchema` contract are incomplete.
- **Small, composable artifacts:** the first chunk renames unrelated harness packaging before proving the courseware boundary.

These are evaluated against the direct human decisions, not the older issue’s optional proposals.

## Could this be simpler? (verified)

Yes. The plan compares itself with an artificially weak alternative that leaves courseware built-in. A smaller useful implementation can still move courseware out of core.

Start with one packaged courseware library, its exact schema/view stubs, explicit activation, discovery prose, and checks derived from actual files and effective schemas. Prove that path before expanding the generic interface.

Concrete cuts:

- Leave `beebox/plugins/` harness assets alone. They do not collide with `beebox/src/plugins/` or package export specifiers; `resolveHarnessPluginPath` already names their purpose.
- Omit unused `scripts` declarations until a plugin actually supplies scripts.
- Replace the proposed migration-note procedure with a warning computed from existing cards.
- Use plugin-local markup where practical rather than expanding the public widget API merely to reproduce private UI imports.
- Keep the registry, but place it according to the existing layout rules.

These cuts preserve the requested product behavior and remove unrelated packaging churn and unspecified state.

## Failure modes

Concrete states traced through the proposed mechanisms:

| Mechanism | Input/state | Result |
|---|---|---|
| Registry | Proposed `src/plugins/registry.ts`, `directory: "./"` | Violates existing registry-location/member rules; finding 11. |
| `./plugins/*` | Clean `build:cli`, then import courseware | Current bundler does not emit the new entry; finding 4. |
| `./plugins/*/view` | Concept-map stub imports moved view | Build, props, dependencies and CSS require adaptation; findings 4–5. |
| `BoxConfig.plugins` | `["coursware"]` or a non-array value | Existing config reader casts object fields; validation and recoverable diagnostics must be implemented explicitly. |
| `plugin-cards-inactive` | Active courseware, missing course schema | Predicate does not match; finding 1. |
| `plugin-stub-inactive` | Valid static stub, inactive plugin | Warning follows the specified predicate. |
| `plugin-stub-missing` | Registered plugin, missing `/view` output | Registry membership succeeds despite the broken import; finding 1. |
| `plugin-checks` | Active plugin without `healthChecks` | Produces no completeness check; finding 1. |
| `lintCards` | Renamed concept-map type | Existing sibling lookup silently misses it; finding 6. |
| `extendSchema` | Add one field to a multi-field base | Proposed delta constraint does not express that operation correctly; finding 7. |
| Courseware removal | Old-valid, unchanged cards under new schema | Upgrade’s new-engine staged-card gate misses them; finding 8. |
| Exposition removal | All stubs installed, `rules` still populated | Guidance disappears without the promised health failure; finding 2. |

For configuration, `beebox/src/core/box/config.ts:391` explicitly delegates field validation to readers; `loadAgentEngine` throws at `:210`. “Like agentEngine” is not a complete specification for preserving plugin-list and health diagnostics when the configured name is invalid.

## Agent-flow / user-flow edge cases

- The setup walkthrough promises a missing-stub message that none of the four specified checks produces.
- Deactivation leaves schema/view imports working but removes skill and lint participation. The chat explanation needs to name the loss of checks, not merely the skill.
- An existing box-owned skill named `courseware` can be overwritten during activation.
- A fresh agent can follow regenerated exposition instructions and author new rules that no longer execute.
- A box skipping the one cleanup release can retain obsolete exposition guidance indefinitely.
- Box-chosen type names are presented as ordinary customization, but courseware’s cross-card lookup conventions still assume default names.

## Findings

### 1. [P1] Active-but-incomplete plugins escape all four checks

**Location in plan:** `beebox/docs/implemented-plans/plugins.md:338`

**Citation:** “cards whose type matches a default type key of an inactive plugin's `schemas` and no box schema defines it.”

**Issue:** Set `plugins: ["courseware"]`, omit `src/schemas/course.ts`, and retain a course card. The inactive-card predicate is false; there is no stub import to trigger either stub check; the sample courseware definition at `:401` supplies no `healthChecks`. This contradicts the missing-stub message promised in `plugins.design.md:85`.

Likewise, `plugin-stub-missing` checks registry membership, not whether the referenced export or named export exists.

**Why it matters:** The plan’s primary protection against partial activation can report nothing precisely when setup is incomplete.

**Suggested action:** Derive missing-type diagnostics from effective loaded schemas regardless of activation. Separately compare active plugin declarations with actual loaded schemas/views. Reuse existing schema-load diagnostics for failed imports. Check the exact example above, plus a registered plugin whose `/view` export is absent. No durable state is necessary.

**Relevant preference:** Uninstall, rot and update conflicts must not go unnoticed.

### 2. [P1] Removing exposition compilation silently removes guidance

**Location in plan:** `beebox/docs/implemented-plans/plugins.md:402`

**Citation:** “field kept one release; README migration; prune-only surface | clear via health”

**Issue:** With courseware active and every stub present, populated `exposition-plan.rules` triggers none of the proposed checks. Pruning then removes the previously loaded guidance.

The moved schema instructions still promise automatic compilation at `beebox/src/schemas/exposition-plan.ts:68`, and the skill repeats that promise at `beebox/src/core/box/guidance-sync/skills-content.ts:79`. Generated box-local docs would therefore teach agents to create new inert rules.

The compiler scans exposition cards independently of course cards (`beebox/src/core/compile-exposition-rules.ts:97`), so the migration’s course-only trigger also misses relevant state.

**Why it matters:** Both existing courses and newly authored courses can silently lose teaching instructions.

**Suggested action:** Rewrite schema instructions, skill text and examples to author nested `AGENTS.md`. Emit a read-only warning for every nonempty legacy `rules` field until manually migrated. Specify actual idempotent cleanup code: the guidance registry has no prune-only installer, and owner rows are skipped (`guidance-sync/core.ts:98`). Retain cleanup across skipped releases rather than for one release only.

**Relevant preference:** No derived-rules hook; use `AGENTS.md`; migration must be manual and visible.

### 3. [P1] Skill mirroring can overwrite box-owned work

**Location in plan:** `beebox/docs/implemented-plans/plugins.md:318`

**Citation:** “Marked and pruned like the rest.”

**Issue:** Suppose the box already owns an unmarked `courseware/SKILL.md`. `generateSkills` writes the selected skill unconditionally at `beebox/src/core/box/guidance-sync/skills.ts:106`. DOCID checks protect pruning, not installation.

Activation overwrites the file and marks it engine-owned. Later deactivation can delete its directory at `:119`, including supplementary box-authored files.

**Why it matters:** Reusing this mechanism does not uphold the plan’s claim that box-authored skills survive.

**Suggested action:** Before writing, detect an existing unowned destination and report the conflict without overwriting it. During retirement, remove owned files only and preserve unmarked extras. The concrete regression case is activation followed by deactivation with an existing unmarked same-name skill. This needs no new tracker.

**Relevant preference:** Update conflicts must not destroy work or go unnoticed.

### 4. [P1] Export-map entries do not produce the shipped library

**Location in plan:** `beebox/docs/implemented-plans/plugins.md:271`

**Citation:** `"./plugins/*": { types: "./dist/plugins/*/index.d.ts", default: "./dist/plugins/*/index.js" }`

**Issue:** The current CLI build enumerates public entry points explicitly in `beebox/src/scripts/build-cli/build/bundle.ts:44`. It does not emit plugin modules. Declaration generation includes only cards and schema at `beebox/tsconfig.declarations.json:18`; the ordinary TypeScript build disables declaration emission at `beebox/tsconfig.json:23`.

A clean `build:cli` therefore cannot satisfy either proposed public subpath merely by adding exports. Existing output can mask this in a development checkout.

**Why it matters:** The package can advertise imports or types it does not ship, defeating the central typed-library promise.

**Suggested action:** Add the Node and browser plugin entries to the actual build and declaration pipeline, including required assets. Verify both imports and stub typechecking from a clean packaged installation. `makeTmpBox({deps:true})` alone is insufficient because it links the checkout (`beebox/test/helpers/doctest-helpers.ts:65`).

**Relevant preference:** Any plugin code must be typesafe against beebox.

### 5. [P1] The concept-map renderer is not directly usable as a box view

**Location in plan:** `beebox/docs/implemented-plans/plugins.md:405`

**Citation:** “importing only `beebox/view-widgets` and its own files.”

**Issue:** The renderer consumes `{data, onNavigate}` at `beebox/src/frontend/src/components/concept-map/ConceptMapView.tsx:18`; box views receive `ViewProps`, including `cards` and `navigate`, at `beebox/src/core/views/types.ts:32`.

It also imports private UI components and uses a different Markdown API. The public Markdown contract is at `beebox/src/exports/view-widgets.d.ts:30`.

The graph imports CSS and React Flow at `ConceptGraph.tsx:8`, and dagre at `graph-model.ts:9`. Those dependencies are absent from the engine package’s dependencies. The view compiler returns JavaScript output and specifies no CSS delivery path (`compile.ts:199`, `:218`).

**Why it matters:** The “mostly moves” estimate conceals an adapter and packaging change. A stub re-export does not preserve rendering behavior.

**Suggested action:** Specify the `ViewProps` adapter, public Markdown usage, dependency ownership and CSS delivery. Preserve the current graph with plugin-local markup where possible. Verify a nonempty graph through the packaged stub, including body links and node interaction. A broader public UI API would be **human decision required**.

**Relevant preference:** Small typed stubs using the public beebox surface.

### 6. [P1] Courseware lint cannot move unchanged

**Location in plan:** `beebox/docs/implemented-plans/plugins.md:354`

**Citation:** “the node-refs lint moves unchanged”

**Issue:** There are two concrete boundary failures:

- `beebox/src/core/card-lint/core/node-refs.ts:35` imports private containment and reference helpers absent from the public cards surface.
- Its sibling-map lookup hardcodes `.concept-map.card` at `:156`. A box using `cardSchema("knowledge-map", conceptMapBase)` causes lesson node checks to return no result. Generic reference checking cannot catch bare node IDs (`lint-cards.ts:281`).

Dispatching every box-schema card to every active plugin also supplies no binding between a renamed schema and its source base.

**Why it matters:** Implementers must either violate the promised import boundary or change behavior. Renaming a supported type can silently disable checks.

**Suggested action:** Identify a narrow public containment-aware helper or preserve that logic inside the plugin. Define courseware’s supported type-name convention explicitly. General renamed-type support through a new mapping contract is **human decision required**; do not silently infer ownership from field shapes.

**Relevant preference:** Box-owned extension, typesafety, and visible rot.

### 7. [P1] `extendSchema` does not yet express its promised operation

**Location in plan:** `beebox/docs/implemented-plans/plugins.md:376`

**Citation:** `D extends Partial<B>`

**Issue:** `Partial<B>` makes `fields` optional; it does not make `B.fields` a partial mergeable field map. For a precise base containing `title` and `body`, `{fields: {rating: z.number()}}` is not its partial configuration. Widening the base to accept it sacrifices the inference the helper is supposed to preserve.

The merge contract also omits `superRefine`, an existing parse-time invariant hook (`beebox/src/cards/schema.ts:252`). Treating it as an ordinary replacement can silently discard base invariants. Allowing arbitrary incompatible field overrides can likewise invalidate inherited callbacks.

**Why it matters:** The central “subclass” operation either rejects the intended example, weakens its types, or loses validation behavior.

**Suggested action:** Define the delta independently from the base, infer merged fields, and specify callback compatibility and `superRefine` composition. The acceptance example should add `rating` without restating base fields, retain typed summary access, and preserve both base and delta validation. Reject incompatible overrides rather than silently weakening inherited contracts.

**Relevant preference:** Plugin code must remain typesafe against beebox.

### 8. [P1] Upgrade validation misses unchanged incompatible cards

**Location in plan:** `beebox/docs/implemented-plans/plugins.md:478`

**Citation:** “upgrade typecheck does not catch data; validation does”

**Issue:** Upgrade performs whole-box validation under the old engine (`beebox/src/cli/commands/upgrade.ts:264`), then new-engine migration, initialization and typechecking.

Commit hooks do run. However, their new-engine validation checks staged cards only (`beebox/src/cli/commands/validate/pre-commit.ts:69`). An unchanged course card missing a newly required field is not staged by a dependency bump.

**Why it matters:** A successful upgrade does not establish the claimed data compatibility or per-card visibility.

**Suggested action:** Add an explicit new-engine whole-box validation point before declaring upgrade success. For the first courseware extraction, choose whether unmigrated cards block the upgrade or remain temporarily usable during manual migration. That compatibility policy is **human decision required**; a health notice alone does not settle it.

**Relevant preference:** Manual migration without unnoticed breakage.

### 9. [P2] Keep-last-good is not removal recovery across restarts

**Location in plan:** `beebox/docs/implemented-plans/plugins.md:474`

**Citation:** “schema loader keep-last-good (`schemas.ts:333`)”

**Issue:** Last-good schemas live in an in-memory map (`beebox/src/schemas.ts:196`). On a fresh process, a broken plugin import has no prior record and contributes no schema (`:377`). Deleted schema files also drop their records (`:310`).

The citation correctly describes incomplete saves within one process, but does not support continued schema availability after library removal and restart.

**Why it matters:** The failure table implies stronger recovery than exists. The diagnostic survives; the schema need not.

**Suggested action:** State the actual lifetime explicitly. Make safe removal rely on compatibility staging and the upgrade gate, not this cache. Do not introduce a persistent executable-schema fallback merely to preserve the wording; that would be **human decision required**.

**Relevant preference:** Removal and rot must not brick the box.

### 10. [P2] A no-op procedure is not a migration notice

**Location in plan:** `beebox/docs/implemented-plans/plugins.md:423`

**Citation:** “a procedure migration that … writes nothing and records a health-visible note”

**Issue:** Procedure migrations execute `bbx procedure run` (`beebox/src/cli/commands/migrate.ts:94`), require an installed procedure with an aborting validation gate (`:82`), and are invoked by upgrade’s `migrate --apply`.

The migration manifest contains only name and application time (`beebox/src/core/migrations.ts:138`). Existing migration attention uses question cards, not an unspecified no-write note.

**Why it matters:** The proposed pointer introduces automatic procedure execution and unspecified persistence into a docs-driven manual migration.

**Suggested action:** Remove this migration entry. Compute the warning from existing courseware cards and legacy rules, with the README as the repair instruction. A separate persistent notice and acknowledgment lifecycle would be **human decision required**.

**Relevant preference:** Migration is manual and agent-run from documentation.

### 11. [P2] The proposed registry violates the rules it claims to reuse

**Location in plan:** `beebox/docs/implemented-plans/plugins.md:269`

**Citation:** “The existing `registry-location` and `member-imports` layout rules apply.”

**Issue:** The proposed registry sits inside its own set directory. Existing rules require the registry in the parent, named for the set (`beebox/src/dev/layout/check/rules/sets/registry-location.ts:40`).

The sibling `types.ts` and registry file are also unclaimed code children under the proposed set (`set-members.ts:20`).

**Why it matters:** The first implementation chunk fails existing layout enforcement before its new boundary rule is relevant.

**Suggested action:** Use `src/plugins.ts` with `directory: "./plugins"` and place shared plugin contracts outside the member directory. Keep the existing enforcement intact.

## NOT in scope (verified)

- External or user-installed plugins, marketplaces and per-plugin dependency/version negotiation.
- Connector extraction, scoped Markdoc tags, recipes, figures and judgment.
- Inventory extraction: it remains in the schema and system-card machinery.
- Tab-arrangement and Telegram removal.
- Course study-home design.
- Making every box start with its own plugin.

The older issue’s proposals do not override the later decisions or expand this review’s requirements.

## Things I checked and found clean

- All five courseware schemas use the claimed cards/Zod boundary.
- Box schemas really do override built-ins, and inherited `brief`/`instructions` support ordinary advertisement and generated docs.
- The three courseware lint branches are exactly where cited. The adjacent figure branch must remain.
- Courseware template registration is isolated and can be removed without inventing a templates hook.
- Exposition compiler call sites and the guidance-surface citation are accurate.
- Trick discovery, description parsing, subprocess environment and commit-trailer citations match the source.
- Upgrade typechecks against the new engine and attempts dependency restoration on rollback.
- Unmarked, unrelated skill directories survive pruning; the problem is same-name installation and directory retirement.
- Track 5 should explicitly say to remove the five courseware registrations from `schemas.ts`. Its “untouched” wording is ambiguous; only the inventory/system-card machinery should remain untouched.

## Extra files opened

Beyond the read-list, including bounded content searches and delegated inspection:

- `issues/exploration/2026-08-19-plugins-and-the-medium-content-line.md`
- `beebox/src/dev/layout/model.ts`
- `beebox/src/dev/layout/check/rules/sets/decls.ts`
- `beebox/src/dev/layout/check/rules/sets/member-imports.ts`
- `beebox/src/dev/layout/check/rules/sets/path-reads.ts`
- `beebox/src/dev/layout/check/rules/sets/record-keys.ts`
- `beebox/src/dev/layout/check/rules/sets/registry-imported.ts`
- `beebox/src/dev/layout/check/rules/sets/registry-location.ts`
- `beebox/src/dev/layout/check/rules/sets/rule.ts`
- `beebox/src/dev/layout/check/rules/sets/set-members.ts`
- `beebox/src/dev/layout/check/rules/sets/side-effect-registration.ts`
- `beebox/src/core/agent/plugin-paths.ts`
- `beebox/test/webapp/views/compiler.lint-hooks.doctest.md`
- `beebox/src/scripts/build-cli/build/bundle.ts`
- `beebox/tsconfig.json`
- `beebox/tsconfig.declarations.json`
- `beebox/src/frontend/src/lib/renderer-display-label.ts`
- `beebox/src/exports/view-widgets.d.ts`
- `beebox/src/core/views/types.ts`
- `beebox/src/cli/commands/migrate.ts`
- `beebox/src/core/box/guidance-sync/core.ts`
- `beebox/src/core/migration-sweep.ts`
- `beebox/src/cli/commands/status.ts`
- `beebox/src/webapp/trpc/routers/health/checks/engine.ts`
- `beebox/src/core/system-cards.ts`
- `beebox/src/lib/git/core/operations.ts`
- `beebox/src/cli/commands/init.ts`
- `beebox/src/core/box/structure/core.ts`
- `beebox/src/core/install-validation-hooks.ts`
- `beebox/src/core/validation-ignore.ts`
- `beebox/src/cli/commands/validate/command.ts`
- `beebox/src/cli/commands/validate/pre-commit.ts`
- `beebox/src/cli/commands/validate/box-checks.ts`
- `beebox/src/cli/commands/validate/canonical.ts`
- `beebox/src/cli/commands/validate/report.ts`
- `~/.codex/memories/MEMORY.md` — keyword search only; no relevant prior facts were used.

## Single most important change

**Define plugin health from actual usable schemas, views and remaining migration work—not from the activation list.** An active plugin with missing stubs or discarded guidance must remain visibly broken until repaired; the current four-check design cannot guarantee that.
---

# Implementation review (2026-10-10)

Reviewer: codex gpt-6-sol on the branch diff (`git diff main...HEAD -- beebox`),
read-only, two rounds via `bin/cross-model-run`.

Round 1 found five problems, all verified against the source and fixed in
commit `061437772`: typed bases lost through the public export (now
`definePlugin<const S>`); a present stub with the wrong type passing health
(now compared with the effective schema map); a throwing `lintCards` hook
aborting validation (now one warning per card); the upgrade hiding
validation warnings (now prints them and the plugin health rows, never
blocking); invalid `plugins` entries invisible to health (now `plugin-config`).

Round 2 verified all five fixes hold. Residual, accepted as a documented
risk: if a stub file for one type defines a different type while another box
schema file defines the expected type, the effective map contains the type
and no row fires. The stub status in `bbx plugins list` names the file; a
provenance check (which file defined which type) is not built.
