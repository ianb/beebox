---
title: "A connector that keeps failing reaches a person"
status: draft
workstream: gmail-404-stuck
issues:
  - ../../../issues/bugs/2026-10-22-gmail-sync-stalls-on-deleted-message.md
---
# A connector that keeps failing reaches a person

The Gmail connector on two production boxes failed every sync for 13 days.
The box opened a `failing` episode one day in and showed a dashboard warning,
but nothing reached a person; the boxholder found out by noticing missing
mail. This plan makes a failing episode tell the boxholder once, and makes a
failing episode on a production box reach the developer's alert channel.

**Issues addressed:** `issues/bugs/2026-10-22-gmail-sync-stalls-on-deleted-message.md`
(the Gmail defect is fixed in the same workstream; this plan is its "smoother
in future" half). Searched the open queue for `connector-activity`,
`connector.*fail`, `prod.*health`, `notify`: the only related item is
`issues/features/2026-07-28-google-auth-expiry-health-and-notify.md`, which
covers a dead Google grant, not a connector that fails with a working grant.

## Design

### Situations

- When Priya's box has stopped bringing in her email because of a bug, I want
  to hear about it the day after it starts, so I can stop relying on the box
  for mail and tell the developer, rather than find out two weeks later from a
  missed message.
- When Gmail fails one sync at 3am and the next one works, I want to hear
  nothing, so the box does not teach me to ignore it.
- When Priya has already seen the warning and decided it is expected (she
  turned off a Google service on purpose), I want no further messages about
  it, so she is not nagged about a choice she made.
- When Google access itself has expired, I want the message to say to
  reconnect Google, so I do the one thing that fixes it. When access is fine,
  I want it not to say that, because reconnecting will not help. (On the
  production boxes, the boxholder reconnected Google and it changed nothing.)
- When I am the developer and a production box's connector has failed every
  sync for a day, I want it in my daily digest with the error, so I can fix
  the code before the boxholder notices.

### Right place, right time

| Situation | Act, show, or quiet | Surface | Attention |
|---|---|---|---|
| Connector failed every attempt on 2 run days | Show, once per episode | Notification (`quiet`), target the dashboard; dashboard warning stays | Interrupts once, then waits to be found |
| One failed sync, or a day with any success | Quiet | Nothing | None |
| Episode dismissed on the dashboard | Quiet | Nothing until a new episode | None |
| Google grant needs reauthorization | Show, once | Same notification, target Admin › Google Services, says reconnect | Interrupts once |
| Production connector failing or quiet | Show | `bin/schedules alert` condition, `normal` priority (daily digest) | Waits to be found; filed as a private issue after a week |

Why this moment: the `failing` verdict already needs every attempt on at
least 2 run days to have failed (`beebox/src/connector-activity/verdict.ts:14`:
*"**failing**: the latest run days, at least 2 of them, errored on every
attempt."*). A transient error cannot open it, because one success on a day
breaks the stretch. Earlier would alarm on outages that fix themselves; later
is the 13 days this incident took.

`quiet` loudness: not `loud`, because the person cannot fix a code bug
tonight; not `dot`, because a badge alone was effectively what the dashboard
warning was, and it was missed. `quiet` is not pushed while the person has the
app open (`beebox/src/core/notification/channels.ts:43`), where the dashboard
warning already shows.

Quiet episodes ("syncing but bringing in nothing") stay dashboard-only on the
box. That verdict is a statistical guess; the 2026-09-18 decision prefers
silence to a false alarm for it (`beebox/src/connector-activity/verdict.ts:6-8`).

### Spirit

- **Serves:** "You should be able to see the gears": the box says what
  stopped, since when, and where the error is.
- **Risks:** "It should feel possible": a box that pings about its own
  plumbing feels like a chore. Guard: one notice per episode, only for the
  strict `failing` verdict, and a dashboard dismiss that ends it.

### Trust

Shows only, takes no action. The dismiss already exists
(`beebox/src/webapp/trpc/routers/health/checks/connectors.ts:73`); a dismissed
episode is never notified again.

### When it goes wrong or does nothing

- The notification cannot be delivered (no device): the notification log
  records the skipped delivery, and the dashboard warning is unchanged.
- Several connectors start failing on the same pass (a dead Google grant
  breaks Gmail, Calendar and Drive at once): one notice names all of them.
- The activity record is damaged: no notice; the dashboard already reports the
  damaged record as its own check.

### Walkthrough

1. 2026-10-09: every Gmail sync fails with a 404. Each attempt is counted in
   `_bookkeeping/connectors/connector-activity.state.json` (`syncConnector`,
   `beebox/src/connector-activity/core.ts:189`).
2. 2026-10-10, first scheduler pass after the second failing run day:
   `updateConnectorEpisodes` finds a new `failing` episode for `gmail`, stamps
   `notifiedAt` (it does this today), and now also calls `notifyBoxholder`
   with title "Gmail has stopped syncing", body "Gmail has failed every sync
   since Oct 9, so nothing new has come in. The error is on the dashboard.",
   loudness `quiet`, target dashboard, tag `connector-failing`.
3. Priya's phone shows it (APNs delivers on both production boxes today; the
   notification log shows `apns sent` on 2026-10-21).
4. She opens the dashboard and sees the existing `connector-activity:gmail`
   warning with the error text.
5. Later passes see `notifiedAt` set and send nothing. When a sync succeeds,
   the episode closes; a later relapse is a new episode and a new notice.
6. Separately, the developer's hourly `box-convergence` run reads each
   production box's health and opens the `prod-connector-activity` condition,
   which appears in the next daily digest.

## Smallest fix and budget

**Smallest fix.** In `updateConnectorEpisodes`, call `notifyBoxholder` for each
new `failing` episode. About 30 source lines and 60 test lines. It reaches the
boxholder; it does not reach the developer, who is the one who can fix a code
bug.

**Chosen design.** Two tracks.

| Track | Source | Tests |
|---|---|---|
| A — failing episode notifies the boxholder once | ~70 | ~120 |
| B — production connector episodes reach `bin/schedules alert` | ~60 | ~60 |
| **Total** | **~130** | **~180** |

Authored docs about 30 lines (reference docs that say connector health never
notifies). No generated output. Well under the BIG CHANGE bar. What the fuller
design buys over the smallest fix: Track B, because the incident was a code
defect, and the boxholder can only report it; and the Google-target case,
because a "reconnect" hint when the grant is fine sends the person to the one
step that cannot help.

## Stated preferences this plan trades against

- **Health never notifies on its own** (boxholder ruling, 2026-09-26;
  `beebox/docs/implemented-plans/notifications.md:925-927`: *"health stays in
  the app unless it blocks something asked for"*). This plan makes a failing
  connector an exception. The argument: a connector's import IS something the
  boxholder asked for when they connected it, and a `failing` episode means
  the import has stopped. That is the promotion rule's own test, applied to
  the connector rather than to a schedule that requires it. Quiet episodes,
  scheduled-task failures and a dead grant without a failing connector stay
  dashboard-only. **This is the boxholder's ruling to revise; implementation
  of Track A waits for their yes.**
- **The connector-silence decision** (boxholder, 2026-09-18,
  `beebox/docs/implemented-plans/connector-silence.md:53-55`: *"One
  `notifyBoxholder` message per episode, plus a dashboard health warning"*).
  Track A restores that decision for `failing` episodes only.
- **Prefer silence to a false alarm** (`verdict.ts:6-8`). Kept: no new
  verdict, no lower threshold.
- **Minimize invented concepts.** No new store, latch, or verdict field: the
  episode's existing `notifiedAt` is the latch, and Track B reuses `bbx health
  --json` and the `bin/schedules alert` condition store.

## What already exists

- Episode latch: `updateConnectorEpisodes`
  (`beebox/src/core/schedule/scheduler/connector-activity-alert.ts:31`) already
  computes new episodes and stamps `notifiedAt`. **Reuse**: add the notify call
  there.
- Verdict text: `describeVerdict` (`beebox/src/connector-activity/verdict.ts:147`).
  **Reuse** on the dashboard; the notification body is shorter and omits the
  raw error (a raw API URL is not readable in a push).
- Dispatcher: `notifyBoxholder` (`beebox/src/core/notify-boxholder.ts`), used
  by `promotion.ts:62` with the same shape. **Reuse**.
- Google target: `GOOGLE_TARGET` and `RECONNECT_GOOGLE` in
  `beebox/src/core/schedule/promotion.ts:33-35`; grant state from
  `readGoogleAuthStatus` (`beebox/src/google/auth-status.ts:94`). **Reuse**;
  export the two constants.
- Requested-schedule promotion: `checkRequiredConnectors`
  (`promotion.ts:136`) sends `loud` for a boxholder-requested schedule whose
  required connector is failing. **Keep** — it names the reminder that is
  affected, which this notice does not.
- Dev alerts: `schedules/box-convergence/run.ts` already enumerates production
  boxes hourly over SSH (`prodTargets`, `run.ts:82`), tracks reachability, and
  reports standing conditions through `bin/schedules alert --condition`
  (`run.ts:93-97`). **Reuse**: one more read per production box.
- `bbx health --json` prints `boxChecks`, including every
  `connector-activity:<name>` check (`beebox/src/cli/commands/health.ts:181-183`).
  **Reuse** as the production read.

## Prior art (external)

No design decision here depends on an external premise; no search made.

## Ontology

No new nouns. Used as the code names them:

- **Connector episode** (`ConnectorEpisode`, `connector-activity/core.ts:72`):
  `{ kind: quiet|failing, since, notifiedAt, dismissedAt }`. `notifiedAt` now
  means a notice was attempted, which is what the name always said.
- **Notification intent** (`NotificationIntent`, `core/notification/intent.ts:31`).
- **Alert condition** (`bin/schedules alert --condition`): new condition name
  `prod-connector-activity`, one standing condition for all boxes, following
  the rule that keys never include finding text
  (`schedules/box-convergence/results.ts`, `ConvergenceAlert` comment).

## Tracks / scope

### Track A — a failing episode notifies the boxholder once

- **What.** When `updateConnectorEpisodes` stamps a new `failing` episode, send
  one `quiet` notification naming every newly failing connector.
- **Why.** The dashboard warning was the only signal, and it went unseen for
  13 days on two boxes with working push delivery.
- **Direction.** `updateConnectorEpisodes` returns the new episodes with their
  kinds (it already returns their names). A new function in
  `connector-activity-alert.ts`, `notifyFailingConnectors(boxRoot, { connectors,
  now, services? })`, runs after the record update (outside the record lock),
  builds the intent, and calls `notifyBoxholder`. Title: "Gmail has stopped
  syncing" (one) or "Gmail and Calendar have stopped syncing" (several).
  Body: "<names> <has/have> failed every sync since <since>, so nothing new has
  come in. The error is on the dashboard." When any named connector is a
  Google connector and `readGoogleAuthStatus` reports the grant needs
  reauthorization, append `RECONNECT_GOOGLE` and target `GOOGLE_TARGET`;
  otherwise target `{ kind: "dashboard" }`. Tag `connector-failing`.
  A send that throws is logged (`console.error`, as `promotion.ts:75` does) and
  not retried; `notifiedAt` is already stamped, so a delivery failure never
  becomes a notice every pass ("Nothing retries forever",
  `notifications.md:127-131`).
- **Vocabulary lock-ins.** Notification tag `connector-failing`.
- **First implementation chunk.** The function and its test, with a fake
  notify service: a new failing episode sends one intent; the next pass sends
  none; a quiet episode sends none; a dismissed episode sends none; two
  connectors on one pass send one intent naming both; the Google-grant case
  targets Admin.

### Track B — production connector episodes reach the developer

- **What.** `box-convergence` runs `bbx health --json` on each production box
  it already visits and reports any `connector-activity:*` check as the
  standing `prod-connector-activity` condition at `normal` priority.
- **Why.** The defect was in code; the developer is the one who can fix it,
  and the developer's alert channel saw nothing.
- **Direction.** After the migration step for a production root, run
  `node <root>/node_modules/beebox/dist/cli.mjs health --json --box <root>`
  under the same SSH, env and timeout framing (`run.ts:47-55`). Parse
  `boxChecks` with a zod schema; collect checks whose `name` starts with
  `connector-activity:` as lines `<box>: <message>`. `reportPlan` gains a
  `connectorFindings` input and returns the new condition in `alerts` when it
  is non-empty, and in `keep` when production was unreachable (an unreadable
  box does not resolve a condition, matching the existing unreachable rule).
  A health command that fails or prints invalid JSON becomes a line in the same
  condition ("health unreadable: …"), never silence. Local boxes are not read:
  the developer's own boxes have the dashboard in front of them.
- **Vocabulary lock-ins.** Condition `prod-connector-activity`.
- **First implementation chunk.** `reportPlan` change and its unit test in
  `convergence.test.ts`; then the SSH read.

## Could this be simpler?

The simplest version is Track A without the Google branch: about 30 lines.
It fails the case this incident showed: the boxholder reconnected Google, which
could not help. A notice that always says "reconnect" repeats that; a notice
that never says it leaves a person with an expired grant without the fix, per
"see the gears" (say what stopped and what to do). Track B could instead be a
new `prod-health` schedule; that would copy the production enumeration,
reachability tracking and condition reporting `box-convergence` already has.
Extending `box-convergence` stretches its name ("convergence") to cover one
more production read; the description line is updated to say so.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| `notifyBoxholder` throws (log full, channel error) | planned (A) | log and continue; `notifiedAt` already stamped | clear: scheduler log line; dashboard warning remains |
| No channel has an audience | existing (`channels.ts`) | notification log records `skipped` | clear in the log; dashboard remains |
| Grant status read throws | planned (A) | treat as "not known broken": dashboard target, no reconnect line | clear: notice still sent |
| Several connectors in one pass | planned (A) | one intent names all | clear |
| Episode closes and reopens the same day | existing (`verdict` tests: relapse is a new episode) | new episode, new notice | clear |
| Production `bbx health` times out or prints bad JSON | planned (B) | a line in the condition | clear |
| Production unreachable | existing (`trackReachability`) | condition kept, not resolved | clear after a day via `prod-unreachable` |
| A `connector-activity` check for a dismissed episode | n/a | `undismissedEpisodes` excludes it from health | quiet by design |

No critical gap.

## Agent-flow / user-flow edge cases

- Wrong tag / wrong field: no agent writes here. ADDRESSED (system code only).
- Stale ref: the notice targets the dashboard, not a card. ADDRESSED.
- Two writers: the activity record update keeps its lock; the notify call runs
  after it. ADDRESSED (Track A direction).
- Hand-edit drift: a hand-cleared `notifiedAt` sends one more notice. Accepted.
- Fabricated value, validation UX: not applicable; no agent input.
- Transition state: an episode open before deploy already has `notifiedAt`
  set (both incident boxes do), so deploying sends nothing for it.
  ADDRESSED: no retroactive notices.

## NOT in scope

- Notifying for quiet episodes: a statistical guess; the 2026-09-18 decision
  prefers silence.
- Notifying for failing scheduled tasks: the same ruling, and no incident.
- A "same error every time" flag: the failing verdict already separates a
  repeating failure from a transient one (any success breaks it); the gap was
  delivery, not classification.
- A generic poisoned-item skip across connectors: each connector's per-item
  fetch differs. Gmail is fixed in this workstream; Calendar has no per-item
  fetch (events arrive inline from `events.list`) and Drive has no change
  cursor (a failing card fails only itself, `google-drive/connector.ts:187`).
- Local (developer laptop) boxes in Track B.

## Open design questions

- The ruling revision in *Stated preferences* is the boxholder's. Lean: yes,
  for `failing` only.

## Knowledge audits

Skip: no agent-facing concept. The notice is system code; agents read the
same dashboard check as before.

## What will hold this after it ships

- Track A: a unit test on `notifyFailingConnectors` and on
  `updateConnectorEpisodes` with a fake notify service, in
  `beebox/test/core/schedule/` beside the existing alert tests.
- Track B: `reportPlan` is pure and already unit-tested in
  `schedules/box-convergence/convergence.test.ts`; the new input is tested
  there. The SSH read is exercised by the first scheduled run; its output
  reaches the run log ("Findings always reach the run log", `run.ts:83`).

## Implementation order

1. Track A function and tests; wire into `updateConnectorEpisodes`; update the
   header comments in `connector-activity-alert.ts` and `box-alerts.ts` and
   the reference docs that say connector health never notifies.
2. Track B `reportPlan` change and test; the SSH health read; schedule
   description.

## Rollout shape

Done when: the Track A tests pass (new failing episode notifies once; quiet,
dismissed and already-notified episodes do not; Google branch targets Admin
only when the grant needs reauthorization), and the `reportPlan` tests pass for
the new condition, including keep-on-unreachable. No migration: existing open
episodes carry `notifiedAt` and stay silent.
