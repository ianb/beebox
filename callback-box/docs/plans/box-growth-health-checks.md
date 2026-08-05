# Box-growth health checks

**Status:** implemented and verified

This plan adds a low-cost, persisted measurement of box filesystem and Git
growth. It reports large or fast-growing boxes before they exhaust server
resources. The warning identifies the growing subtree and can be acknowledged;
acknowledgement accepts the current size and resets the growth baseline.

## Accepted-policy revision (2026-08-05)

The first implementation used one action for two different owner decisions.
The revised policy separates them:

- **Acknowledge this growth** means “I understand this observed change.” It
  moves the size and comparison baselines to the current measurement. It does
  not change any rate threshold.
- **Expect these rates** means “growth at the currently reported rates can
  continue.” It stores durable expectations for the rate findings that are
  visible now, with 50% headroom, and then acknowledges the observation.

The initial limits become deliberately sensitive: 1,000 directories, 10,000
files, 10 directories/hour, 25 files/hour, and 10 commits/hour. Connector
subtrees warn at 5 directories/hour or 10 files/hour. Occasional warnings are
an intended awareness mechanism, not a false-positive failure.

Acknowledged absolute size advances by geometric milestones. The next size
warning is the larger of the initial limit or twice the acknowledged count.
Durable rate expectations never suppress those size milestones. Thus an owner
can accept an expected continuous connector rate and still see the box cross
successive cumulative-size bands.

Each stored rate expectation is keyed by the exact finding kind and optional
subtree path. “Expect these rates” updates only the rate signals currently in
the warning. It does not change file limits, directory limits, unrelated
connector paths, or metrics that did not warn. A box-wide rate finding remains
box-wide; the action text and runbook state that scope explicitly.

> **Job to be done:** When an unattended import or other subsystem starts
> expanding my box, I want a warning that names the growing area before the box
> becomes unusable, so I can investigate, clean it up, or accept the new size.

The check reports only. It never deletes, moves, compresses, or rewrites box
content.

## Stated preferences this plan trades against

- Engineering principle 3, validate at boundaries. The persisted state is a
  disk boundary. `docs/engineering-principles.md:39-47` says: *"Disk reads,
  LLM output, HTTP bodies, third-party API responses, config files, and env vars
  each get validated into typed data exactly once, at the boundary, with loud,
  localized failure."*
- Engineering principle 4, resilient and never silent. A failed or stale scan
  must remain visible. `docs/engineering-principles.md:49-56` says: *"Degradation
  is allowed for failures that can genuinely happen; invisible degradation is
  not."*
- Engineering principle 10, testability is architectural. Measurement,
  evaluation, state transitions, and rendering need separate seams.
  `docs/engineering-principles.md:116-124` says: *"Seams — clock injection, fs/
  agent injection points, a pure decision core extracted from an IO shell — are
  built into production code deliberately."*
- `CLAUDE.md:105-107` says: *"Read before writing. Don't guess file formats,
  XML structures, or API shapes. Read the schema, read the existing code, read
  the test patterns."* This plan uses the existing health, scheduler, lock,
  atomic-write, and frontend patterns.
- `code-style.md:39-40` requires logs to carry enough context to debug the
  operation. Scan and state failures will name the box and state path.
- `code-style.md:50-51` says cross-process locks go through
  `src/lib/file-lock.ts` and same-process read-modify-write uses
  `withCardLock`. The scheduler and web server can update the same state, so the
  state updater composes both layers.
- The `unfiled-captures` health check is the closest accumulation precedent.
  `src/webapp/trpc/routers/health.ts:148-154` says the backlog is a warning and
  reuses the capture sweep's traversal code and threshold. It still runs that
  walk inside `runHealthChecks`; box growth does not copy that hosting choice
  because `cb health` and `/api/health` bypass the snapshot and a full box walk
  measured 0.55 seconds on the pathological box.

## What already exists

- The dashboard and CLI already share `runHealthChecks`.
  `src/webapp/trpc/routers/health.ts:230-236` says: *"Run all health checks for
  a box."* `src/cli/commands/health.ts:134-145` calls it and prints the result.
  The plan adds one warning to this existing result instead of adding a second
  health surface.
