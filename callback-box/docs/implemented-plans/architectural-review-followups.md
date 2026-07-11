# Architectural Review Follow-ups — Plan

**Status:** implemented 2026-07 — all eight tracks landed on
`worktree-architectural-review` and merged to `main`; full suite green (3484
pass at merge; one known flake filed as
[`issues/bugs/2026-07-09-flaky-child-output-log-doctest.md`](../../../issues/bugs/2026-07-09-flaky-child-output-log-doctest.md)).

Second round of the architectural review: implementing the follow-up issues
the first round filed (`issues/2026-07-0[56]-*.md`), under the same
principles (`../engineering-principles.md`) and the same execution model
(parallel subagents, per-track codex review, path-scoped commits).

Deviations from the plan, both deliberate and recorded in the closing
commits: `return-await` adopted in default `in-try-catch` mode rather than
`always` (the issue's measured 35-site fallout matched default mode;
`always` would have been an unscoped ~258-site churn), and the final
whole-round codex pass was replaced by per-track reviews plus orchestrator
self-review (codex hit its usage limit late in the round). Issues closed:
event-bus-read-side-schemas, chat-action-error-surfacing,
parallel-agent-git-commit-race, connector-transient-state-rmw,
git-commit-race-audit, phase2-deferred-boundaries, deferred-lint-rules
items 1-6 (two frontend tsconfig raises remain open there); open-decisions
item 1 (router) marked conservative-phase-done, full formalization still
open by boxholder intent; chat-session-shared-core narrowed to the
composition question.

## Boxholder decisions (2026-07-09)

| Decision | Answer |
|---|---|
| Deferred lint rules | Adopt all four: `jsx-a11y` (minus `no-autofocus`), `return-await` (routes excluded), `no-non-null-assertion` burn-down, `no-unnecessary-condition` burn-down. `strict-boolean-expressions` and `promise-function-async`: never (as recommended). |
| Router refactor | **Phased.** Conservative extraction now (Track 8); the full `WorktreeState` formalization stays open in `issues/decisions/2026-07-06-architectural-review-open-decisions.md` — do NOT close that item. |
| Thread-session SDK narrowing | **Converge** with ChatSession's adapter. Rationale: message-handling bugs have been confusing/hard to reproduce; make the flow explicit so problems surface (Track 6). |
| Frontend import boundary, clerk↔server contract, barrels, markdoc walkers, `.ts` as-ban | Not this round — stay parked in the open-decisions issue. |
| Event-bus durability | Persisted events are a reconnect bridge, not a source of truth — validate strictly against **current** shapes and drop cross-generation rows at startup (Track 3 design). |
| Engine-dev knowledge audits | Later — issue stays filed. |
| Chat action errors | In scope, done properly: generic toast mechanism (Track 5). |

## Tracks

### Track 1 — Connector transient-state locking
*(closes `issues/closed/bugs/2026-07-05-connector-transient-state-rmw.md`)*

Eight read→mutate→write spans on `config/connectors/<name>.state.json` run
unlocked; overlapping spans silently lose writes. All route through
`src/connectors/transient-state.ts` (`loadTransientState`/`saveTransientState`).

**Design:** add an RMW helper to `transient-state.ts`:

```ts
updateTransientState<T>(boxRoot, name, schema, fn: (state: T) => T | Promise<T>): Promise<T>
```

which serializes load→`fn`→save under `withCardLock` keyed on the **resolved
state-file path** (so `telegram.ts` and `telegram-outbound.ts`, both mutating
`telegram.state.json` from different modules, share one lock). `fn` receives
**freshly-loaded state** and returns the updated state — callers express
their change as a delta against whatever is current, never against a
snapshot they captured earlier. Sites convert to the helper — which
*removes* lines from the over-cap files rather than adding them; extract a
sibling state-IO module only if a file still lands over 300 lines.

**Cross-process pair:** `connectors/google-drive.ts` (server) and
`cli/commands/drive.ts` (CLI) write `google-drive.state.json` from different
processes; `withCardLock` is in-process-only. The helper must ALSO take the
cross-process lock (`src/lib/file-lock.ts`) around the RMW span — uniformly,
for every connector, not just drive (strict bias; the cost is one lockfile
touch per RMW, all on low-frequency paths). Two hard requirements (codex
findings, round-2 plan review):

- **The lock file is a SIBLING path** (`<state-file>.lock`), NEVER the state
  file itself — `acquireLock()` treats malformed lock-file content as a dead
  lock and **unlinks/overwrites it**; pointing it at the state file destroys
  real state on first contention. Precedent:
  `webapp/push-subscriptions.ts:123` (`${storePath()}.lock`).
