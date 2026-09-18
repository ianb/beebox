---
title: "Schedule alerts: priority decides delivery, one daily digest, conditions that close"
status: draft
workstream: schedule-alert-signal
issues:
  - ../../../issues/features/2026-09-18-schedule-alert-severity-and-presentation.md
  - ../../../issues/features/2026-09-18-schedule-alert-noise-daily-cadence.md
---
# Schedule alerts: priority decides delivery, one daily digest, conditions that close

When a schedule finds something, I want it to interrupt me only if it cannot
wait a day, and otherwise to wait for one daily look across all schedules, so I
deal with schedules once a day instead of continuously. Concrete situations:

- `sdk-update` pinned a new SDK version. I want to read that in tomorrow's
  digest, not dismiss a popup today.
- `full-suite` found red blamed on one landing. I want a popup now, because a
  person can act on it immediately.
- `box-convergence` has reported the same `needs-procedure` for three days. I
  want it counted once, and after a week I want it to become an issue instead
  of repeating.
- A deferred private issue became active. I want to see it clearly marked as a
  notification, with a link, not in the same form as a failure.

**Issues addressed:**
[severity and presentation](../../../issues/features/2026-09-18-schedule-alert-severity-and-presentation.md),
[daily cadence](../../../issues/features/2026-09-18-schedule-alert-noise-daily-cadence.md).
A queue search for `alert`, `notification` and `schedule` found no duplicates.
Related but separate: the deploy notification path (see *NOT in scope*).

## Decisions already made (boxholder, 2026-09-18)

- **One field.** Priority and severity are the same thing on an alert. The
  alert keeps `priority`. Each level is defined by what happens to the alert,
  and the popup matches the page presentation. Each schedule's prompt or run
  script says which priority each of its outcomes gets.
- **One digest across all schedules**, once a day.
- **A condition that persists for 7 days files an issue.**
- **The migration acknowledges every open alert.** Conditions that still hold
  raise again on their next run.

## Smallest fix and budget

**Smallest fix.** Only `important` alerts make a popup. Retune the `--priority`
choices in each schedule. Acknowledge the ~60 open alerts once. About 80 source
lines and 30 test lines. This removes most interruptions. It leaves no daily
look (normal and fyi alerts are never announced anywhere) and it does not stop
the graveyard from refilling (nothing clears).

**Chosen design.** Five tracks: A record and CLI, B digest and filing,
C page and popup, D schedule conversions, E docs. Estimate:

| Track | Source | Tests |
|---|---|---|
| A — record shape, `--condition`, `resolve`, migration | ~300 | ~250 |
| B — daily digest, fyi auto-close, 7-day filing | ~250 | ~200 |
| C — all-schedules alerts page, grouping, popup text | ~200 | ~100 |
| D — full-suite, box-convergence, deferred-issues, runner, prompts | ~250 (about half deletions) | ~100 |
| **Total** | **~1,000** | **~650** |

Authored docs about 150 lines (skill, `bin/CLAUDE.md`, prompts). No generated
output. The total is about 1,650–1,900 changed lines, under the 2,000-line
BIG CHANGE bar. If implementation passes 2,000, I report the revised estimate
before continuing.

What the fuller design buys over the smallest fix: the daily look the
boxholder asked for (B, C), and alerts that close when their condition clears
instead of piling up (A, D).

## Stated preferences this plan trades against

- **Minimize invented concepts** (memory `feedback_minimal_concepts_prefer_primitives`:
  "two tiers of anything is a smell"). This plan keeps one field, `priority`,
  and adds no second severity scale. It adds one new concept, the
  **condition key**. That concept replaces two existing private suppression
  mechanisms (`full-suite` `last-alert.json`, `box-convergence`
  `last-report.json`), so the count of concepts goes down.
- **Nothing retries forever** (memory `feedback_nothing_retries_forever`): "bound
  retries in time, then strand into a visible terminal state". A condition
  open for 7 days is filed as an issue (the alert records the `issue` path).
  A filing attempt that keeps failing stops 7 days after its first failure and
  stays visible in the digest with its reason.
- **Consolidate over blast-radius fear** (memory `feedback_consolidate_over_blast_radius`).
  Suppression moves from two schedules into the store. The schedules lose
  their private copies.