- `HealthCheck` already distinguishes warning from error.
  `src/webapp/trpc/routers/health.ts:29-34` defines `ok`, `message`, and
  `severity: "error" | "warning"`. Box growth remains warning severity and does
  not fail deploy health.
- `health.check` already uses a stale-while-revalidate process cache.
  `src/webapp/trpc/routers/health-snapshot.ts:16-23` says fresh callers bypass
  the cache and a hub restart clears it. The growth health reader is cheap, but
  acknowledgement must invalidate this cache so the dismissed warning
  disappears on the next query.
- The scheduler is a separate process that iterates every configured box.
  `src/core/schedule/scheduler.ts:118-123` says it reloads the box list each
  cycle, and `:166-196` validates each box and touches its heartbeat before
  calling `runTick`. The measurement runs after the heartbeat and before
  `runTick`, so a sick box cannot starve the check behind its own work.
- Machine-local state belongs under `.callback-box/`.
  `src/core/box/index.ts:179-184` puts `.callback-box/` and schedule state in the
  generated box `.gitignore`. The plan stores
  `.callback-box/box-growth-health.json` there.
- `writeFileAtomic` is the crash-safe state writer.
  `src/lib/atomic-write.ts:72-76` promises an atomic replacement and leaves the
  target unchanged on failure. The plan reuses it.
- `withFileLock` is the required cross-process serialization primitive.
  `src/lib/file-lock.ts:121-126` says it retries with a time budget, runs the
  callback under the lock, and fails loudly rather than running unserialized.
  The state updater composes `withCardLock(statePath, ...)` for same-process
  callers with `withFileLock(...)` for cross-process callers. The filesystem
  walk happens before lock acquisition. Track 1 extends `withFileLock` to
  accept its existing `LockTarget` union instead of only a string, so this
  short transition can use `requestScopedLock(lockPath)` without inventing a
  lock primitive.
- The existing Git vocabulary is broader than `Created-By`.
  `src/lib/git-trailers.ts:12-23` defines connector provenance as
  `Pulled-By`, `Created-By`, `Fetched-By`, `Pushed-By`, and `Sent-By`.
  `src/core/agent-guide/behavior.ts:15-21` also documents `Triggered-By`.
  The plan reuses these names and does not add subject-pattern parsing.
- The current dashboard component only renders health text.
  `src/frontend/src/components/dashboard/HealthWarnings.tsx:18-34` filters failed
  checks and maps each to a message. It gains one explicit action for the new
  check instead of a general-purpose dismissal system.
- Owner-only tRPC procedures already exist.
  `src/webapp/trpc/trpc.ts:21-30` gates them with `ctx.isOwner`. A growth
  acknowledgement changes machine-local state, so it uses `ownerProcedure`;
  the diagnostic-key-readable `health.check` remains read-only.

### Measured evidence (2026-08-05)

These read-only measurements were run against the deployed box fleet before
choosing thresholds:

| Box | Directories | Files | Commits | Git objects | Git KiB |
|---|---:|---:|---:|---:|---:|
| birch | 59 | 163 | 82 | 745 | 2,740 |
| ai-class | 80 | 286 | 218 | 1,810 | 13,524 |
| personal | 208 | 534 | 204,233 | 1,254,493 | 290,383 |
| estate | 803 | 4,845 | 136,107 | 868,825 | 162,502 |
| box-family | 69,062 | 139,138 | 2,478 | 244,465 | 97,719 |

`box-family/content/box/inbox/email` alone held 68,853 directories and
137,991 files. A full `find` traversal of its content tree took 0.55 seconds and
5,376 KiB maximum RSS. This is cheap enough hourly in the scheduler. It is not
appropriate on each dashboard request.

The implemented scanner was also run against a synthetic tree containing
100,001 regular files. Its own measured walk completed in 381 ms, retained 102
directory counts, and skipped no directories. The enclosing fixture-build plus
scan process completed in 7.71 seconds; its 441,860,096-byte maximum RSS includes
creating the 100,001-file fixture and therefore is not a scanner-only memory
measurement.

