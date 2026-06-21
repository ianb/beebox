# Agent-applied migrations (via procedure checklists)

Two layered capabilities, designed together:

1. **Procedure checklists** — a general, opt-in affordance: any procedure step
   can carry a *checklist*, a plain working file the agent edits in place as it
   works, validated as a whole when the agent declares done. It exists for any
   procedure that wants added thoroughness; migrations are just the first and
   most natural consumer.
2. **Procedure-backed migrations** — a new *kind* of entry in the existing
   migration registry whose "transform" is running a procedure (typically one
   with a checklist), recorded per-box in the same `config/migrations.jsonl`
   ledger when it completes.

The motivating first instance is the `ViewCard` interface change (the
card-shape cleanup), which breaks box-local custom `.tsx` views written against
the old shape (`card.tagName`, `card.attrs`, `card.children`, `card.text`,
`card.element`, `card.status`). A deterministic script can't update arbitrary
box-authored TSX; an agent following a checklist can, gated by a machine check
(`cb view check`).

## Status (partially implemented)

Landed on this branch and verified deterministically (full suite green):
- **Track 1** — `cb view check` (`src/cli/commands/view.ts`, `test/view-check.doctest.md`):
  whole-box render gate; per-view killable child + timeout.
- **Track 2 (convention)** — the checklist convention is realized by the
  `view-card-shape` procedure's embedded `[ ]`/`[x]` checklist (Track 4). The
  general `docs/procedure-implementation.md` write-up + knowledge audit are not
  yet written.
- **Track 3A/3B** — `Migration` discriminated union + `cb migrate` procedure
  dispatch + the "require a `validate.shells`+`abort` gate" guard
  (`src/core/migrations.ts`, `src/cli/commands/migrate.ts`).
- **Track 4** — the `view-card-shape` procedure migration
  (`templates/procedures/view-card-shape.procedure.card`, registered in
  `MIGRATIONS`). `cb view check` flags the real `test1/views/todos.tsx` with the
  exact `card.attrs` error; the procedure parses, passes the gate guard, and
  appears in `cb migrate --status`.

Outstanding (not yet done):
- **The live agent run** — actually executing `cb procedure run view-card-shape`
  so an agent rewrites a broken view to green. The mechanism is verified; the
  agent *executing* it is not.
- **Checklist deletion** — the checklist file currently persists (committed)
  rather than being deleted post-step; deletion needs procedure-engine support.
- **`cb view check` `params.path` sampling** (Open q4) and faster isolation
  (Open q5) — v1 renders default params, spawn-per-view.
- **Knowledge audit** for the checklist discipline (Track 2).

## Stated preferences this plan trades against

- `callback-box/CLAUDE.md:118` (Behavioral Notes) — *"Read before writing. Don't
  guess file formats…"* This plan reuses the procedure engine and the migration
  manifest rather than building parallel machinery; the design earned that by
  reading both first (see What already exists).
- `callback-box/CLAUDE.md` — the bias against *"add[ing] features beyond what
  the task requires."* The earlier draft of this plan invented a `migration-run`
  card with per-step schema validation and a dedicated runner; that was
  over-built. Procedures already do it. Cut.
- `callback-box/src/core/migrations.ts:2-9` — *"`name` … is the stable manifest
  key … never reordered, renamed, or removed."* The new kind honors this.
- `callback-box/docs/testing.md` — tests-first as a design tool; the machine
  gate (`cb view check`) is the done-condition encoded as a runnable check.
- `callback-box/CODE-STYLE.md` — max 2 positional params (named options), no
  `any`, custom error classes.
- Densest precedents: the script-migration system (`cb migrate` +
  `migrations.jsonl`, May 2026 rollout `docs/migrations.md:125-138`) and the
  procedure engine. The new work should read as a join of the two, not a third
  thing.

## What already exists

The whole design is a join of two systems that already exist.

**The migration system (the per-box ledger).**
- `callback-box/src/core/migrations.ts:17-22` `interface Migration { name;
  script }`; `:24-55` the ordered `MIGRATIONS` array; `:57`
  `MANIFEST_PATH = "config/migrations.jsonl"`; `:59-62` `ManifestEntry =
  {name, "applied-at"}`. **Extend** `Migration` to a union; reuse the manifest.
