---
title: "Simulated notifications for journey walkers"
status: draft
workstream: journey-walks-late-oct
issues:
  - ../../../issues/features/2026-10-22-journey-walker-gets-simulated-notifications.md
---
# Simulated notifications for journey walkers

A journey walker cannot see a reminder reach the person: the walk browser denies notification permission, and a walk lasts minutes while a reminder is due days later. This plan gives each walk box fake notification delivery and gives the walker a "phone" command that moves the walk's own clock forward, fires the box's due reminders at the simulated times, and prints what arrived as text. The wait is the walk's last act: the walker reads the phone and may open where a notification leads, and the walk ends there.

**Issues addressed:** [walker gets simulated notifications](../../../issues/features/2026-10-22-journey-walker-gets-simulated-notifications.md). Related, closed: [the journey browser denies notification permission](../../../issues/closed/code-quality/2026-10-22-journey-browser-denies-notification-permission.md) (the walker-prompt line it added is replaced here). Related, open and not addressed: [notifications and proactive design](../../../issues/features/2026-09-25-notifications-and-proactive-design.md). `bin/issues search --all "walker notification"` found no duplicate.

## Design

No design section: this is dev harness for journey walks. The one change a box can show is a health warning on a box whose notifications are fake, and only fixture boxes set that.

## Smallest fix and budget

Smallest fix: `prepare` writes `BBX_NOTIFY_FAKE=1` into the worktree `.env`, and a script runs `BBX_TIME=<t> bbx tick --script <name>` for each reminder and prints `.beebox/notifications.jsonl`. That was run by hand on a throwaway box on 2026-10-23 and it works (see *What already exists*). It fails in two ways, so the plan does more:

- `.env` is read only when the worktree cold-starts (`beebox/test/user-stories/journeys/prepare/core.ts:250`: *"a worktree cold start may be needed to read the new registration. This script does not restart it."*), so a warm worktree silently keeps real delivery, and `bbx remind` refuses. The variable also fakes every box the worktree serves, including its test1 clone.
- Raw log lines are not what a person reads; the walker needs a time, a title, a body, and a path to open.

Chosen design, three tracks:

1. Per-box fake notifications in `_config/box.json`, with a health warning: about 50 source lines, 50 test lines.
2. The `phone.ts` journey command, with pure helpers for due reminders and formatting: about 130 source lines, 80 test lines.
3. Walk wiring: `prepare`, the walker prompt, the G journey's closing, `collect.ts`, the journeys README: about 40 lines of code and 40 of authored docs.

Total about 350 changed lines of code and tests, plus about 40 of docs. Not a BIG CHANGE.

## Stated preferences this plan trades against

- **Minimal concepts, reuse the platform mechanism** (boxholder memory, "Minimize invented concepts"). The plan reuses fake mode, the notification log, `bbx tick`, and `BBX_TIME`. It adds one box config field and one harness script. It does not add a time-travel subsystem.
- **Bias toward strict / fail-closed** (boxholder memory). `phone.ts` always runs the tick in fake mode with the real channel keys removed from its environment, whatever the box config says. A `fakeNotifications` value other than `true` is a warning and reads as on: a box that tried to say "fake" stays fake.
- **Shipped precedent: `agentBrowsing: "owner"`** (`beebox/src/core/box/config.ts:81-86`, *"Set on boxes BUILT for agent-driven testing (test1 and its clones) … A box a person actually uses must not set this."*). The new field follows it: a fixture-only box setting that `prepare` writes (`prepare/core.ts:130-133`).
- **Do not invent events** (`beebox/test/user-stories/journeys/walker-prompt.md`, "Do not invent events"). Moving time is the journey's event, so the journey text says when time passes. The walker does not choose to.

## What already exists