The last 2,000 `box-family` commits confirm the reported `Created-By` gap: only
32 commits (1.60%) have that one trailer. The broader existing provenance
channel is materially healthier: 1,244 commits (62.20%) have at least one of
`Created-By`, `Pulled-By`, or `Triggered-By`. In that sample, all 109
`Sync calendar:` commits have `Pulled-By: google-calendar-connector`, all 19
Gmail pull commits have `Pulled-By: gmail-connector`, all 35 Telegram commits
have `Pulled-By: telegram-webhook`, and all 665 template-sync commits have
`Triggered-By: generateDocs`. Therefore:

- `Created-By` alone is not an attribution channel.
- Existing connector provenance is useful corroborating evidence.
- Filesystem counts and subtree deltas remain authoritative because Git does
  not represent empty directories, ignored runtime content, or a stable walk
  taken while files are changing.
- No commit-subject fallback or trailer-coverage sweep belongs in this plan.

## Prior art (external)

- Node's `fsPromises.opendir(path, { recursive: true })` returns an async
  iterable and buffers 32 directory entries by default. The API is designed for
  iterative scanning and avoids materializing a whole-tree array:
  <https://nodejs.org/api/fs.html#fspromisesopendirpath-options>.
- Node documents that directory entries added or removed during iteration might
  not appear in that pass. The scanner therefore records a point-in-time sample,
  not a transactional filesystem snapshot; the next hourly sample repairs any
  transient miss:
  <https://nodejs.org/api/fs.html#dirsymbolasynciterator>.
- Git's `count-objects -v` reports loose objects, packed objects, pack count,
  pack size, and garbage. The history measurement parses the stable machine
  fields without `--human-readable`:
  <https://git-scm.com/docs/git-count-objects>.
- No external library is needed for threshold evaluation, persisted baseline
  transitions, or acknowledgement. Those are small project-specific pure
  functions.

## Tracks / scope

### Track 1 — measurement, state, and policy

**What.** Add `src/core/box-growth/`. Its `model.ts`, `scan.ts`, `policy.ts`, and
`health.ts` separate boundary validation, measurement, pure threshold policy,
state transitions, acknowledgement, and health-check formatting. State is stored at
`.callback-box/box-growth-health.json`; exclusion uses the sibling
`.callback-box/box-growth-health.lock`.

**Why this needs to change.** Current health probes can report broken
configuration and a stale capture backlog, but no durable component remembers
box size or compares two measurements. Rate cannot be derived without that
state.

**Direction.** The module uses these explicit shapes:

```ts
interface GrowthCounts {
  directories: number;
  files: number;
  commits: number;
  gitObjects: number;
  gitBytes: number;
}

interface SubtreeCounts {
  path: string;
  directories: number;
  files: number;
  source: "connector" | "chat" | "user-input" | "automation" | "unknown";
  sourceLabel: string | null;
}

interface GrowthMeasurement {
  measuredAt: string;
  gitHead: string | null;
  counts: GrowthCounts;
  largestSubtrees: SubtreeCounts[];
}

interface GrowthRateExpectation {
  kind: GrowthRateFindingKind;
  path: string | null;
  thresholdPerHour: number;
  setAt: string;
}

type BoxGrowthState =
  | {
      version: 1;
      status: "unmeasured";
      lastAttemptAt: string | null;
      lastError: string | null;
    }
  | {
      version: 1;
      status: "measured";
      accepted: GrowthMeasurement;
      previous: GrowthMeasurement;
      current: GrowthMeasurement;
      acknowledgedAt: string | null;
      lastAttemptAt: string;
      lastError: string | null;
      rateExpectations: GrowthRateExpectation[];
    };
```

The scanner counts files, symlink entries, and directories under the
operational box root. It counts a symlink as a file but never follows it. It excludes every `.git`,
`node_modules`, and `.callback-box` directory, including nested copies, from
filesystem totals because they are implementation state, not box content; Git
history is measured separately at the package root. If a queued directory
disappears during the live walk, the scanner continues and records the skipped
directory count rather than discarding the sample.
Rate evaluation requires two complete samples, so a partial live-tree sample
cannot make the following repaired count look like new growth.
It retains the 20 largest path prefixes, aggregated to at most three directory
segments, for actionable reporting without a state entry per directory.