- `callback-box/src/cli/commands/migrate.ts:108-184` — `cb migrate`
  (status/`--apply`/`--mark-all-applied`); `:73-84` spawns a script via
  `npx tsx`; `:162-176` exit-code → manifest-append/halt. **Extend** with a
  procedure-kind branch.
- `callback-box/src/core/box.ts:62-84` — new boxes seed the manifest
  all-applied. **Reuse** (a fresh box has no old views → nothing to do).

**The procedure engine (the execution host) — what it ACTUALLY enforces.**
A Codex review (2026-06) caught that an earlier draft over-claimed the engine's
guarantees. Verified against source:
- `run.agents` runs as an agent step (`schemas/procedure.ts:22-33`;
  `engine.ts:72-73`). **But an agent that returns failure does NOT fail the
  step** — it's only logged (`engine-step.ts:247-253`); non-zero run-phase shells
  are logged, not propagated (`:257-270`).
- **The ONE hard gate that exists is `validate.shells` with `severity: abort`.**
  A failing validate shell sets status `fail` (`engine-phase.ts:75-85`), and a
  step is marked `failed` only when `validate.status === "fail" && severity ===
  "abort"` (`engine-step.ts:295-299`). Everything else `completes`.
- **`validate.instructions` (model judgment) is NOT implemented** — *"instruction
  checks pass by default"*, TODO "Invoke review model" (`engine-phase.ts:91-104`).
  **`severity:review` retry is NOT implemented** — it downgrades the failure to
  `warn` and continues, TODO (`:106-111`). The design must NOT rely on either;
  using them would give false confidence (a pass-by-default no-op).
- Procedures **auto-commit** per step (`engine-step.ts:329-334`) and at
  start/finish (`engine.ts:193-197,232-236`) — matters for the transaction model
  (Track 3). Per-step `git-ref` is recorded (`schemas/procedure-run.ts:35-43`).
- `cb procedure run|status|gc` (`cli/commands/procedure.ts:5-7,20`); definitions
  resolve from `config/procedures/<name>.procedure.card` (`engine.ts:36-52`).
- **Reuse caveat:** procedure *templates* install only `*.procedure.card`
  (`box-defaults.ts:47-54`) — a *separate* checklist template would need new
  install logic, so the checklist is embedded in the procedure's agent prompt
  instead (Track 2). The reactor "partitions procedure vs agent jobs" comment is
  stale — the implementation routes every job to an agent
  (`reactor/engine.ts:297-305`); migrations are operator-driven via `cb migrate`,
  so this doesn't matter, but it's not evidence of "already integrated."