- **Fake mode.** `beebox/src/core/notification/fake-mode.ts:13-25`, `notifyFakeMode()` reads `BBX_NOTIFY_FAKE`. Under it every channel sends through its fake to a synthetic audience (`audience.ts:31-41`), and the log records `sent (fake)`. Reuse; make it per box.
- **Call sites of `notifyFakeMode()`**, all reuse with a `boxRoot` argument added: `audience.ts:32` (in `audienceDetail(boxRoot)`), `send-push.ts:68` (`webPushConfigured()`, no box argument today) and `:108` (in `sendPush(boxRoot, …)`), `apns-channel/core.ts:45` (`apnsConfigured()`, no box argument) and `:105` (in `sendApns({ boxRoot, … })`), `cli/commands/pairing.ts:21`. The no-argument functions are called from `notify-boxholder.ts:80-84` (`channelsConfigured(services)`, reached from `notifyChannelsDetail(boxRoot)` at `:100` and from the send path at `:234`) and from `webapp/trpc/routers/notifications.ts:71` (`apnsStatus`, has `ctx.boxRoot`).
- **The notification log.** `beebox/src/core/notification/log.ts:185-191`, `readRecent(boxRoot, { days, now })` returns each intent with its deliveries. Reuse to read what arrived.
- **Tap targets.** `beebox/src/core/notification/target.ts:99-105`, `targetUrl(target, { boxSlug, notificationId })` gives `/<box>/chat?new=1&notification=<id>` for `chat:new`. Reuse; strip the `/<box>` prefix because `bin/browse` adds it.
- **Reminders are `notify:` schedule cards.** `cli/commands/remind/reminder.ts:1-14`: `at`, `once: true`, `notify:`, and *"Refused before anything is written: … a box no channel can reach at the card's loudness."* So a walk box without fake delivery cannot even set a reminder.
- **Due times.** `schemas/scheduled-script/due.ts:51-82` (`isDue`) and `:133-143` (`isAtDue`): a one-shot is due once `now >= at` and it has not run. `phone.ts` relies on the same rule by ticking at `at + 1 s`.
- **Ticks honor a stubbed clock.** `cli/commands/tick.ts:60`, `const now = getBoxTime(boxRoot)`; `lib/time.ts:50-56` reads `BBX_TIME` first. A `notify:` card runs while a chat is busy (`cli/tick-helpers.ts:121-123`, *"notify: cards still run"*), so the tick needs no `--force`.
- **Hand check, 2026-10-23**, throwaway box made per `beebox/docs/box-work.md` ("Making a throwaway box"): `BBX_NOTIFY_FAKE=1 bbx remind --in 3d …` wrote the card. `BBX_TIME=<at+1m> bbx tick --script <name>` printed *"1 ran"*, deleted the one-shot, and committed. The log then held one intent stamped with the simulated time and two `sent` / `fake` deliveries (`apns`, `web-push`).
- **The walker clock tool**, `beebox/test/user-stories/journeys/clock.ts`, is the model for a walker-facing harness command: one `pnpm exec tsx` line in the prompt, output written for the walker.

## Prior art (external)

No design decision depends on an external premise.

## Ontology

- **Fake notifications (box setting)**: `fakeNotifications: true` in `_config/box.json`. When set, this box's notifications go only to fakes. It is not the process-wide `BBX_NOTIFY_FAKE`, which still works and still fakes every box in the process. Either one turns fake mode on.
- **Walk clock**: the simulated "now" for one walk, stored in `<run-dir>/phone.json` as `{ "now": <ISO>, "shown": [<notification id>…] }`. Before any wait it is the real time. It is not the box's clock: the box server and its agent keep the real time, which is why a wait ends the walk.
- **Phone**: what `phone.ts` prints and appends to `<run-dir>/phone.md`: the notifications that reached the person and that the walker has not been shown yet. A notification reached the person when its intent has at least one delivery with status `sent`.
- **Waiting** (`--wait <duration>`): moving the walk clock forward and firing, in `at` order, each pending one-shot `notify:` card whose `at` is at or before the new walk clock. A one-shot card that still exists has not fired (a fired one is deleted), so an overdue reminder is fired too.