Source labels are conservative path ownership, with Git provenance used only
as supporting text when available:

- `box/inbox/email` → connector, Gmail;
- `store/calendar` → connector, Google Calendar;
- `store/drive` → connector, Google Drive;
- `store/chat/*` → chat;
- `tmp-capture`, `tmp-upload`, and `captures` → user input;
- `procedure/runs` and generated/runtime areas → automation;
- all other paths → unknown.

The scanner also records `git rev-list --count HEAD`, `git count-objects -v`,
and `HEAD`. Git failure does not discard or degrade an otherwise healthy
filesystem measurement. The Git fields live in a discriminated
available/unavailable history result; unavailable history is appended to an
existing growth warning and is otherwise healthy diagnostic detail. The
implementation refines the sketched `GrowthCounts` into that union and never
encodes unavailable values as zero.

The initial policy uses exported constants and pure evaluation:

- absolute warning: more than 1,000 content directories or 10,000 content
  files;
- rate warning over a valid 30–120 minute sample interval: at least 10 new
  directories, 25 new files, or 10 new commits per hour;
- connector-owned subtree rate warning: at least 5 new directories or 10 new
  files per hour;
- after acknowledgement, the next absolute warning occurs at the larger of the
  initial threshold or 200% of the acknowledged count;
- “Expect these rates” raises only the currently visible rate thresholds to
  150% of their observed values and persists those expectations by finding kind
  and path;
- Commit count, Git object count, and Git bytes are reported in details, but no
  Git absolute count warns in v1. Fleet evidence shows healthy boxes with
  136,107 and 204,233 commits and far more objects and bytes than the failed
  box. Commit growth rate remains because the boxholder explicitly asked for
  history accumulation, but its initial threshold is calibration policy rather
  than a known failure wall.

On the first successful measurement, a box below all absolute thresholds is
accepted automatically. A box already above a threshold remains unacknowledged
and warns immediately. Acknowledgement sets `accepted`, `previous`, and
`current` to the latest measurement and stamps `acknowledgedAt`. That stops the
current warning and makes subsequent growth relative to the accepted normal.
It does not suppress growth after the click. If an intentional import continues
past another rate threshold, that is new growth and may warn again; the action
is a re-baseline, not a timed snooze.

If the tree changes during a scan, the result is a best-effort sample. A failed
walk does not replace the last good measurement. It updates `lastAttemptAt` and
`lastError` under the state lock, so both logs and health UI show the failure.
Unreadable or invalid persisted state is never overwritten automatically. An
in-process last-attempt map enforces the hourly backoff even when state is
missing or cannot be written, preventing a full-tree scan on every scheduler
cycle. A state file that disappears after this process measured the box creates
a visible replacement-baseline notice rather than silently adopting a new
normal.

**Vocabulary lock-ins.** The check name is `box-growth`. The persisted filename
is `box-growth-health.json`. The UI actions are “Acknowledge this growth” and
“Expect these rates.” “Acknowledge” re-baselines only the observation.
“Expect” changes only the visible rate thresholds and then acknowledges the
same observation.

**First implementation chunk.** Write a failing pure/filesystem doctest for
tree counting, exclusions, subtree aggregation, initial absolute warnings,
hourly rate warnings, connector weighting, corrupt state, scan failure, and
acknowledgement. Then implement the module and state store until that doctest
passes.

### Track 2 — scheduler ownership and health integration

**What.** Call `measureBoxGrowthIfDue(boxRoot, { now })` from the scheduler once
per hour per box. Read the persisted state from `runHealthChecks` and append a
`box-growth` warning when evaluation finds a problem or the last attempt failed.

**Why this needs to change.** A request-time scanner can be starved by the box
server whose health it is judging. The separate scheduler survives child-server
OOMs and already knows every configured box.