**Views (the first instance's surface).**
- Enumerate: `compiler.ts:209-244` `listViews`; `:182-189` `lintViewFile`
  (syntax only). Per-view render check: `view.ts:121-193` `cb view test <slug>`
  (Node render, exit 1 + stack on throw). **No "check all views" command exists**
  → Track 1. Card loading: `view-cards.ts:42-98` `loadViewCards`.
- New shape: `types/views.ts:65-75`. Failure is loud: `ViewErrorBoundary.tsx:20-60`.

## Prior art (external)

- **Checklist = externalized reasoning, agent-controlled.** *Nidus:
  Externalized Reasoning for AI-Assisted Engineering*
  ([arxiv 2604.05080](https://arxiv.org/pdf/2604.05080)) — a working list the
  agent edits as it goes is a thinking tool, not a compliance form; it supports
  non-linear, revisited traversal. Directly supports making the checklist a
  plain agent-owned file rather than an engine-tracked state machine.
- **Verification-gated agent migration.** *Environment-in-the-Loop*
  ([arxiv 2602.09944](https://arxiv.org/html/2602.09944v1)) and Spotify's
  judge-LLM ([ZenML](https://www.zenml.io/llmops-database/autonomous-codebase-migration-at-scale-using-llm-powered-agents))
  — the agent's "done" must be grounded in an executable check; a model judge is
  the soft backstop. v1 uses only the executable (`validate.shells`) side; the
  model-judge side (`validate.instructions`) is unimplemented in the engine (see
  above) and is explicitly future work, not relied on now.
- **Codemods carry version-scoped, tracked transforms** ([codemod.com](https://github.com/codemod/codemod),
  [Martin Fowler](https://martinfowler.com/articles/codemods-api-refactoring.html))
  — the mechanical part of the view migration should be a deterministic codemod
  (its own `kind:"script"` entry); the agent handles only the residual.
- **No prior art found** for tying a procedure run to a per-box append-only
  migration ledger — that join is specific to this codebase, and reusing both
  halves is the right call.

## Tracks / scope

Ordered by dependency, then surface size.

### Track 1 — `cb view check`: the verification primitive

- **What.** A command that renders *every* view in a box and exits non-zero if
  any fails. Both the migration's done-gate and its broken-view detector.
- **Why.** Only per-slug `cb view test` exists (`view.ts:121-193`); a gate needs
  one deterministic whole-box check.
- **Direction.** `cb view check [--json]`: `listViews` → render each via the
  `cb view test` Node path with its own `loadViewCards` deps → exit 0 only if all
  render and no dependency cards `skipped` (reuse `view.ts:181-188`). `--json`
  emits `{ok, views:[{slug, ok, error?}]}` for the procedure's `validate.shells`
  and the agent to consume.
- **Not a thin wrapper (Codex #6).** `cb view test` renders **in-process and can
  hang** on pathological view code, renders **once synchronously** (no effects /
  async helpers), and `--path` sets a single `params.path` (`view.ts:11-23,
  134-146`). So `cb view check` must: (a) render each view in a subprocess with a
  **per-view timeout** (a hanging view fails, doesn't wedge the migration); (b)
  adopt an explicit **`params.path` sampling policy** for card-bound views (e.g.
  once per candidate path its deps select, not just the default) so it doesn't
  pass unexercised branches. These are the real work in Track 1.
- **First chunk.** `checkViews()` core fn (subprocess + timeout) + CLI + a
  doctest seeding a good view, a broken view, and a hanging view, asserting exit +
  JSON. The `params.path` sampling policy (Open q4) and render isolation (q5) are
  the design decisions inside it.

### Track 2 — procedure checklists (general capability)

- **What.** A *checklist* convention for procedures: a markdown `[ ]`/`[x]`
  working file the agent edits in place during the `run` phase, with two cheap,
  deterministic things gating completion — both **shell** checks (the only gate
  the engine actually enforces). Opt-in, general; migrations are the first user.
- **Two gates, both shells, no model.** The earlier draft leaned on
  `validate.instructions` (model judgment) and `severity:review` (retry) — Codex
  proved both are unimplemented (pass-by-default / downgrade-to-warn; see What
  already exists). So v1 uses only `validate.shells` + `severity: abort`, the one
  real gate, with **two** commands:
  1. **Domain check** — the migration's own machine check (views →
     `cb view check`). Proves the work is *correct* in the checkable sense.
  2. **Completeness check** — `! grep -q '\[ \]' <checklist>` (no unchecked
     boxes left). Proves the agent *worked every item*. Deterministic, free, no
     model. An agent that gives up partway leaves `[ ]` boxes → this fails → the
     step fails → not applied.
- **What this does and doesn't guarantee.** Together the two shells enforce
  "every item checked *and* the views render." They do **not** verify a checked
  box is *truthful* (the agent could check an item it didn't really do) — that
  rests on **agent honesty + human diff review**, the accepted residual (the
  semantic model-judge that would harden this is deferred, see NOT in scope).
  This is the deliberate v1 tradeoff: cheap structural enforcement now, honest
  about its ceiling.
- **Why a checklist at all.** It forces decomposition (the tests-first rationale,
  `docs/testing.md`), externalizes the agent's pass so it's legible and
  revisitable (Nidus prior art), and the `[ ]`→`[x]` discipline gives the free
  completeness shell. No engine-tracked per-item state machine — the over-clever
  bit we cut.
- **Direction.**
  - The checklist items are **embedded in the procedure's `run.agents` prompt**
    (not a separate shipped template — `installProcedures` only ships
    `*.procedure.card`, `box-defaults.ts:47-54`, so a separate file would need
    new install logic). The prompt tells the agent to write a working
    `checklist.md` into the run dir, check boxes `[ ]`→`[x]` as it goes, annotate,
    reorder, and loop back if a later check fails — traversal is agent-controlled,
    including recursion within the run.
  - `validate.shells: ["cb view check", "! grep -q '\\[ \\]' <run-dir>/checklist.md"]`,
    `severity: abort`. Both must pass for the step to complete.
  - **Recovery is operator-driven, not auto-retry** (`severity:review` is a
    TODO): a failed validate → step `failed` → run `failed` → manifest NOT
    appended → operator re-runs `cb migrate`, the procedure's precheck skips
    already-green work, the agent resumes from the checklist's remaining `[ ]`.
  - Commit-with-changes is convention (the agent commits the checklist with its
    edits); procedures auto-commit per step regardless (`engine-step.ts:329-334`).
  - The working file is ephemeral: the agent maintains it through the run, the
    `validate` shells read it (the completeness `grep` runs *before* deletion),
    and on step completion the procedure **deletes it** — committed, so it lives
    only in git history afterward (the run's commits are the archive). Keeps the
    working tree clean; matches the "git history is the archive" philosophy.
- **First chunk (convention-first, no engine change).** Document the convention
  in `docs/procedure-implementation.md` — the `[ ]`/`[x]` working-file pattern,
  the embedded-in-prompt items, and the two-shell `validate` (domain check +
  `grep` completeness) — and land the knowledge audit. Exercised for real by
  Track 4. A first-class `checklist` step-field that *seeds* the working file is
  deferred (Open q1).

### Track 3 — procedure-backed migrations (the manifest seam)

- **What.** A migration registry entry whose action is running a procedure,
  recorded in `config/migrations.jsonl` on `completed`.
- **Why.** Procedures execute and validate; they don't track "applied once to
  this box, never again, in order." That's exactly what the migration ledger
  adds. The join is the whole point.
- **Direction.** `Migration` becomes a discriminated union (stable `name`
  preserved, `migrations.ts:2-9`):

  ```ts
  interface BaseMigration { readonly name: string; }
  interface ScriptMigration extends BaseMigration {
    readonly kind: "script";            // default; existing 28 entries
    readonly script: string;
  }
  interface ProcedureMigration extends BaseMigration {
    readonly kind: "procedure";
    readonly procedure: string;         // procedure definition name
  }
  type Migration = ScriptMigration | ProcedureMigration;
  ```

  - `cb migrate --apply`: for a pending `procedure` entry, run it via
    `startProcedure` (`engine.ts`); on run `status: completed`, append the
    manifest; on `failed`, halt the sweep (like script exit 1). Script entries
    dispatch exactly as today.
  - **The completion floor is the procedure's `validate` gate, not "the agent
    finished" (Codex #2).** An agent that errors mid-run does NOT fail the step
    (`engine-step.ts:251-253`); only a failing `validate.shells` + `severity:
    abort` marks the run `failed`. So `cb migrate` keys off the **run status**,
    and the run status is only trustworthy because Track 4's validate is two real
    shells (`cb view check` + completeness). A procedure-migration with a weak or
    missing `validate.shells` could falsely complete — so: **require a
    `validate.shells` + `abort` gate on any procedure used as a migration**
    (enforce in `cb migrate` when dispatching a `kind:"procedure"` entry; refuse
    to run one without it).
  - **Transaction / rollback model (Codex #4).** Procedures **auto-commit** per
    step (`engine-step.ts:329-334`); `cb migrate` appends the manifest *without*
    committing today (`migrate.ts:169-175`). So: `cb migrate` must **commit the
    manifest line** as the final, atomic "applied" marker. A crash after the
    procedure's commits but before the manifest commit leaves committed work with
    no manifest line → the next `cb migrate` re-runs the procedure, whose precheck
    (`cb view check` green) makes it a safe no-op → then appends. Rollback is **no
    longer the script one-liner**: a procedure migration made several commits, so
    rollback = `git reset --hard <pre-migration-sha>` (covers all of them) +
    remove the manifest line. Document this in `docs/migrations.md`.
  - **Idempotency** = ledger (applied entries skipped) + the procedure precheck
    (*"`cb view check` already green? skip"*), so a hand re-run is safe.
  - New boxes: seeded applied at init (`box.ts:62-84`), unchanged.
- **First chunk.** The `Migration` union + `kind:"script"` backfill +
  `cb migrate` dispatch refactor (no behavior change) + a doctest proving the
  existing script path is unchanged. (The `kind:"procedure"` branch — with the
  require-a-validate-gate check and the manifest commit — lands once Track 2
  exists.)

### Track 4 — `view-card-shape` (the first instance)

- **What.** Update a box's `views/*.tsx` from the old `ViewCard` shape to the
  new one.
- **Direction.**
  - **Mechanical part = codemod**, its own ordered `kind:"script"` migration
    *before* the procedure one: text/AST `card.tagName`→`card.type`,
    `card.status`→`card.frontmatter?.status` (safe 1:1).
  - **Semantic part = a `kind:"procedure"` migration** `view-card-shape` →
    a procedure that uses a checklist (Track 2). Checklist items, e.g.:
    1. `cb view check --json`; list failures (or confirm none → stop).
    2. For each removed-field use (`card.attrs`/`children`/`element`/`text`/
       `status`), port it to `frontmatter`/`body` and cite the change; confirm
       *ported, not deleted*.
    3. Where `children`/`element` (XML nesting) have no equivalent, describe how
       the data is re-derived from `frontmatter`/`body`, or flag the view.
    4. `cb view check` green; paste the result. Then check every box `[x]`.
    `validate.shells: ["cb view check", "! grep -q '\\[ \\]' <checklist>"]`,
    `severity: abort` — renders + all items worked. "Ported not deleted" (item 2)
    is enforced by agent honesty + human diff review, not a machine gate (v1).
- **First chunk.** The codemod migrator + the procedure definition + checklist
  template + the two registry entries. Depends on Tracks 1–3.

## Subplans

Track 2 (procedure checklists) is a general procedure feature with its own shape
decisions and could be split to `procedure-checklists.subplan.md` if its design
grows (e.g. the exact `checklist` field schema, multi-checklist steps, or making
the validate phase's file-awareness first-class). For now it's tractable inline
as a track; flag for split only if the field-shape question (Open q1) spawns
sub-questions. The deferred *automatic* trigger (running migrations in `cb
wakeup`) would warrant `migration-auto-trigger.subplan.md` when pursued.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A view reads a removed field in a branch the check doesn't exercise (needs a `params.path` or a card type absent from the box) → `cb view check` passes but it's broken in prod | No (renders default params) | Partial — `cb view check` renders each view against the widest card set its deps select, and per candidate `params.path` (Track 1) | **Silent** — gate green, breaks later |
| Agent satisfies a checklist item by checking it off + deleting the feature rather than porting it | No (no behavioral test) | Partial — `cb view check` still passes (it renders), and the completeness shell still passes (box is checked); only the per-migration diff + run-dir checklist (human review) catch it | **Review-catchable only** (no machine gate — the v1 residual) |
| Agent errors / gives up mid-run | Yes (completeness shell) | Yes — unchecked `[ ]` boxes remain → `! grep -q '\[ \]'` fails → step `failed` → manifest NOT appended. The agent-failure-doesn't-fail-step gap (`engine-step.ts:251-253`) is covered *because* the completeness shell is the real gate | Clear (no false done) |
| `cb view check` can't load a dependency card (pre-existing validation error) → migration can never go green | Yes (Track 1 `skipped`, `view.ts:181-188`) | Yes — `--allow-invalid-cards` distinguishes | Clear |
| A view hangs the renderer (pathological code) | Yes (Track 1 timeout test) | Yes — per-view subprocess timeout (Track 1) → that view fails, migration doesn't wedge | Clear |
| Procedure migration on a box with no/already-good views | Yes (Track 3 doctest) | Yes — precheck skips; both shells green → completes → manifest appended | Clear |
| Killed after the procedure's commits but before `cb migrate` commits the manifest line | Yes (Track 3B doctest) | Yes — re-run re-runs the procedure; precheck (`cb view check` green) → no-op → manifest committed (Track 3 transaction model) | Clear (resumable) |
| Agent burns turn/$ budget before green | Partial (`ProcedureAgent."max-turns"`, engine budgets) | Yes — boxes stay `[ ]` and/or `cb view check` fails → run `failed` → not appended → operator re-runs (no auto-retry; `severity:review` is a TODO) | Clear (operator-driven recovery) |
| Procedure used as a migration has no `validate.shells`+`abort` gate | Yes (Track 3B doctest) | Yes — `cb migrate` refuses to dispatch a `kind:"procedure"` entry without one (Track 3) | Clear |

**Critical gap:** *the two shells prove "renders + every box checked," not "each
checked box is truthful."* A view can pass `cb view check` while having silently
lost a feature, and the completeness shell only proves the box is checked, not
that the work behind it was real. This is the load-bearing risk of the whole
class — **verification under-specifies correctness** — and v1 deliberately does
NOT close it (the model-judge that would is unimplemented in the engine; see NOT
in scope). Mitigations in the plan: (a) the checklist item makes "port, don't
delete" an explicit obligation the agent attests to and the human verifies; (b)
`cb view check` renders against the widest card set + each candidate
`params.path` (Track 1); (c) the per-migration commit + run-dir checklist +
per-step `git-ref` go to human diff review during the operator-driven rollout
(`docs/migrations.md:125-138`). Accepted residual: a v1 agent migration
guarantees "renders + all items checked + a reviewable account," and rests on
**agent honesty + human review** for "semantically identical." Hardening it (a
real `validate.instructions` model judge) is the headline future item below.

## Agent-flow / user-flow edge cases

- **Wrong field** — agent maps `card.text`→`card.frontmatter.text` when it's
  `card.body`. **PARTIAL** — the checklist carries the explicit mapping; if the
  wrong mapping still renders, `cb view check` won't catch it (Critical-gap
  residual; human review). If it throws, `cb view check` catches it.
- **Stale ref** — N/A; views resolve cards live and the migration edits
  `views/*.tsx`, not refs. **ADDRESSED** (stated).
- **Two agents on one view** — a chat agent edits a view mid-migration.
  **DEFERRED** — operator-driven during a controlled window, not concurrent with
  live chat (NOT in scope: auto-trigger).
- **Hand-edit drift** — boxholder already fixed a view. **ADDRESSED** — `cb view
  check` shows it green; the agent leaves it; precheck/ledger make it idempotent.
- **Fabricated completion** — agent checks a box for work it didn't do.
  **PARTIAL** — the completeness shell only proves the box is checked, not that
  the work is real; `cb view check` catches it only if the result doesn't render.
  Truthfulness rests on agent honesty + human diff review (the Critical-gap
  residual). A real `validate.instructions` judge would tighten this (future).
- **Validation UX** — `cb view check --json` gives the agent slug+error+stack
  (Track 1), legible inside `validate`/the agent loop. **ADDRESSED.**
- **Partial / transition state** — after deploy, a box's views show the loud
  error boundary until its migration runs (the normal `cb migrate`-after-deploy
  window). **ADDRESSED** (loud, not silent).

## NOT in scope

- **Automatic migrations in `cb wakeup`.** First instance is operator-driven
  (`cb migrate --apply`, like May 2026). Auto-firing an agent every wakeup is a
  bigger budget/trust decision; follow-up once the kind is proven.
- **New rollback *tooling*.** Rollback stays manual but is no longer the script
  one-liner (procedures auto-commit several times): `git reset --hard
  <pre-migration-sha>` + remove the manifest line (documented in Track 3 /
  `docs/migrations.md`). No automated rollback command is built.
- **Implementing `validate.instructions` (model judge) + `severity:review`
  retry.** These are unimplemented in the procedure engine today
  (`engine-phase.ts:91-111`). v1 does NOT build them and does NOT rely on them.
  They are the **headline future hardening** — a real model judge is what would
  close the Critical gap, and it's a *general* procedure improvement (every
  procedure benefits), so it belongs as its own follow-up, not smuggled into
  this migration plan.
- **Structured per-step attestation** (`requiresFiles`/`filesInResolution`). Cut
  as over-clever; a possible future procedure-checklist extension only if review
  shows checked-but-false boxes slipping through.
- **Migrating non-view box content via agent.** The kind is general; the only
  instance now is `view-card-shape`. No second concrete need yet.
- **Behavioral-equivalence (snapshot) testing of migrated views.** Out of reach
  for arbitrary TSX without per-view goldens; the Critical-gap residual.
- **Forcing migrations through the procedure engine's every feature** (precheck
  retries, multi-step sequencing). A migration procedure is usually one
  agent-step + a validate gate; the engine's depth is available, not required.

## Open design questions

1. **Does the checklist need *any* engine support, or is it convention?** Since
   the final check is the existing `validate` phase, the minimal form is pure
   convention: the procedure ships a checklist template as a box file (via the
   existing template sync, `generate-docs.ts:405`), the `run.agents` prompt says
   "work this list, edit it in place," and `validate` judges the result — *zero*
   engine change. Lean: start there; first-class a `checklist` step-field (engine
   seeds a run-dir working file, exposes its path to run + validate) only if the
   convention proves fiddly in practice. If it does, that field-shape question is
   what would grow into the Track 2 subplan.
2. **Codemod as its own `kind:"script"` entry vs a checklist step.** Lean: own
   ordered script entry before the procedure, so the mechanical 80% is tracked +
   idempotent and the agent only sees the residual.
3. **Failure policy when a view genuinely can't be ported.** Lean: block-and-loud
   — the run stays `failed`, manifest unappended, surfaces every sweep; better a
   nagging box than a false "done."
4. **`cb view check` `params.path` sampling policy.** Card-bound views render
   differently per `params.path`; checking only the default passes unexercised
   branches (Critical gap). Options: default only (cheap, weak); once per
   candidate path the view's deps select (thorough, slower); a capped sample.
   Lean: once per candidate path, capped at N, log when capped — no silent
   truncation.
5. **Per-view render isolation.** Subprocess-per-view (clean, slower) vs. a
   worker pool with a hard timeout. Lean: subprocess + timeout for v1; optimize
   only if it's too slow on big boxes.

## Knowledge audits

One agent-facing concept worth auditing: **the checklist discipline** — when an
agent works a procedure checklist, it edits the working file as it goes, **checks
a box `[x]` only when that item is truly done** (the completeness shell trusts
this — honesty is the contract), grounds each in a concrete change (cite the
file), ports rather than deletes to pass a gate, and finishes only when the
validate gate (e.g. `cb view check`) is green. Default: one
`knows_directly` audit in `callback-box/src/dev/knowledge-audits.yaml`. This is a
*procedure* concept (general), not migration-specific, so it lands with Track 2.
The migration ledger + engine join is infrastructural (operators read
`docs/migrations.md`) and needs no audit. Lands **run** (`pnpm knowledge-audit
run --box <test-box> --filter procedure-checklist`) with status recorded before
the plan completes.

## Implementation order

1. **Track 1** — `cb view check` + doctest. Standalone.
2. **Track 3, chunk A** — `Migration` union + `kind:"script"` backfill +
   `cb migrate` dispatch refactor (no behavior change) + regression doctest.
3. **Track 2 (convention)** — document the checklist convention in
   `docs/procedure-implementation.md` + land the knowledge audit. No engine
   change for v1 (the working-file seed-helper is deferred, Open q1).
4. **Track 3, chunk B** — the `kind:"procedure"` branch in `cb migrate`
   (run procedure → append manifest on `completed`) + doctest with a stub
   procedure whose `validate` flips false→true.
5. **Track 4** — the `view-card-shape` codemod (own `kind:"script"` entry), the
   procedure definition + checklist template, the two registry entries.
6. Update `docs/migrations.md` (the new kind), `docs/procedure-implementation.md`
   (checklists), and the migration-authoring rules.

Dependencies: 1 ∥ (2 → 4-of-Track-3); (1, 2, 3B) → Track 4; Track 2 → audit.

## Rollout shape

- **Test posture** (tests-first, `docs/testing.md`):
  - Track 1: doctest — one good + one broken view → exit code + `--json`.
  - Track 3A: doctest — existing script migrations still run through the union
    (regression anchor; no behavior change).
  - Track 2: no new test for v1 (convention only); the existing
    `validate.shells` + `severity:abort` gate is already covered by
    procedure-engine tests, and the two-shell pattern (domain check +
    `grep` completeness) is exercised end-to-end by Track 4. A dedicated engine
    doctest lands only if the working-file seed-helper is built.
  - Track 3B: doctest — a `kind:"procedure"` migration appends the manifest only
    when the procedure completes; a failed procedure leaves it untouched.
  - Track 4: filesystem doctest (`makeTmpBox`) — old-shape views → the codemod
    rewrites the mechanical cases and `cb view check` reports the residual; the
    agent step is exercised end-to-end by hand on `~/src/boxes/test1`.
- **Knowledge-audit entry** lands with Track 2 (the convention it tests).
- **Migration approach.** The plan introduces the framework; the first data
  change (views) is applied by the procedure-backed migration it adds. Rollout
  per box mirrors the script runbook (`docs/migrations.md:125-138`): back up,
  `cb migrate --apply` (now also runs procedure kinds), review the per-migration
  commit + the run-dir checklist, commit. New boxes seed applied and do nothing;
  existing boxes with custom views get the agent pass in the controlled window,
  showing the loud error boundary until then.
</content>