Existing names used unchanged: notification intent, delivery, `notify:` card, loudness (`dot`, `quiet`, `loud`), target.

## Tracks / scope

### Track 1: per-box fake notifications

- **What.** `notifyFakeMode(boxRoot)` returns true when `BBX_NOTIFY_FAKE=1` or the box config has `fakeNotifications: true`.
- **Why.** The environment variable is per process and reaches a served box only after a worktree cold start, and then fakes every box in the worktree.
- **Direction.**
  - `BoxConfig.fakeNotifications?: true`, documented like `agentBrowsing`.
  - `notifyFakeMode(boxRoot: string): Promise<boolean>` reads `loadBoxConfig(boxRoot)`. A present value other than `true` warns once and reads as on.
  - Injected `NotifyServices` keep precedence over the fakes: production leaves them unset (`src/services/container.ts:61-64`, *"Production leaves it unset"*); only tests inject them.
  - `webPushConfigured(boxRoot)`, `apnsConfigured(boxRoot)` and `channelsConfigured(boxRoot, services)` become async with a box argument; the call sites listed above pass `boxRoot`. `pairing.ts:21` passes its box root.
  - Box health: a warning check, `Notifications on this box are fake (fakeNotifications in _config/box.json); nothing reaches a phone.`
- **Vocabulary lock-ins.** `fakeNotifications` in `box.json`.
- **First chunk.** The config field, the async `notifyFakeMode(boxRoot)`, the call sites, the health warning, and tests: a box with the field gets the synthetic audience with the variable unset; a box without it and without the variable does not.

### Track 2: `phone.ts`