- **Real-box work: nothing public unvetted** (memory `feedback_box_work_nothing_public_unvetted`).
  Alert text contains box paths (`box-convergence` messages name each
  real box's directory). A filed condition therefore goes to
  `private-issues/`, never to the public queue.
- **Bias toward strict** (memory `feedback_bias_toward_strict`). The alert
  schema stays `strictObject`. Legacy records are rewritten once, not accepted
  forever.
- **CLI is not a user surface** (memory `feedback_cli_not_a_user_surface`). The
  daily look is the web page and one popup. `bin/schedules list` stays agent
  plumbing.
- **Precedent:** `full-suite` already files and commits issues from a schedule,
  path-scoped (`schedules/full-suite/red.ts:190`, *"for (const issue of
  rendered) await fs.writeFile(…)"*; commit at `red.ts:205` with
  `"--", ...paths`).

## What already exists

- **Alert record.** `bin/lib/schedules.ts:305` `alertSchema` (strict): `id,
  workstream, runId, title, message, details, priority, createdAt, state:
  open|acknowledged, acknowledgedAt`. Rebuild: fields added (Track A).
- **Priority scale.** `bin/lib/schedules.ts:302`:
  *`z.enum(["important", "normal", "backlog", "fyi"])`*. Reuse, with `backlog`
  removed.
- **Popup on every alert.** `bin/lib/schedules-alerts.ts:79`: `raiseAlert`
  always calls `deps.notify(...)` after `writeAlert`. The notifier is
  `alerter` with no timeout (closed issue
  `issues/closed/features/2026-08-25-schedule-alerts-desktop-notifications-are-not-sticky.md`:
  *"they intentionally have no timeout"*). This is the main source of
  interruption. Rebuild: notify only for `important`.