**Direction.** The scheduler calls the measurement immediately after
`touchSchedulerHeartbeat` and before `runTick`. This ordering is deliberate: a
box whose tick work is thrashing must still be measured. The scan has a
10-second wall-clock budget checked during iteration. It aborts rather than
holding the scheduler's serial box loop indefinitely. The helper reads the
state's `lastAttemptAt` and returns without scanning inside the one-hour
interval. Its try/catch is separate from the existing `runTick` try/catch. Scan
failure is written as a `box-growth-scan` scheduler log entry and does not stop
scheduled work. Successful scans are silent unless they create a new warning;
routine success adds no scheduler log noise.

`runHealthChecks` performs no tree walk or Git subprocess. It reads and
validates the state, then reads the existing scheduler heartbeat. Missing state
plus heartbeat status `never` is a passing check whose message says monitoring
has never run; local boxes without a scheduler are normal. Missing state with a
`running` or `stale` heartbeat is a warning because a scheduler that should
measure the box did not publish state. An explicit `unmeasured` state or stale
last attempt (more than 26 hours on a box that was measured before) is also a
warning. This matches the distinction at
`src/core/schedule/health-box.ts:7-13` without making absence silently healthy
on an active scheduler.

The scheduler manifest contract is verified, not assumed:
`src/core/box/boxes-config.ts:23-25` defines its entries as absolute box roots,
and `src/core/schedule/scheduler.ts:169-171` rejects a path without the box's
`.cb-box` marker. The scheduler and web server therefore address the same
operational root. `getBoxShape(boxRoot).packageRoot` is used only for Git.

The health response gains an optional action list containing
`"acknowledge-box-growth"` and, when rate findings exist,
`"expect-box-growth-rates"`. Only a failing `box-growth` warning can carry
these actions. `cb health` continues to print the message and exits nonzero
only for error severity, preserving `src/cli/commands/health.ts:148-150`.

**First implementation chunk.** Add scheduler and health doctest cases before
wiring the call sites. Verify that a due scan runs before an injected failing
tick, an in-window scan is skipped, a scan failure is logged without suppressing
the tick, and `runHealthChecks` only reads state.

### Track 3 — owner acknowledgement, rate expectation, and dashboard controls

**What.** Add owner-only acknowledgement and rate-expectation mutations and
render two explicit controls beside the growth warning.

**Why this needs to change.** Intentional bulk work should create a warning, but
acknowledging one event is not permission to hide the same ongoing rate. The
owner must choose whether they accept only what happened or also expect the
reported rates to continue.

**Direction.** Neither mutation takes a client-provided measurement or rate.
Under the same same-process plus request-scoped state locks as the scheduler
writer, each reloads the latest state and requires `status: "measured"`.
Acknowledgement promotes `current` to the accepted baseline without changing
rate expectations. Rate expectation first evaluates the latest state, updates
only its current rate findings with 50% headroom, and then performs the same
acknowledgement. After either mutation succeeds, the frontend uses the shared
`trpcClient` to query `health.check({ fresh: true })`, then writes that returned
report into the ordinary no-input `health.check` query cache. The fresh path
deliberately does not join an older in-flight refresh
(`health-snapshot.ts:125-132`). The component uses the existing `Button`
primitive with `intent="secondary"` and `size="sm"`. While pending, the action
is disabled and shows its loading label. A mutation or refresh error stays
inline under the warning and is announced as text; it is not swallowed.

The generic component renders acknowledgement when the backend exposes a growth
action. It renders rate expectation only when at least one rate finding exists.
Both require `useCurrentUser` to identify the viewer as the owner. This keeps
non-owners from seeing controls the owner procedures reject. Keyboard operation
and authorization come from real buttons and `ownerProcedure`.

**First implementation chunk.** Add the owner-gated route doctest and cache
invalidation test. Then add the dashboard action and verify it in the browser at
`http://localhost:3210/growth-health-checks/test1/` in desktop and 375-pixel
viewports.

### Track 4 — reference documentation and operational calibration

**What.** Extend `docs/health-checks.md` and `docs/box-layout.md` with the scan
host, state file, thresholds, acknowledgement semantics, state-failure behavior,
and a runbook for inspecting the named subtree. Record the production
calibration above as design evidence, not a promise that the numbers never need
adjustment.