- **What.** `pnpm exec tsx beebox/test/user-stories/journeys/phone.ts <run-dir> [--wait <duration>]`.
- **Direction.**
  1. Read `<run-dir>/before.json` for the box path and slug. Read or create `<run-dir>/phone.json`.
  2. With `--wait d`: `to = clock + d`. List `_config/schedules/*.scheduled-script.card` with `notify:`, `enabled` not false. A card with `at` at or before `to` is pending; a card with `cron` or `rrule` is listed under `Not simulated:` by name. For each pending card in `at` order, run `bbx tick --script <name>` in the box with `BBX_TIME = at + 1 s`, `BBX_NOTIFY_FAKE=1`, and these removed: `BBX_APNS_*`, `BBX_VAPID_*`, `BBX_SERVER_URL`, `BBX_BOX_NAME`, `BBX_AGENT_TOKEN`. A `notify:` tick calls `notifyBoxholder` in the tick process (`core/schedule/run-action.ts:76-88`), so the stripped keys and the forced variable decide the channels. Then save `now = to`.
  3. Without `--wait`: the clock does not move; the command shows what arrived in real time during the walk (for example, a reminder set for ten minutes later, or an agent's `bbx notify`).
  4. Read `readRecent(box, { days: 3650, now: <walk clock> })`. Show each intent not in `shown` that has a `sent` delivery, oldest first. Add their ids to `shown`.
  5. Print and append to `phone.md`, one block per notification:
     ```
     Mon Oct 26, 12:48 PM — sound
     Renew the home insurance
     Price goes up on Nov 7.
     Tap opens: /chat?new=1&notification=neRnq1KiP
     ```
     Loudness reads `sound` (loud), `silent` (quiet), or `badge only` (dot). Times use the walker's local zone, like `{{NOW}}`. With nothing new: `Nothing new on your phone (walk clock: <time>).`
  6. The tick's exit code and summary do not say whether one card fired: `bbx tick` exits 0 with errors (`cli/commands/tick.ts:166-173`), and a busy box defers the whole tick with no per-card line (`tick.ts:88-93`). So `phone.ts` checks the outcome: after each tick, the log must hold a new intent with `source: schedule:<name>` and a `sent` delivery. If it does not, the card goes under `No record of these reaching the phone:` with the tick's output, or, when the tick printed nothing, a line saying it did not run the card. The heading says only that no record exists: a send whose log write failed may still have gone to the fakes. This also catches a log that could not be written, which `notifyBoxholder` reports but does not fail on (`notify-boxholder.ts:118-125`).
- **Pure helpers** (`phone-core.ts`, tested): `pendingReminders(cards, to)` (pending in `at` order, plus the not-simulated list), `parseWait("2d" | "36h" | "1w")`, `formatPhoneEntry(logged, { boxSlug, zone })`, `firedFor(logBefore, logAfter, name)`.
- **First chunk.** The helpers and their tests, then the script.

### Track 3: walk wiring

- `prepare/core.ts:133` writes `fakeNotifications: true` beside `agentBrowsing: "owner"`, and fills a new `{{RUN_DIR}}` placeholder.
- `walker-prompt.md`: the "blocks notification permission" paragraph becomes a "Your phone" section:
  - run `phone.ts {{RUN_DIR}}` to look at your phone;
  - run it with `--wait <duration>` only when your situation says time passes; the wait is your last act: read the phone, open at most what a notification leads to, write it down, and stop;
  - the app keeps its own clock, so do not report its date as wrong;
  - what the phone shows is what the person's phone would show.
- `G-paperwork/journey.yaml` `closing:` gains a last beat: when you are done for tonight, a week passes. Wait a week on your phone and read what came; that ends the walk.
- `collect.ts` copies `phone.md` into the report inputs and counts its entries.
- Journeys README "Scheduled work needs its own verification": a walk can now observe a `notify:` reminder's trigger and delivery with `phone.ts`; `runs:` schedules are still not driven.

## Could this be simpler?

The simplest version is the `.env` variable plus one tick at the target time. It fails in two cases:

- In a warm worktree, the variable does not reach the server. The agent's `bbx remind` refuses, and the walk records "nothing can reach me" again. That is the failure this issue is about (fail-closed bias: a fixture setting read live beats a process setting that needs a restart nobody runs).
- One tick at `to` stamps every reminder with the end time, so a walker cannot tell a reminder that came on time from one that came late. Ticking each card at its `at` costs about 15 lines.

Recurring `notify:` cards (cron, RRULE) are left out of the first version: `bbx remind` writes one-shots (`cli/commands/remind/reminder.ts:143-155`), and no journey needs a repeating reminder yet. `phone.ts` names them as not simulated.

The plan does not shift the box's own clock. That would mean `BBX_TIME` for the whole server and every `new Date()` read; see *NOT in scope*.

## Subplans

None.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A real box gets `fakeNotifications: true` (an agent edits `box.json`), and the person stops receiving notifications | New: health check test | Health warning | Clear on `bbx health` and the dashboard |
| `fakeNotifications: "yes"` (wrong type) | New: config test | Warns once, reads as on (fake) | Clear (warning); no real send |
| `phone.ts` run on a box without the field: real channels could send | New: env-builder test | Tick env forces `BBX_NOTIFY_FAKE=1` and strips channel keys | No real send possible |
| A recurring `notify:` card falls in the wait | New: helper test | Listed under "Not simulated" | Clear |
| A reminder fell due before the first `phone.ts` call and nothing fired it | New: helper test | Pending cards include overdue ones; it fires at its `at` | Clear |
| A tick runs but logs nothing (busy box, log unwritable, error with exit 0) | New: script test | Outcome check against the log | Clear: "no record" with the tick's output |
| The server's own scheduler fires the same card while `phone.ts` ticks it | Existing script lock (`core/schedule/state.ts:293` `acquireScriptLock`) | One run wins; a once card is deleted after it | Clear: the loser prints a skip, shown under "no record" |
| The walk clock is behind real time (a reminder set for 10 minutes later during a long walk) | — | The server fires it in real time, in fake mode; `phone.ts` without `--wait` shows it | Clear |
| `phone.json` is missing or corrupt | New: script test | Missing: start at real now. Corrupt: refuse with the path | Clear |
| A walk box's `box.json` becomes unreadable, so the field reads as absent | — | Accepted risk: a walk box has no paired phone and no push subscription, so real channels have nobody to send to; reading a broken config as fake would silence a person's box instead | — |
| A reminder card carries run state from an earlier failed send, so a replay at `at + 1 s` is not due | — | Shown under "no record" as not run; fake sends do not fail, so only a send from before the box was fake can leave such state | Clear |
| The log rotates during a walk | Existing: `readAll` reads both files (`log.ts:170-182`) | Covered | — |
| `notifyFakeMode` becomes async and a caller drops the `await` | Typecheck: `@typescript-eslint/no-floating-promises` and a `Promise` used as a boolean | Lint and type errors | Clear at build |

No critical gap.

## Agent-flow / user-flow edge cases

- **Wrong field**: the box agent could set `fakeNotifications`. ADDRESSED: health warning; the field's doc says a person's box must not set it.
- **Stale ref**: a reminder card deleted between listing and ticking. ADDRESSED: the tick reports "Script not found" and exits 1; shown under "no record".
- **Two agents on one card**: server scheduler and `phone.ts`. ADDRESSED: script lock (above).
- **Hand-edit drift**: not applicable; a walker never edits the box by hand.
- **Fabricated value**: the walker could invent a notification. ADDRESSED: the prompt says the phone shows only what `phone.ts` printed; `phone.md` is the record a report checks.
- **Validation error UX**: "no record" quotes the tick's own output for the card.
- **Transition state**: `notifyFakeMode()` callers change in one commit; no data migration.

## NOT in scope

- **Moving the box's own clock.** The server, its scheduler, and its agent keep real time after a wait. Considered `BBX_TIME` for the served box; not now, because the server reads `new Date()` in many places and a frozen clock breaks chat timing.
- **`runs:` schedules** (judgments, digests, procedures that end in `bbx notify`). They run agents and connectors; simulating them is a separate harness question.
- **Granting browser notification permission** or a push service that reaches the headless browser.
- **Recurring `notify:` cards.** Named as not simulated; add when a journey needs one.
- **Returning after a wait.** The box keeps real time, so a return visit would not be in the walk's time; the wait ends the walk.
- **Other journeys.** Only G gets a time-passes beat. F ("fewer small things slipping my mind") is the next candidate; adding it is a journey edit, not harness work.
- **The iOS app's display** of a notification. The phone text shows the intent's fields, not a device rendering.

## Open design questions

None.

## Knowledge audits

Skip: no box-agent guidance changes. The new box config field is for fixtures; box agents are not told about it.

## What will hold this after it ships

- Unit tests for `phone-core.ts`: pending cards at the window edge, an overdue card, a disabled card, cron and RRULE cards listed as not simulated; `parseWait`; `firedFor`; formatting with each loudness and a `card:` target.
- A test of `notifyFakeMode(boxRoot)` and `audienceDetail` with the box field set and with the variable unset.
- A health-check test for the warning.
- One script-level test that builds a throwaway box, writes a `notify:` card with `at` in two days, runs `phone.ts --wait 3d`, and checks `phone.md` and `phone.json`. It runs `bbx tick` in a child process, as the hand check did.
- The next G walk is the end-to-end check: the report should quote a phone entry.

## Implementation order

1. Track 1: config field, async `notifyFakeMode(boxRoot)`, call sites, health warning, tests. Commit.
2. Track 2: `phone-core.ts` and tests, then `phone.ts` and its script test. Commit.
3. Track 3: `prepare`, walker prompt, G closing, `collect.ts`, README. Commit.
4. Cross-model review of the diff; fix; report.

## Rollout shape

Done when the tests above pass, `test:changed`, typecheck, `lint:changed`, layout-check and doc-check are clean, and a manual run on a throwaway box (an agent-free `bbx remind`, then `phone.ts --wait 4d`) prints the reminder. No data migration: the field is new and optional. Existing walk boxes do not get it. Only boxes prepared after this lands do.