- **Retry with backoff inside the helper**: `acquireLock()` throws
  `LockHeldError` immediately (no queueing). Copy the
  `push-subscriptions.ts:109-142` policy (~50 × 100ms) so contention is a
  wait, not a connector error.

**Two sites are NOT simple RMW spans** (codex findings 3-4) and need
restructuring, not wrapping:

- `telegram.ts` `processWebhookUpdate` (`:355-410`) does load → save →
  git-commit work → **second save reusing the same in-memory object**. Split
  into two independent `updateTransientState` calls, each expressing its
  change as a delta against fresh state (e.g. the second computes
  `lastUpdateId = max(current, thisUpdate)`), rather than one lock held
  across git commits.
- `google-drive.ts` `sync()` (`:117-199`) loads state once and threads the
  object by reference through the whole multi-await sync, saving at the end.
  Do NOT hold the lock for the whole sync (it would block the CLI for the
  full duration); instead, at each save point, delta-merge the sync's
  changes into freshly-loaded state inside `updateTransientState` (cursors
  take the newer value, per-file maps merge per key). Same for
  `cli/commands/drive.ts`. The implementing agent must enumerate exactly
  which fields merge how, and codex-review that merge.

Sites (from scoping): `connectors/telegram.ts:156/287/364`,
`connectors/telegram-outbound.ts:122`, `connectors/gmail.ts:279` (+
`saveTransient` at `:228`), `connectors/google-drive.ts:117`,
`connectors/google-calendar-state.ts:62` (transient side only — the
committed `google-calendar-state.json` half is Track 2's problem),
`cli/commands/drive.ts:170`.

### Track 2 — Git stage→commit race sweep
*(closes `issues/closed/bugs/2026-07-05-git-commit-race-audit.md` and
`issues/closed/bugs/2026-07-06-parallel-agent-git-commit-race.md`)*

`stageFiles` + `commit` are two non-atomic ops on one shared git index; a
concurrent mutation's staged files get co-committed under the wrong
attribution. 33 sites enumerated; ~31 are mechanical.

**Design:**
1. **Promote the model helper.** `webapp/trpc/routers/clerk.ts`'s `gitCommit`
   (fast-path `pathsHaveChanges` skip → `stageFiles` → `commitPaths` →
   swallow `isNothingToCommitError`) moves into `src/lib/git.ts` as
   `stageAndCommitPaths` (consolidate — clerk.ts converts to the promoted
   version; one definition).
2. **Sweep** of the ~31 drop-in sites — "drop-in" means the path list is
   already known before staging, NOT that this is a blind find-replace: each
   site gets a real read to preserve its existing fast-path/no-op semantics
   (e.g. `connectors/telegram-ingest.ts:69` stages a person card internally
   before its caller's stage+commit — idempotent over already-staged paths,
   but only if the caller's path list still includes it). Sites (full table in the scoping
   record, § Appendix): trpc routers (todos/scheduler/admin×2/calendar/drive),
   `core/commands/answer.ts`×2, `webapp/routes/telegram.ts`,
   `connectors/telegram.ts`×5, `telegram-outbound.ts`, `gmail.ts`×2,
   `gmail-gc.ts`, `google-drive.ts`, `output-cards.ts`, `core/finish-job.ts`,
   `notify-boxholder.ts`, `scan-import*.ts`×2, `create.ts`, `trash.ts`,
   `move.ts`, `capture-finalize.ts`, `cli/commands/drive.ts`,
   `wakeup-steps.ts`×3.
3. **`connectors/google-calendar.ts:202-220` rework (the one non-drop-in):**
   stages a whole *directory* then runs an unscoped `commit()` — the worst
   offender. Build an explicit changed-file list (created/updated/deleted/
   pushed, mirroring the other connectors) and use the helper.
4. **Telegram flow audit:** one logical webhook operation commits from three
   sites across two files (`connectors/telegram.ts:381,398` +
   `webapp/routes/telegram.ts:145`). Fix each mechanically AND leave a
   cross-referencing comment; consolidation of the flow itself is out of
   scope.
5. **Process fix for multi-agent runs:** document the path-scoped-commit
   convention (`git add <paths> && git commit -- <paths>`, never bare
   `git commit`) in `bin/CLAUDE.md`'s worktree section — that plus this
   track's code changes closes the parallel-agent issue.

Out of scope (documented, deliberate): cross-process commit *serialization*
(two processes committing the same paths back-to-back still relies on the
existing index-lock retry in `git.ts`); provisioning-time sites
(`init/migrate/upgrade`, scenario runner) where no concurrent mutator exists.

### Track 3 — Event-bus read-side validation
*(closes `issues/closed/code-quality/2026-07-06-event-bus-read-side-schemas.md`)*

The bus persists rows in SQLite (`.callback-box/events.db`) and replays up to
~24h on reconnect through a bare `JSON.parse` — rows written by *older code*
flow into current consumers unchecked.

**Durability design (boxholder question answered):** the bus is a realtime
notification stream with an existing resync belt (`onConnect` already
documents full-resync when gaps exceed retention). Persistence exists only to
bridge reconnects. Therefore:

1. **Generation stamping.** `event-bus.ts` gains a
   `EVENT_SCHEMA_GENERATION` integer constant, bumped whenever any event
   payload shape changes. Stored in a one-row meta table; on bus open, a
   mismatch **truncates the events table** (loudly — one log line), with the
   meta read + truncate + meta write in a single `db.transaction()` (all
   processes of one deploy share the constant, so a race converges anyway —
   the transaction just removes the ambiguity). Clients
   reconnecting across a deploy hit the existing resync path instead of
   replaying stale-shaped rows. This makes "everything persisted is valid
   against current schemas" an invariant instead of a hope.
2. **Per-event zod schemas** in a new `src/core/event-bus-schemas.ts`:
   13 events, `EventMap` derived via `z.infer` (schema = single source of
   truth). Three events currently hide real types behind `unknown` — type
   them properly: `chat-task.task` (`TaskEvent` from
   `core/chat/session/message-types.ts`), `schedule-fired.alarm/announce`
   (from `ChatSchedule`), `chat-history.entries` (session history entries).
   No `z.unknown()` rubber stamps.
3. **Read-boundary validation** in `parseRows`: safeParse per row, with the
   bare `JSON.parse` (`event-bus.ts:183`) ALSO brought under the same
   tolerance (a syntax-level parse failure currently throws before any
   schema runs); either failure logs + counts + yields an
   `{event: "unknown", …}` sentinel row (mirroring
   `unknownChatMessage` in `core/chat/session/messages.ts`) so one bad row
   degrades visibly without killing the batch — validation failures must not
   break dispatch of sibling rows in the same poll tick.
4. **Doctests:** per event, a valid-shape row round-trip; plus a hand-written
   bad-shape row proving the sentinel path; plus a generation-mismatch
   truncation test.

Emit-site audit is DONE (scoping): all 27 sites match their declared types;
schemas can be written as exact current shapes. Regression risk concentrates
in the tRPC `events.subscribe` generator (`webapp/trpc/routers/events.ts`) —
the single network chokepoint; frontend `useBusSubscription.ts` consumers
must see unchanged `data` for valid rows.

### Track 4 — Boundary completions
*(closes `issues/closed/code-quality/2026-07-06-phase2-deferred-boundaries.md`)*

- **Clock migrations (4).** Swap `new Date()` → `getBoxTime*(boxRoot)`:
  `core/preactions/transcribe.ts:72,127` (add `boxRoot` to
  `applyFrontmatterTranscription`'s input), `webapp/trpc/routers/todos.ts:33`
  (add `boxRoot` to `updateInItems` + its recursive self-call),
  `cli/commands/location.ts:33,57` + `webapp/trpc/routers/location.ts:24`
  (boxRoot already in scope), `core/box/index.ts:72,103` (in scope).
- **Drive inbound schemas.** `services/google-drive.ts` has 6 unchecked
  `.json<T>()` casts → `services/google-drive-schemas.ts` (~5-6 schemas)
  validated via the existing `validateResponse` pattern
  (`services/connector-response.ts`). The recursive
  `documentStructureSchema` (Google Docs body → structural elements →
  paragraph elements) is the one hard schema — use `z.lazy`, doctest it
  against a captured real response.
- **Telegram polling validation.** Chosen design: **move the schema down.**
  Relocate `telegramUpdateSchema`/`telegramMessageSchema` (+ canonical
  `TelegramUpdate`/`TelegramMessageObj` types) from
  `connectors/telegram-schemas.ts` into `services/telegram-schemas.ts`;
  `services/telegram.ts:98`'s `getUpdates()` validates via
  `validateResponse` instead of the bare `as TelegramUpdate[]` cast;
  `connectors/telegram-types.ts` imports the types instead of re-declaring
  them (killing the duplicate `TelegramUpdate` interface that exists in both
  layers today); the webhook route keeps validating, importing from the new
  location. services→connectors direction stays intact.

### Track 5 — Chat action-error surfacing (toast)
*(closes `issues/closed/bugs/2026-07-06-chat-action-error-surfacing.md`)*

Four user-initiated actions fail silently (console-only or fully swallowed):
`handleRestartProcess`, `handleLoadOlder`
(`InteractiveChat-actions.ts:121,142`), `handleCancelSchedule`
(`InteractiveChat-hooks.ts:257`), and the machine's own swallowed
`interruptChat(...).catch(() => {})` (`chatMachine.ts:283`). Two of the four
live *outside* the chat machine, so widening the machine's error context
can't cover them — build the small generic mechanism instead.

**Design:** a frontend toast primitive (none exists today):
- A module-level toast store (subscribe/notify, `useSyncExternalStore` on the
  React side) + one `<ToastViewport>` mounted at app root. No context
  provider gymnastics; callable from hooks, machine actions, and plain async
  code alike: `toastError(message, {cause?})`.
- Behavior: `role="alert"` / `aria-live="assertive"`, dismissible, auto-expire
  (errors ~10s), duplicate messages collapse into one toast with a counter,
  theme-aware styling consistent with `ChatStatusBanners`.
- Errors only for now — don't grow a success/info vocabulary speculatively.
- Wire the four sites (the swallowed interrupt catch becomes
  `toastError("Interrupt failed", …)` + `console.error` — never a bare
  swallow, per engineering principles). The stream-error banner
  (`context.error` → `ChatStatusBanners`) stays as-is — it's stateful
  (blocks resend) not transient, a different job.

### Track 6 — Chat SDK-adapter convergence
*(advances `issues/code-quality/2026-07-06-chat-session-shared-core.md`; the class
extraction itself stays status quo — see decision table)*

`ChatThreadSession`'s local `adaptSdkMessage` (`core/chat/session/thread.ts:109-161`)
is a copy-paste of the shared adapter (`messages.ts:189+`) minus the
`user`/`stream_event` cases. Boxholder decision: **converge** — delete the
local fork, use the shared adapter, and make the thread path handle the
**three** newly-visible message types *explicitly* — `user`, `stream_event`,
AND `task` (the shared adapter maps `system` subtypes
`task_started`/`task_progress`/`task_updated`/`task_notification` to
`type: "task"` messages; the thread-local fork's `system` case drops
everything but `init`, so task events silently start flowing on convergence
— codex finding 8) (even if handling = a deliberate,
commented, logged skip at the `handleMessage` level — the point is that the
narrowing becomes visible flow control in ONE place, not a silently divergent
adapter). Verify thread consumers (`<chat-response>` extraction,
`resolveTurn`) are unaffected by the extra message types; the lifecycle
doctest/scenario coverage must exercise a thread turn containing
`stream_event`s. Also fix the doc-drift: `docs/chat-session-lifecycle.md`
still cites pre-move `chat-session-*.ts` filenames.

The remaining extraction question (base class vs composition) is explicitly
NOT this round: after convergence, update the issue to record that
divergence 3 is resolved and the item now hinges only on whether the
genuinely one-sided queue/durability cluster justifies composition.

### Track 7 — Lint adoption (Phase 2 — after Tracks 1-6 land)
*(closes `issues/closed/code-quality/2026-07-06-deferred-lint-rules.md` decisions 1-4)*

Repo-wide sweeps; run AFTER the code tracks to avoid churn conflicts.

- **7a `return-await`** (`always`, `webapp/routes/**` excluded — forcing
  `await` on Fastify `return reply.send()` inside try/catch *introduces*
  double-send bugs). Preset change + ~6 real fixes.
- **7b `jsx-a11y`** recommended config minus `no-autofocus` (fights the
  deliberate composer autofocus). Plugin dep + preset wiring + ~14 genuine
  fixes. Frontend-only pass.
- **7c `no-non-null-assertion` burn-down** (199 sites). Rule lands at the END
  of the burn-down, not before. Conversion taxonomy: post-check `!` →
  `invariant()`; map-get-after-`has` → single `get` + `invariant`; genuinely
  unreachable → restructure so the type proves it. No blanket disables.
- **7d `no-unnecessary-condition` burn-down** (199 sites). Per-site triage:
  many hits are the rule fighting deliberate boundary `?? default`
  (permitted by code-style defensiveness rule 1). Where the rule is RIGHT,
  fix; where the defensive default is deliberate, restructure so the
  input is typed as possibly-absent (boundary types should ADMIT the
  uncertainty rather than disable the rule). Sites where neither works get
  the single-line justified-disable treatment — expected to be few; if the
  count balloons past ~20, STOP and bring the rule decision back to the
  boxholder rather than papering the codebase.

Lint-preset edits happen in `personal-vibe-check/` (in-monorepo); each rule
lands as its own commit (preset change + fixes together, so no intermediate
red state).

### Track 8 — Router conservative extraction
*(advances open-decisions item 1 — issue stays OPEN, marked "phased")*

- Extract the ~570-line embedded doc-browser + HTML views from
  `bin/router.ts` into sibling modules (`bin/router-docs.ts` or similar) —
  pure code motion, no behavior change, no state-machine work.
- Promote the four incident comments guarding the concurrency machinery into
  `bin/docs/router-protocol.md` (or a section in `bin/CLAUDE.md`), so the
  hard-won invariants survive future edits.
- Update `issues/decisions/2026-07-06-architectural-review-open-decisions.md` item 1:
  conservative phase done, full `WorktreeState` formalization remains open
  (boxholder wants to keep going in later phases).
- Constraint: the live router is shared across sessions — changes take
  effect only after main-merge + boxholder-initiated restart. Do not touch
  the running process; verify with the isolated-router test harness
  (`CALLBACK_STATE_DIR` + `ROUTER_PORT`).

## Execution

Same protocol as round 1, with the lessons baked in:

- **Path-scoped commits, always**: `git add <paths> && git commit -- <paths>`.
  Never a bare `git commit` (Track 2 exists because of this).
- **Codex review per track**: each implementation agent runs codex on its own
  diff FOREGROUND (`timeout 600000`), applies/dispositions findings, before
  its final commit.
- **Verification**: scoped `pnpm exec tsc`/eslint/tests per track; doctests
  for every new mechanism (Tracks 1, 3, 4, 5).
- Orchestrator (Fable) reviews each track's report + diff; final whole-round
  codex pass before merge.

### Phase 1 (parallel — disjoint file territories)

| Workstream | Tracks | Territory | Model |
|---|---|---|---|
| W-foundation (FIRST, blocks W-telegram/W-connectors/W-core) | T1 helper + T2 helper | `lib/git.ts`, `connectors/transient-state.ts`, clerk.ts conversion | Opus |
| W-telegram | T1+T2+T4c telegram sites | `connectors/telegram*.ts`, `webapp/routes/telegram.ts`, `services/telegram*.ts` | Opus |
| W-connectors | T1+T2 gmail/drive/calendar + T4b drive schemas | `connectors/{gmail,gmail-gc,google-drive,google-calendar*,output-cards}.ts`, `services/google-drive*.ts`, `cli/commands/drive.ts` | Opus |
| W-core-sweep | T2 mechanical sites + T4a clocks | core/cli/webapp non-connector sites | Sonnet |
| W-eventbus | T3 | `core/event-bus*.ts`, `webapp/trpc/routers/events.ts` | Opus |
| W-toast | T5 | frontend | Opus |
| W-adapter | T6 | `core/chat/session/` | Opus |
| W-router | T8 | `bin/` | Sonnet |

### Phase 2 (after Phase 1 commits)

7a and 7b in parallel (disjoint); then 7c and 7d as burn-downs (split by
subproject if parallelized, path-scoped commits).

### Phase 3

Full-suite verification, whole-round codex review, issue closings
(`git mv` to `issues/closed/` with `resolution:` frontmatter), update this
plan's status, merge via /finish.

## Failure modes to watch (carried from round 1)

- Agents idling at codex checkpoints → codex runs foreground with explicit
  timeout; orchestrator nudges stalled agents.
- Staged-file sweep between agents → path-scoped commits (mandatory).
- Transient per-edit lint reports mid-batch → judge only the post-batch state.
- Over-defensiveness: no new protection against impossible states —
  `invariant()` for genuine invariants, tolerance only at real boundaries.
- Track 3 specifically: a schema stricter than a real payload breaks live
  streams — schemas must be written from the emit-site audit, not from the
  declared types, and the sentinel path must be doctested before the
  validation is enabled.

## Appendix — scoping records

Full site tables live in the three scoping-agent reports (2026-07-09);
key figures: 8 transient-state RMW spans across 6 files; 33 stage→commit
sites (31 drop-in, 1 rework, 1 flow spread over 3 sites); 27 emit sites all
matching declared types; 6 unchecked Drive casts; 4 silent chat action
failures; thread adapter fork at `thread.ts:109-161`.