**Why this needs to change.** New infrastructure is not complete until its
runtime host and recovery path are discoverable. A future operator must know
that accepting a size is not cleanup and that deleting the state file is not the
normal dismissal path.

**Direction.** The runbook says:

1. inspect the reported subtree and recent Git provenance;
2. decide whether the growth is intended;
3. fix or bound the producer when unintended;
4. acknowledge the observed change, or explicitly expect the reported rates
   when they represent an ongoing normal;
5. never delete content automatically as part of health handling.

**First implementation chunk.** Update both reference documents in the same
commit as the final behavior and add links from the module comments.

## Failure modes

> **Critical gap resolved by Track 1:** a failed scan must not leave a stale
> healthy result with no indication. The state records `lastError`, the
> scheduler logs it, and the health reader warns.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| The tree mutates during iteration | Nested-exclusion and deadline filesystem doctests; live deletion behavior is code-reviewed | Best-effort snapshot; vanished queued directories increment `skippedDirectories`; next hourly pass repairs it | Clear in state/docs; no false transactional claim |
| A directory becomes unreadable or disappears | Deadline failure is tested; ENOENT/ENOTDIR continuation is code-reviewed | Continue past vanished directories; other read failures keep the last good measurement and store an attempt error | Clear measurement detail or warning + scheduler error |
| Git commands fail while filesystem scan succeeds | Healthy unavailable-history state is covered in the core doctest | Persist filesystem result with typed unavailable history | Healthy diagnostic detail; appended to a real growth warning |
| State JSON is malformed or from an unknown version | Core doctest covers corrupt JSON and repeated due attempts | Zod rejects and leaves the invalid file untouched | Clear warning; no rescan hot loop |
| State is missing or cannot be written after an attempt | Core doctest removes state after a measurement and forces another due call | In-process attempt time preserves hourly backoff; replacement baseline carries a notice | Clear warning; no 60-second scan loop |
| Scheduler dies after a good measurement | New pure stale-state test | A last attempt older than 26 hours warns | Clear |
| Local box never runs a scheduler | New no-state test | Passing check says monitoring never ran; active/stale heartbeat without state warns | Clear; matches scheduler-heartbeat precedent |
| Scheduler writer and acknowledgement race | New filesystem concurrency doctest | `withCardLock` plus request-scoped `withFileLock`; walk is outside both | Clear on lock failure |
| Acknowledgement lands while health snapshot is cached | Extend health-snapshot doctest | Frontend explicitly queries with `fresh: true` and stores the result in the normal query cache | Clear immediately after refresh |
| Non-owner calls acknowledgement | New route doctest | `ownerProcedure` returns forbidden | Clear HTTP/tRPC error |
| User accepts a pathological size by mistake | Browser interaction + pure transition test | No deletion; new baseline is visible in state and future growth re-warns | Clear, reversible by removing state only through documented operator recovery |
| A known connector writes outside its mapped subtree | Pure attribution test covers known mappings; unknown remains possible | Report path as unknown and include recent Git provenance when available | Clear as unknown, not falsely attributed |
| A source has no trailers | Production evidence documents this case | Filesystem subtree delta remains authoritative | Clear as unknown/path-owned |
| A symlink points outside or cycles into the box | New filesystem doctest | Scanner counts the symlink as a non-regular entry and never follows it | Clear and bounded |
| A massive directory has millions of direct children | Real scanner benchmark covered 100,001 files; core doctest covers the deadline | Async iteration, top-20 retention, counters only, and 10-second budget | Clear timeout; later boxes still tick |

## Agent-flow / user-flow edge cases

- **Wrong action:** ADDRESSED. The backend exposes acknowledgement for a
  current growth observation and rate expectation only for current rate
  findings. Neither mutation accepts a path, count, or threshold supplied by
  the client.
- **Stale warning:** ADDRESSED. The mutation reloads `current` under the lock;
  it never acknowledges the measurement embedded in a stale browser response.
- **Two agents or browser tabs acknowledge together:** ADDRESSED. The shared
  `withCardLock` plus request-scoped file lock serializes both transitions. The
  second transition is idempotent at the same current measurement.