- **`done` carries no message.** `bin/lib/schedules-cli-report.ts:143` writes
  `{ kind: "done", alertId: null }` only. A session with a routine report must
  raise an alert. `sdk-update` has 10 open alerts, one per day ("Pin at
  0.3.273 …"). No change needed: an `fyi` alert becomes the routine report, and
  it no longer pops up.
- **The priority's only reader is the pill colour.**
  `workstreams-app/src/frontend/components/ScheduleAlerts.tsx:8`
  `priorityTones`. Nothing sorts, delivers, or closes by it.
- **Per-schedule alert list only.** `ScheduledWorkstreams.tsx:77` renders
  `<ScheduleAlerts name={row.name} />` per schedule. Route
  `/alerts/$name` (`workstreams-app/src/frontend/router.tsx:31`). The server
  already reads every schedule when `workstream` is null
  (`workstreams-app/src/server/schedules-command.ts:123`,
  *`["alerts", "--json"]`*). Reuse that path; the page, route and tRPC input
  are new (Track C).
- **full-suite suppression.** `schedules/full-suite/trust.ts:144`
  `alertFingerprint` = kind plus sorted files; `reporting.ts:alertOnce` with
  `last-alert.json`; 24 h window (`trust.ts:139` `ALERT_REPEAT_MS`). Replace
  with `--condition` keys that name the stable condition (Track D); the file
  set moves into the message only.
- **box-convergence suppression.** `schedules/box-convergence/results.ts:79`
  compares the whole message: *`opts.old?.message === message`*. Prod
  reachability lines join and leave the message, so the same condition
  re-alerts: 10 open alerts, all `needs-procedure` on the same boxes. Replace
  with fixed condition keys (Track D).
- **Tick latch for invalid schedules.** `bin/lib/schedules-tick.ts:30`
  `INVALID_SCHEDULE_ALERT_TITLE`: raises only when no open alert with that
  title exists. Replace the title latch with condition `invalid-schedule`.
- **Store IO.** `bin/lib/schedules-store.ts:91` `readJson` throws
  `InvalidStoreRecordError` on a schema mismatch. `writeJson` is atomic
  (`:106`). `visibleAlerts` shows acknowledged records for 14 days (`:279`
  `ACK_FADE_MS`). Reuse all of it.
- **Tick heartbeat.** `storeStateSchema` (`schedules.ts:289`) with defaulted
  nullable fields for backward reading (`lastTickSkippedAt: …default(null)`).
  The digest stamp follows the same pattern.
- **Private issue filing.** `schedules/deferred-issues/run.ts:32` runs private
  writes through `bin/private-issues with-lock`. Reuse for filing.

Store on 2026-09-18 (`~/src/schedule-runs`): 60–72 open alerts, depending on
the hour (new records arrive while this is written). full-suite 37 open
across about 18 titles; box-convergence 10; sdk-update 10; others 1–3 each.
No `backlog` alerts exist.

## Prior art (external)

No design decision depends on an external premise. Digest-plus-escalation is
the ordinary pager model: page for the urgent class, batch the rest. No search
was needed to choose it.

## Tracks / scope

### Track A — record shape, conditions, migration

**What.** The alert record learns about repeated conditions, and the store
resolves and ages them.

**Why.** Nothing clears (60 open). Each schedule reinvents suppression, and
box-convergence's copy flaps.

**Direction.** New `alertSchema` (strict):

```ts
{
  id, workstream, runId, title, message, details, createdAt,
  priority: "important" | "normal" | "fyi",
  /** Unchanged enum, so the running router's reader keeps parsing. */
  state: "open" | "acknowledged",
  acknowledgedAt: string | null,
  /** Who closed it; null while open. */
  closedBy: "person" | "digest" | "schedule" | null,
  /** Schedule-chosen key; null = a one-off alert. */
  condition: string | null,
  /** Last time the condition was reported; = createdAt for a one-off. */
  lastSeenAt: string,
  /** Times reported while open, including the first. */
  occurrences: number,
  /** Digest that listed this alert; fyi closes at the next digest. */
  digestedAt: string | null,
  /** Repo-relative path once filed as an issue. Filed alerts stay open. */
  issue: string | null,
  /** First failed filing attempt and its reason; drives the 7-day bound. */
  filingFailedSince: string | null,
  filingError: string | null,
}
```

The `state` and `priority` enums add no values. Old readers that use
`z.object` (the router's `workstreams-app/src/shared/schedules.ts:17`, which
strips unknown keys) keep working across the landing without a restart. Old
`bin/` code in a stale worktree uses `strictObject` and fails loudly
(`InvalidStoreRecordError`, `schedules-store.ts:101`) until that worktree
merges `main`. That is accepted: `bin/schedules` there is agent plumbing, and
the error names the file.

CLI:

- `bin/schedules alert … --priority important|normal|fyi [--condition <key>]`.
  With a condition, if an open record for the same `workstream` and
  `condition` exists, update it: title, message, details, priority, runId,
  `lastSeenAt`, `occurrences + 1`. No new record. It pops up only when the
  update raises the priority to `important` from something lower. Otherwise
  create a record, as now.
- `bin/schedules resolve [--condition <key>]… [--except <key>]…`. Closes open
  conditioned alerts of this schedule with `closedBy: "schedule"`. No options:
  all of them. `--condition`: only those keys. `--except`: all but those.
  `resolve` is not a run result: the run still ends with `alert` or `done`.
  Under `SCHEDULE_DRY_RUN` it prints what it would close and writes nothing,
  like `alert` and `done`. `--condition` and `--except` repeat; the shared
  `flags()` helper keeps only the last value of a repeated flag
  (`schedules-cli-context.ts:60`), so `resolve` parses repeated values with
  a multi-value helper, tested with two `--except` keys.
  The usual pattern at the end of a successful run is
  `resolve --except <every key reported this run>`, so exactly the current
  conditions stay open. A run that fails before its report does not reach
  `resolve`, so a crash never clears conditions.
- `bin/schedules migrate-alerts`. Rewrites every legacy record in the new
  shape: `backlog`→`fyi`, new fields null or derived (`lastSeenAt: createdAt`,
  `occurrences: 1`), and every `open` record becomes `acknowledged` with
  `closedBy: "person"` at the migration time (the boxholder's decision).
  Idempotent. It reads records with its own `legacyAlertSchema` (the current
  shape), never the new strict `alertSchema`, because `readJson` throws on a
  mismatch (`schedules-store.ts:99`) and would stop the migration at the
  first legacy record. The tick runs it at start when a legacy record is
  present, under the tick lock.

**Vocabulary lock-ins.** `condition`, `resolve`, `closedBy`. The priority
levels `important | normal | fyi` with these meanings:

| Priority | Meaning (for a schedule author) | Delivery | Closes when |
|---|---|---|---|
| `important` | A person should act today. | Popup now. Listed in the digest. | Acknowledged, or resolved. |
| `normal` | Wrong or suspect, or a decision is waiting, but it can wait a day. | Digest only. | Acknowledged, resolved, or filed after 7 days (conditioned only). |
| `fyi` | It happened. No action. | Digest only. | Automatically, at the digest after the one that listed it. |

**First implementation chunk.** Schema change, `migrate-alerts`, and the
legacy fixture test. No open questions.

### Track B — daily digest, fyi auto-close, 7-day filing

**What.** Once a day the tick sends one popup summarising all schedules, closes
old fyi alerts, and files persistent conditions.

**Why.** The boxholder: *"I don't want to continuously deal with it, more like
once a day."*

**Direction.** In `tick`, right after the heartbeat stamp and migration and
**before** any schedule runs, `digestIfDue(deps)`. Schedules run serially
under the tick lock (`schedules-tick.ts:131`), and one can take hours
(`box-convergence` deadline, `schedules/box-convergence/run.ts:23`), so a
digest placed after them would arrive late. The digest reads and writes alert
records and sends one popup; it does no git work.

- **Due** when `lastDigestAt` is before today's `DIGEST_HOUR` (09:00 local)
  and now is at or after it. A laptop asleep at 09:00 sends it at the first
  tick after waking. `lastDigestAt` lives in its own store-root file
  `digest.json`, not in `state.json`: `storeStateSchema` is strict
  (`schedules.ts:290`), so a new key there would make old `bin/schedules list`
  fail, and `bin/workstreams` hides that failure as zero schedule rows
  (`bin/workstreams:668`). Old readers never open `digest.json`.
- **Contents**, one entry per alert, grouped the same way as the page:
  important, normal, fyi, filed since the last digest, resolved-but-issue-open.
  `alert-filing` runs after the digest in the same tick, so an issue filed
  today is reported in tomorrow's digest. Only alerts
  created or updated since the last digest, plus every open `important`.
- **Delivery.** One popup: `Schedules: 1 important · 3 normal · 6 fyi`,
  linking to the all-schedules page. No popup when every count is zero; the
  stamp is written anyway.
- **fyi auto-close.** An `fyi` alert with `digestedAt` set before this digest
  becomes `acknowledged` with `closedBy: "digest"`. So an fyi appears in
  exactly one digest. It then stays folded on the page for 14 days
  (`ACK_FADE_MS`), labelled "closed by the digest", not "acknowledged".
- **Filing is a schedule, not tick work.** A new schedule
  `schedules/alert-filing/` (cadence 1d, run-only) calls
  `bin/schedules file-standing`. That command selects open conditioned
  `normal` or `important` alerts with `createdAt` 7 days or more ago and no
  `issue`. For each, `bin/private-issues with-lock` writes
  `private-issues/bugs/<date>-schedule-<workstream>-<slug>.md` (schedule,
  condition key, first and last seen, occurrences, latest message and
  details) and commits it path-scoped inside `private-issues/`. The alert
  stays open with `issue` set, and keeps absorbing repeats. Using a schedule
  reuses the runner's lock, timeout, and failure alerting, and keeps git work
  and `with-lock` waits (`bin/private-issues:104`) out of the tick.
- **Filing failure** (private-issues not mounted, lock or commit failed).
  `filingFailedSince` is set on the first failure and `filingError` on each.
  The next daily run retries. When `filingFailedSince` is 7 days old, it stops
  trying. The digest lists the alert as `could not file since <date>:
  <error>`. The alert stays open until a person acknowledges it.
- **Resolved with an issue.** An alert with `issue` set that a schedule
  resolves is listed once in the digest as `condition cleared; <issue> can be
  closed`. The issue is not closed automatically.

**Vocabulary lock-ins.** `digest.json` (`lastDigestAt`), `DIGEST_HOUR`, `file-standing`,
schedule `alert-filing`.

**First implementation chunk.** `digestPlan(alerts, now, lastDigestAt)` as a
pure function that returns the popup text, the records to acknowledge, and the
records to file. Tested with fixtures before it is wired into the tick.

### Track C — all-schedules page and popup text

**What.** One page lists every schedule's alerts grouped by priority. Popups
use the same words.

**Why.** Today alerts are visible only inside each schedule's row. The
boxholder: the notification should match the page presentation.

**Direction.**

- A new route `/alerts` (no name; the router's basepath is `/workstreams`,
  `router.tsx:60`) renders `ScheduleAlertList` over every schedule. The
  server's null-workstream path exists (`schedules-command.ts:123`), but the
  tRPC input, `ScheduleAlerts` (which requires `name`, `ScheduleAlerts.tsx:107`)
  and the route are new work. Each row shows its schedule name.
- Open alerts grouped in the order important, normal, fyi, with a heading per
  group. An alert with an `issue` shows the issue link. Closed alerts stay
  folded, as now, labelled by `closedBy`: "acknowledged", "closed by the
  digest", or "condition cleared".
- A conditioned row shows `seen N times since <first>`.
- Pill tones: important `danger`, normal `warning`, fyi `neutral`.
- The `important` popup title is `important · <schedule>: <title>`. It opens
  `/alerts?alert=<id>`. The digest popup opens `/alerts`.
- `/alerts/$name` stays as the per-schedule filter of the same list.

**First implementation chunk.** The grouped `ScheduleAlertList` with a
component test over fixture alerts of every state.

### Track D — schedule conversions and priorities

**What.** Each schedule uses conditions and picks priorities by the table in
Track A.

**Direction.**

Condition keys name a **stable condition**, not the current details. A key
that includes the changing details (a file list, a set of boxes) makes a new
condition every time the details change and leaves the old one open to age
into a filed issue. The details go in the message, which each repeat
overwrites.

- **full-suite.** Delete `alertOnce`, `last-alert.json`, and
  `ALERT_REPEAT_MS`. Keys: `red:<sorted culprit short shas, joined by +>` for
  red blamed on one or more landings (`fileIssues` handles several culprits,
  `red.ts:167`), so a new culprit set is a new condition and pops up, and the bare kind for the rest (`red-unattributed`, `timeout`,
  `environment`, `flakes`, `deferred`). Each run that reports ends with
  `resolve --except <its key>`; a green run resolves all. Priorities: red
  blamed on a landing → `important`; red with no attributable landing,
  timeout, environment failure → `normal`; flakes, under-load deferral, host
  still loaded → `fyi`.
- **box-convergence.** Two fixed keys: `unconverged` (the finding lines,
  prod reachability excluded) and `prod-unreachable` (only after a day, as
  now). The message is the current list, overwritten on each repeat. Delete
  `last-report.json` and `reportDecision`'s text comparison. Each run ends
  with `resolve --except <keys it reported>`. `needs-procedure` → `normal`.
- **deferred-issues.** `fyi`, or `normal` when any activated issue has
  `priority: important`. The message is a Markdown list with each issue
  linked by its path and labelled `public` or `private`.
- **Runner** (`schedules-workstream.ts`): "work waiting, session already live"
  → `fyi`. The rest stay `important`. Invalid-schedule latch → condition
  `invalid-schedule`, `resolve`d when the schedule loads again.
- **Agent prompts** (`sdk-update`, `manual-tests`, `knip-sweep`,
  `agent-docs-refresh`, `cross-box-leak-scan`, `supplemental-lint`,
  `smoke-review`, `tour-check`): replace the four-level list with the
  three-level table and name this schedule's own cases. For example
  `sdk-update`: a routine pin → `fyi`; a hold that waits for a decision →
  `normal`; a regression live on `main` → `important`.
- **Scripts with a fixed priority** (`docling-update`, `supplemental-lint`,
  `cross-box-leak-scan`, `knip-sweep`, `tour-check`, `agent-docs-refresh`
  `run.ts`): check each against the table. Change `backlog` wherever it
  appears.

### Track E — docs

- `bbx-authoring-schedules` SKILL.md: replace the priority paragraph (lines
  162–167) with the table; add `--condition`, `resolve`, and "the message is
  Markdown: lead with the finding, list items, link issues and files".
- `bin/CLAUDE.md` schedules section: the digest, `resolve`, `migrate-alerts`.

## Could this be simpler?

The simplest version is the smallest fix above: popups only for `important`,
retuned priorities, a one-off acknowledge. It fails three stated needs:

1. No daily look. `normal` and `fyi` alerts would never be announced; the
   boxholder asked for once a day, not never.
2. The list refills. box-convergence alone produced 10 open alerts in two days
   for one condition. Without conditions and `resolve`, the graveyard returns
   within a week, and a new item again does not stand out.
3. No terminal state. The boxholder chose "file an issue after 7 days", per
   *nothing retries forever*.

Simpler alternatives inside the fuller design, considered and rejected:

- **Implicit resolve by omission in the store** (the runner closes any
  condition a finished run did not report). Simpler for authors, but the
  runner cannot tell a run that checked and found nothing from one that
  skipped a check. Explicit `resolve --except` at the end of a successful
  report puts that decision with the schedule.
- **A digest record in the store.** Not needed. The digest is a view computed
  from the alerts plus one timestamp.

## Subplans

None. The one data-shape change is a single idempotent rewrite (Track A).

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A reader on old code (another worktree's `bin/schedules list`) meets a new-shape record | Existing: `readJson` throws | `InvalidStoreRecordError` (`schedules-store.ts:101`) | Clear; that worktree merges main |
| New code meets a legacy record before migration ran (web app reads between merge and first tick) | New test | Error message names `bin/schedules migrate-alerts`; tick migrates within 15 min | Clear |
| Two runs update the same conditioned alert at once | New test | Per-schedule run lock already serialises a schedule's runs (`schedules-runner.ts:219` `acquireLock`); conditions are per schedule | Clear |
| A condition key includes changing details, so stale keys age into filed issues | New test per converted schedule | Keys name the stable condition (Track D rule); `resolve --except` closes keys not reported this run | Clear |
| The digest runs before schedules, so it misses findings from that tick | — | They appear in the next digest; `important` ones pop up immediately anyway | Clear |
| A condition key changes format between versions of a schedule | — | The old record stops updating, is not resolved by `--condition`, is resolved by bare `resolve` on the next clean run, or is filed after 7 days | Clear (visible in digest) |
| The digest is never sent because the tick fails before it | Existing tick-failure notify | Tick failure already notifies (`notifyStoreFailure`) | Clear |
| An `important` alert for an event that does not need action today (wrong priority chosen) | — | Prompt tables name each schedule's cases; the digest shows counts, so over-use is visible | Clear |
| An `fyi` closes before the boxholder reads it | New test | Closed fyi remains on the page for 14 days (`ACK_FADE_MS`) | Clear |
| Filing writes private box paths to the public queue | New test | Filing writes only under `private-issues/`; unmounted → no filing | Clear |
| private-issues missing or commit fails | New test | `filingFailedSince` + `filingError`; daily retry for 7 days, then `could not file since <date>: <error>` in the digest | Clear |
| `alert-filing` run itself fails (crash, timeout) | Existing runner behaviour | Runner raises its own `important` alert, as for any schedule | Clear |
| `migrate-alerts` meets a legacy record through the new strict reader | New test (legacy fixture) | Migration uses `legacyAlertSchema` | Clear |
| `resolve --except a --except b` keeps only `b` | New test | Multi-value flag parsing | Clear |
| Laptop asleep for several days | New test | One digest at the first tick after 09:00 covers everything since the last digest | Clear |
| `resolve` with no conditions deletes a one-off alert | New test | Bare `resolve` touches only records with a non-null condition | Clear |

No critical gaps.

## Agent-flow / user-flow edge cases

- **Wrong priority.** ADDRESSED: each prompt names its own cases (Track D);
  the skill carries the table (Track E).
- **Wrong condition key** (too specific, so every run is new). ADDRESSED for
  converted schedules, which build keys in code (`alertFingerprint`; sorted
  finding lines). Agent-session schedules do not use `--condition` in this plan
  (see *NOT in scope*).
- **Stale ref.** A filed alert's issue is closed or moved by hand. ADDRESSED:
  the alert holds the path as text only; the page link 404s visibly. Nothing
  depends on it.
- **Two agents.** ADDRESSED: see Failure modes, run lock.
- **Hand-edit drift.** The boxholder does not edit store records; `ack` is the
  only human write, through the page. ADDRESSED.
- **Fabricated value.** Not applicable: priority is an enum, conditions are
  built in code.
- **Validation error UX.** ADDRESSED: `--priority backlog` fails with
  `--priority must be important|normal|fyi` (`UnknownPriorityError`,
  `schedules-cli-report.ts:28`), which names the valid values.
- **Partial migration.** ADDRESSED: migration is one idempotent rewrite per
  record, atomic per file; a partial run finishes on the next tick.

## NOT in scope

- **Deploy notifications** (`beebox/deploy/deploy.sh:57` `notify()`): these
  are direct desktop popups with no record, including a success popup on every
  landing. They have the same notification-versus-failure question. They are
  a separate process with no store. I file an issue for them.
- **`--condition` for agent-session schedules.** They report once per run with
  a different message each time. Conditions are for code-built keys. Revisit if
  a session schedule repeats itself.
- **Combining kinds into one alert per night for full-suite.** With `normal`
  and `fyi` digest-only, several kinds in one night cost nothing extra.
- **Automatic issue closing** when a filed condition clears. A person decides;
  the digest says it can be closed.
- **Configurable digest hour.** A constant until someone asks.
- **Re-notifying from the tick** (option 3 of the closed sticky-notification
  issue). No longer needed.
- **A separate severity field.** Decided against (see *Decisions*).

## Open design questions

None block the first chunk. One lean to confirm during review: `DIGEST_HOUR`
= 09:00 local.

## Knowledge audits

Skip. This changes dev-repo tooling. Box agents never see schedules, and the
skill is invisible to knowledge audits.

## What will hold this after it ships

- `bin/schedules-cli.test.ts` (node:test) for `alert --condition`, `resolve`,
  `migrate-alerts`, the priority refusal.
- Pure-function tests for `digestPlan` (due-ness, grouping, fyi close, 7-day
  filing, retry bound) with fixed `now`.
- `schedules/full-suite` and `schedules/box-convergence` existing unit tests,
  updated for condition keys (`convergence.test.ts:13` currently tests
  `reportDecision`).
- A component test for the grouped `ScheduleAlertList`.
- No new test tier.

## Implementation order

1. Track A: schema, `alert --condition`, `resolve`, `migrate-alerts`, tests.
2. Track B: `digestPlan` pure function and tests, then the tick wiring and
   private-issue filing.
3. Track C: page and popup text.
4. Track D: full-suite, box-convergence, deferred-issues, runner, prompts.
5. Track E: docs.
6. Cross-model review of the branch; adjudicate.

Each numbered item is one or a few commits in the worktree. The plan ships in
one piece through `/finish` when the boxholder asks.

## Implementation notes (2026-09-18)

Where the implementation went past or differed from the tracks above:

- **A failing `run` is a condition.** The runner raises it as `run-failed` and
  resolves it on the next run that does not fail, so three "run timed out"
  alerts become one record with a count.
- **`docling-update`** reports `newer-release` as a condition and resolves it
  once the pin catches up; before, it raised a new `normal` alert every day.
- **Priority retunes beyond Track D's list:** `smoke-review` and `tour-check`
  no longer use `important` (nothing a weekly review finds needs today);
  landed routine work in `knip-sweep`, `agent-docs-refresh`, and
  `supplemental-lint` is `fyi`; a branch waiting on a person is `normal`.
- **The definitions live once**, as `PRIORITY_GUIDE` beside `prioritySchema`
  in `bin/lib/schedules.ts`, and every session briefing includes it.
- **The tick runs `migrate-alerts` on every tick**, not only when a legacy
  record exists: it is an idempotent directory scan, and one call site is
  simpler than a detection step.
- **Leftover state files** `full-suite/last-alert.json` and
  `box-convergence/last-report.json` in the store are no longer read; delete
  them at landing.

## Rollout shape

Done when the tests in *What will hold this* pass, `bin/schedules lint` is
clean, and a dry run of each converted schedule prints the expected
`would alert (<priority>)` lines.

Migration: scripted and atomic per record. After the merge, the landing agent
runs `bin/schedules migrate-alerts` once and deletes the two leftover state
files named above. The tick also runs it at start if
any legacy record remains, so a forgotten step is repaired within 15 minutes.
Every open alert becomes acknowledged, per the boxholder's decision.