- **Hand-edit drift:** ADDRESSED. State is machine-local and Zod-validated. A
  malformed manual edit becomes a warning; it is never accepted as counts.
- **Fabricated free-form value:** ADDRESSED. No free-form value enters the
  acknowledgement. All counts come from the scanner.
- **Validation error UX:** ADDRESSED. Owner/precondition/state errors render
  inline below the warning and remain in the browser debug log.
- **Partial rollout:** ADDRESSED. Old boxes have no state and remain quiet until
  the scheduler's first scan. New servers can read only version 1. Unknown
  versions fail visibly.
- **Warning resolves without dismissal:** ADDRESSED. A later healthy measurement
  clears the warning naturally; acknowledgement is optional.

## NOT in scope

- Automatic pruning, archiving, compression, or deletion. The warning reports;
  an operator or agent decides remediation.
- Changes to `src/core/box/file-watcher.ts`. The `watcher-scale-bound` worktree
  owns its watch ceiling and one-time threshold log.
- Gmail connector volume limits or storage changes. The `email-volume-limits`
  worktree owns those controls.
- A general health-warning dismissal framework. Only box growth needs a
  persisted accepted baseline today.
- Per-box threshold configuration. Acknowledgement handles legitimate large
  boxes without adding configuration vocabulary. Revisit only with evidence
  that one set of rate thresholds repeatedly misclassifies real boxes.
- Commit-subject heuristics. Existing `Pulled-By` and `Triggered-By` coverage is
  sufficient for corroboration; paths remain authoritative.
- A trailer-coverage retrofit across commit sites. The broader provenance
  vocabulary already covers the measured high-volume automated commits.
- Git object-byte or object-count warning thresholds. They are recorded for
  diagnosis, but fleet measurements do not support a useful absolute limit.
- Absolute commit-count warnings. Two healthy deployed boxes already exceed
  100,000 commits, so commit history is rate-only in v1.
- Proactive push or Telegram notification. V1 surfaces a persistent dashboard
  and `cb health` warning. Notification can reuse the scheduler's alert
  infrastructure later if dashboard-only discovery proves too weak.
- Exact filesystem transaction semantics. A scan is a sample, not a freeze.

## Open design questions

There are no open questions inside the first implementation chunks.

One post-rollout calibration question remains: do the rate thresholds generate
useful warnings across intentional scan and bulk-upload batches? The plan ships
with explicit constants and measurement evidence. Change them only from
observed warnings, not speculation.

## Cross-model plan review disposition

Claude Opus reviewed the plan on 2026-08-05 after Claude Fable was unavailable
because of account quota. The review produced eight findings.

- **Accepted:** remove the absolute commit threshold. It contradicted the fleet
  evidence and would warn two healthy boxes on rollout.
- **Accepted:** add a scan deadline and an isolated scheduler try/catch. The
  scheduler loops over boxes serially, so an unbounded scan can starve later
  boxes.
- **Accepted:** compose same-process and cross-process locks, and extend
  `withFileLock` to accept `LockTarget`. The original plan claimed a
  request-scoped `withFileLock` shape that does not exist yet.
- **Accepted:** return a report computed with `fresh: true` after
  acknowledgement. Clearing the snapshot alone can join an older in-flight
  refresh and re-cache the warning.
- **Accepted:** distinguish a scheduler that never ran from an active/stale
  scheduler that failed to publish growth state. Missing state is no longer
  unconditionally silent.
- **Accepted:** correct the three inaccurate source citations and verify that
  scheduler manifest paths are operational box roots.
- **Clarified:** acknowledgement accepts only the current measurement. Continued
  growth after the click can warn again because it is a new episode, not the
  dismissed observation.
- **Declined:** cut rate detection, acknowledgement, and the dashboard action.
  Those are explicit boxholder requirements: absolute and rate catch different
  failures, and intentional growth must be dismissible and re-baselined. The
  plan narrows unsupported Git policy instead of removing the requested
  behavior.

## Cross-model implementation review disposition

Claude Opus reviewed the completed implementation diff on 2026-08-05. All
eight findings were addressed before final verification:

- Invalid state is left untouched, missing/unwritable state is protected by an
  in-process hourly attempt guard, and a replacement baseline produces a
  persistent owner-acknowledgeable notice.
- Live ENOENT/ENOTDIR churn no longer aborts a walk; skipped directories are
  recorded. Exclusions now apply at every depth.
- Git parse output is validated. Git unavailability no longer creates a
  standalone health warning, and scan failures are separated from persistence
  failures so the writer does not make a second lock attempt.
- Fixed connector roots are always retained ahead of generic top-N subtrees, so
  a newly created connector path has an unambiguous zero baseline and is named
  by the connector-weighted rate finding.
- Writes validate the state schema before atomic replacement.
- The real scanner completed the required 100,001-file synthetic benchmark in
  381 ms. The existing 10-second deadline still bounds the scheduler's serial
  work.

The review suggested a separate Git-command deadline. That becomes unnecessary
for health correctness once Git unavailability is healthy diagnostic detail;
the commands remain bounded by the scan's total 10-second budget rather than
extending scheduler latency beyond it.

A focused follow-up review of the hardened diff found five further gaps; each
was resolved before commit:

- Box-wide rate findings now always render alongside connector findings, so a
  smaller connector delta cannot hide a larger unrelated producer.
- A newly retained non-connector subtree receives a conservative lower-bound
  delta when its current count proves it would have appeared in the previous
  retained set; genuinely new paths are therefore actionable without treating
  ordinary top-20 churn as zero-based growth.
- Symlink entries count as files but are never followed.
- Box-shape lookup moved inside the Git-history failure boundary, preserving a
  successful filesystem measurement when only package/Git metadata is invalid.
- Partial scans suppress rate evaluation until two complete samples are
  available, avoiding a false growth warning when a transient omission repairs.

## Knowledge audits

No knowledge audit is needed. This feature adds operator-facing health behavior
and machine-local state. It does not add a card shape, command convention, or
rule that a box agent must recall without reading `cb health` and the runbook.

## Implementation order

1. **Measurement policy and state.** Add the failing
   `test/core/box-growth-health.doctest.md`, then implement
   `src/core/box-growth/health.ts` with scanner, pure evaluation, lock, atomic
   state transition, and acknowledgement.
2. **Scheduler and health reader.** Add scheduler/health doctest cases, then
   wire the hourly pre-tick measurement and the cheap persisted-state warning.
3. **Owner mutations and cache invalidation.** Add route and snapshot tests,
   then add `health.acknowledgeBoxGrowth`, `health.expectBoxGrowthRates`, and
   the cache-clear seam.
4. **Dashboard interaction.** Add both explicit action renderings, shared
   mutation error state, and query invalidation. Verify desktop, narrow
   viewport, keyboard, and browser console behavior.
5. **Reference docs and verification.** Update the runbook/layout docs. Run the
   focused doctests, full test suite, typecheck, ESLint, oxlint, and a production-
   sized synthetic scan benchmark. The boxholder explicitly waived another
   cross-model pass for this approved revision because Claude quota is low.

## Rollout shape

- Tests land before each substantial codepath. The primary new document is
  `test/core/box-growth-health.doctest.md`. Existing scheduler and health-
  snapshot doctests gain integration cases; route behavior uses a tRPC route
  doctest.
- The completed plan ships as one unit. On the first scheduler cycle, each box
  gets a state file. Boxes over an absolute threshold warn immediately; other
  boxes establish an accepted baseline silently.
- No committed box-data migration is needed. The state is gitignored,
  versioned, and created lazily.
- Verification gates:
  - focused box-growth, scheduler, route, and snapshot doctests pass;
  - `pnpm typecheck`, `pnpm lint`, and `pnpm lint:oxlint` pass;
  - full `pnpm test` passes;
  - a synthetic tree with at least 100,000 entries completes with bounded
    memory and produces the expected top-subtree report;
  - both dashboard actions work at desktop and 375-pixel widths with keyboard
    access and no new console errors;
  - no additional cross-model review runs, per the boxholder's explicit quota
    constraint; the earlier plan and implementation reviews remain recorded.
- The branch is committed but not merged or deployed until the boxholder asks.
