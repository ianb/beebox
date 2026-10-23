---
title: "Simulated time for journey walk boxes"
status: draft
workstream: journey-walks-late-oct
issues: []
---
# Simulated time for journey walk boxes

A journey walker can now wait on a simulated phone, but the box keeps real time, so a wait has to end the walk. This plan gives a walk box a clock that runs ahead of real time by a stored offset. The box server, its chat agent, its scheduled work, its commits, and the app's displayed dates all read the shifted time. Then a walker can let a week pass, see the reminders and the box's own scheduled work arrive in time order, and come back to a box that agrees it is a week later.

**Issues addressed:** none open. It extends [walker gets simulated notifications](../../../issues/closed/features/2026-10-22-journey-walker-gets-simulated-notifications.md) (closed; its plan, [journey-simulated-notifications](../implemented-plans/journey-simulated-notifications.md), lists "Moving the box's own clock" and "Returning after a wait" as not in scope). It serves the verification need in [notifications and proactive design](../../../issues/features/2026-09-25-notifications-and-proactive-design.md) ("Proactive, not only reactive"; "Verification"), without resolving that issue. `bin/issues search --all "simulated clock time travel for test boxes"` found no duplicate; the nearest is [field-test weekday mismatch](../../../issues/closed/bugs/2026-08-09-field-scenario-weekday-fiction-mismatch.md), about the frozen field-test clock.

**Scope decision.** The boxholder asked for "a plan for the notifications. It will require moving forward in time and such." After the first draft (return visits, box-wide time, repeating reminders, scheduled agents, the browser's dates), the boxholder said "Try to fix those date issues. Rest sounds good." The date issues were the agent's real-date line and real git commit dates; both are now tracks.

## Design

No design section: this is dev harness for journey walks. Nothing changes for a box without a clock offset. On a walk box, the person-facing effect is that every surface agrees on a later date.

## Smallest fix and budget

Smallest fix: run the walk box on a dedicated `bbx serve` with a frozen `BBX_TIME`, and restart it with a later value for each wait. That is the field-test model (`src/field-test/run/pre-actions.ts:15-17`, *"stop the server, move the box clock, run a FULL wakeup plus `bbx tick` … restart the server"*). It does not fit walks:

- A frozen clock stops time during the walk. Every chat message has the same time, and a reminder set "in 10 minutes" never comes due.
- Walks use the shared dev router (`test/user-stories/journeys/prepare/core.ts:160-171`). A dedicated server means a second serving path for walks, a free port, and `BROWSE_BASE_URL`.
- The agent's model still gets the real date from the SDK preset (see *What already exists*).

Chosen design: a per-box offset, added to real time. Seven tracks:

1. The box clock offset, one shared fixture-flag reader, a health warning: about 70 source lines, 70 test lines.
2. Callers on the wrong clock, including the template contract: about 70 source lines, 60 test lines.
3. In-chat check-ins on the box clock: about 40 source lines, 50 test lines.
4. The agent's date line: about 25 source lines, 25 test lines.
5. Git commit dates: about 50 source lines, 40 test lines.
6. The app's displayed dates from the box clock: about 90 source lines (one query, one hook, about 15 display sites), 40 test lines.
7. The wait: every occurrence in time order, offset written last, walk wiring: about 140 source lines, 100 test lines, 40 lines of authored docs.

Total about 870 changed lines of code and tests, plus about 40 of docs. Not a BIG CHANGE.

## Stated preferences this plan trades against

- **Reuse the platform mechanism** (boxholder memory, "Minimize invented concepts"). `getBoxTime(boxRoot)` is already the box's clock (`src/lib/time.ts:44-66`), already reaches agents (`BBX_TIME` is on the script-env allowlist, `src/core/script-env/allowlist.ts:116`), and already feeds the agent's `local-time` (`src/core/session-context.ts:212-217`). `beebox/AGENTS.md` says: *"Use `getBoxTime`/`getBoxTimeISO` for timestamps so frozen scenario time works."* The plan adds one input to that clock, not a second clock.
- **Do not patch the global `Date`** in the server or the browser. Server file and git lock staleness, auth expiry, and maintenance deadlines read `Date.now()` (`src/lib/git-stale-lock.ts:300`, `src/lib/file-lock.ts:469`, `src/webapp/auth.ts:234,280`, `src/lib/box-maintenance/admission.ts:291,322`). In the browser, a global shift already breaks two expiry checks: a pairing ticket minted by the real-time server is discarded at once (`frontend/src/components/settings/CompanionPairingSection.tsx:99`), and a screenshot consent request dismisses itself (`frontend/src/components/chat/everywhere/InteractiveChat/ScreenshotConsentPopup.tsx:53`). Only display and box-time readers move.
- **Fail-closed** (boxholder memory, "Bias toward strict"). The offset applies only to a box whose notifications are fake. A shifted clock on a box that sends for real would deliver reminders on the wrong day.
- **Precedent: the field-test day advance** (`src/field-test/run/pre-actions.ts:199-208`): `bbx engine wakeup` and `bbx tick` at the new time, then draining jobs. A wait reuses that sequence per occurrence.

## What already exists

- **The box clock.** `src/lib/time.ts:44-66`, `getBoxTime(boxRoot?)`: `BBX_TIME`, then `../stubs.yaml` (cached per box root, with no invalidation: `stubsCache`, `:18-38`), then real time. A frozen instant only; nothing supports an offset (searched for `BBX_TIME_OFFSET`, `clockOffset`, `fake-timers`, `sinon`, `timekeeper`, `mockdate`: no hits outside `node_modules`).
- **Box-time readers.** About 140 call sites already use `getBoxTime` (core 93, webapp 26, cli 17, connectors 6). Those that matter here: the notification log (`core/notification/log.ts:189`), presence (`core/notification/presence.ts:36`), reminders (`cli/commands/remind/reminder.ts:132`), todo state and counts (`core/todo/count.ts:52`, `query.ts:28`, `review-sweep.ts:45`), question aging (`core/question-aging.ts:106,139,158`), capture failure notices (`core/capture/failure-notice.ts:53`), chat review (`cli/commands/chat/review.ts:36,103`), and the tick (`cli/commands/tick.ts:60`). They move with the offset for free.
- **Eleven calls pass no box root**: `core/secrets/lifecycle.ts:98,136,225`, `core/secrets/migrate.ts:365`, `core/secrets/probe-registry.ts:232,289`, `webapp/trpc/routers/browser-task.ts:27`, `field-test/email-fixture.ts:170`, `templates/question.ts:75,93,111`. Of these, only the question template's `askedAt` affects a walk (question aging reads it). A template's `generate` receives only its parsed arguments (`src/templates-shape.ts:24`, `generate: (args: …) => string`), and both creators call it that way (`core/commands/create.ts:138`, `cli/tick-utils.ts:283`).
- **The fake-notification gate.** `notifyFakeMode(boxRoot)` treats any present `fakeNotifications` value as fake, with a warning for a value other than `true` (`core/notification/fake-mode.ts:33-45`).
- **Real-clock readers a walk sees:** in-chat check-ins (`core/chat/schedules/core.ts:165`, `const now = new Date()`; `:244-260`, `getActive()` and `formatPendingForPrompt()` compute remaining time from `Date.now()`; `:292`, the timer delay); the migration sweep's question notice (`core/migration-sweep.ts:141`, `now: new Date()`).
- **Box time compared with real file times**: `core/chat/routing/quick-chat-submit/catalog.ts:96`, `core/chat/review/discovery.ts:264`, `core/chat/review/run/core.ts:140`, `core/retro/discovery/core.ts:119`.
- **The snapshot serializer.** `composeChatAppSnapshot` takes a typed input and an explicit attribute list (`core/chat/features.ts:137-192`; `"local-time"` at `:146`, `["local-time", input.localTime]` at `:192`).
- **The scheduler is a separate daemon.** `bbx serve` never ticks (`cli/commands/serve.ts:11-12`, *"feeds the SCHEDULER only … `bbx serve` never reads it"*); the daemon ticks registered boxes every 60 s (`core/schedule/scheduler/core.ts:157,257`). Walk boxes are not registered (`prepare/core.ts` has no `bbx boxes add`; the cross-model review confirmed it against `core/box/boxes-config.ts`). On a walk box only `phone.ts` ticks.
- **Due evaluation.** A cron card is due when its previous occurrence is after `lastRun` (`schemas/scheduled-script/due.ts:145-163`). One tick after a week's jump runs a daily card once.
- **The agent's dates.** `local-time` uses box time (`core/session-context.ts:212-217`), and the prompt says to reason from it (`core/chat/session/prompts.ts:125`). The SDK preset states the real date: probes on 2026-10-23 with `systemPrompt: { type: "preset", preset: "claude_code" }` quoted *"Today's date is 2026-10-23"*, the same with `excludeDynamicSections: true`. Chat runs the Claude Code native binary (`core/sdk-binary-path.ts:40`, `resolveClaudeCodeBinary`), so its clock cannot be shifted in-process. With a message tagged `Friday 2026-10-30`, Haiku used the tag but told the person *"My system date says October 23, which would make it 14 days … I've gone with that."* With the Track 4 sentence and `clock="simulated"` added (probe text in Track 4), Haiku answered *"Today is Friday, October 30, so November 6 is exactly one week away"* and Sonnet *"You have 6 days … I did the date math from today's date"*, neither mentioning the host's date and neither using a tool.
- **Git commit dates** are real. In-process commits take `commitEnvironment()` (`lib/git/core/operations.ts:306-315`, passes `process.env`); the box agent also commits from its own shell. Commit dates feed the history view (`webapp/trpc/routers/history.ts:126`, `lib/git/core/log.ts:308`). A probe on 2026-10-23: a `git` shim on `PATH` that sets `GIT_AUTHOR_DATE` and `GIT_COMMITTER_DATE` to `"<epoch + offset> +0000"` produced a commit dated `2026-10-30T13:49:44Z` at real time `2026-10-23T13:49:44Z`.
- **The app's dates.** About 98 frontend `new Date()`/`Date.now()` uses; most are ids, timers, and expiry checks. The visible ones: the todo "later"/"since" prefix (`components/todo/item-logic.ts:121`, and `todo-view/DatedList.tsx:31`, which passes no `todayIso`), the todo year (`components/todo/TodoItem.tsx:138`), chat message times (`components/chat/InteractiveChat-helpers.ts:16-17`; stamps at `machines/chatMachine/chat-actions.ts:52`, `machine.ts:201`, `lib/stream-entry.ts:38`), the time-passed note (`everywhere/InteractiveChat/dispatch.ts:65`), "N ago" labels (`session-pickers/SessionRow.tsx:31`, `InteractiveChat/session-search.tsx:29`, `dashboard/RecentActivity.tsx:29`, `dashboard/ScheduleOverview/view.tsx:31`, `history/HistoryViewCard/CommitTimeline.tsx:53`, `InteractiveChat/RecoveredDictation.tsx:41`), `useNow` (`lib/use-now.ts:15-16`), and the check-in countdown (`chat/InteractiveChat-controls.tsx:23`). "Overdue" and nav counts come from the server.
- **The phone.** `test/user-stories/journeys/phone.ts` ticks one-shot `notify:` cards at their `at` with `BBX_TIME`, keeps `<run-dir>/phone.json`, and names repeating reminders as not simulated.

## Prior art (external)

- `@sinonjs/fake-timers` and Playwright's `page.clock`: evaluated only. Both replace the whole clock, timers included, which is what this plan avoids.
- `agent-browser` page init scripts (`AGENT_BROWSER_INIT_SCRIPTS`, its README lines 436-442): evaluated, and a probe shifted a session's `Date` by a week. Not adopted: a global browser shift breaks the two expiry checks above.
- Git's `GIT_AUTHOR_DATE` / `GIT_COMMITTER_DATE` in the internal `"<unix> <tz>"` format: adopted, verified by the probe above. A documented git feature, no acknowledgement entry.

## Ontology

- **Box clock offset**: `.beebox/clock-offset.json`, `{ "offsetMs": <non-negative integer>, "setAt": <real ISO time> }`. Gitignored box state, like the notification log. Not `BBX_TIME` (a frozen instant, which still wins) and not `stubs.yaml`.
- **Walk fixture**: a box whose `_config/box.json` has a `fakeNotifications` key, read by one shared sync reader with the same rule as `notifyFakeMode`: any present value counts.
- **Applies**: the offset file exists and the box is a walk fixture. Otherwise the file is ignored, and box health reports it.
- **Box now**: `getBoxTime(boxRoot)`; with an applying offset, real time plus `offsetMs`.
- **Clock shift**: `boxClockShiftMs(boxRoot): number`, exported from `lib/time.ts`: box now minus real now on a walk fixture, else 0. It is non-zero both under an applying offset and under `BBX_TIME` during a wait's replay, before the offset is written. Tracks 4 and 5 key on it, not on the offset file.
- **Display now** (frontend): `boxNow()` = `Date.now()` plus the offset the server reported. Used only where a date is shown to the person.
- **Wait record**: `<run-dir>/phone.json` gains `wait: { from, to, started: [<card>@<iso>…], done: [<card>@<iso>…] }` while a wait is in progress; cleared when it finishes.
- **Simulated-clock attribute**: `clock="simulated"` on the `<chat-app>` tag while an offset applies.

## Tracks / scope

### Track 1: the box clock offset

- **What.** `getBoxTime(boxRoot)` adds `offsetMs` when the offset applies.
- **Direction.**
  - `src/lib/box-fixture.ts` (new, sync): `isWalkFixture(boxRoot)` reads `_config/box.json` and returns whether `fakeNotifications` is present, cached by mtime. `notifyFakeMode` uses it, so the two gates share one rule. (The box config loader lives in `core/` and is async; `lib/` may import `shared/` *"but never `core/`"* (`docs/module-map.md:29-31`), so the sync reader is the narrow piece both use.)
  - `src/lib/time.ts`: after `BBX_TIME` and `stubs.yaml`, read `<boxRoot>/.beebox/clock-offset.json`, cached by mtime; apply when `isWalkFixture`. A malformed file warns once and reads as no offset. Export `boxClockShiftMs(boxRoot)`.
  - Box health: `box-clock-offset`, warning: `"This box's clock runs 7d ahead (.beebox/clock-offset.json)"`, or `"… is ignored: this box is not a walk fixture"`.
- **Vocabulary lock-ins.** `.beebox/clock-offset.json`, `offsetMs`, `boxClockShiftMs`, `isWalkFixture`.
- **First chunk.** Reader, gate, caches, health, and tests: an offset applies on a fixture box, is ignored on another, loses to `BBX_TIME`; a malformed file reads as none; editing either file is seen without a restart (mtime cache test).

### Track 2: callers on the wrong clock

- **Direction.**
  - Template contract: `generate(args, ctx: { now: Date })` (`src/templates-shape.ts:24`); both creators pass `{ now: getBoxTime(boxRoot) }` (`core/commands/create.ts:138`, `cli/tick-utils.ts:283`); the question template uses `ctx.now` for `askedAt` (`templates/question.ts:75,93,111`). The other templates ignore the second argument.
  - `core/migration-sweep.ts:141`: `now: getBoxTime(boxRoot)`.
  - The four file-age checks compare the file's mtime with `Date.now()`, with a comment that file times are real. Each site is read first; one that compares a box-time stamp, not an mtime, stays on box time.
- **First chunk.** These edits; tests: a question created on an offset box carries the shifted `askedAt`; a file-age check gives the same answer with and without an offset.

### Track 3: check-ins on the box clock

- **Direction.** `ChatScheduleManager` (`core/chat/schedules/core.ts`) reads the box clock everywhere it reads now: `addSchedule` (`:165-166`), `getActive()` and `formatPendingForPrompt()` (`:244-260`), and `armTimer` (`:292`). It watches `.beebox/clock-offset.json` with `fs.watchFile` (5 s poll) while it has armed timers, and on a change clears and re-arms every timer; one already past fires at once (the existing `delay <= 0` branch).
- **First chunk.** The clock reads, the re-arm, and tests: the agent-facing pending text after an offset says "in 10 minutes" for a check-in made after the wait; a check-in armed before the wait fires once the offset passes its `firesAt`.

### Track 4: the agent's date line

- **Direction.**
  - `core/chat/features.ts`: add `clock?: "simulated"` to the snapshot input and `"clock"` to the read-only attribute list (`:146`, `:192`).
  - `core/session-context.ts`: set it when `boxClockShiftMs(boxRoot) !== 0`.
  - As built, the instruction is the attribute's own value (`clock="simulated: local-time is the date; the date in your system context is the host's; do not mention the difference"`, `SIMULATED_CLOCK_NOTE` in `core/chat/features.ts`), not a prompt sentence: a sentence in `core/chat/session/prompts.ts` put the always-loaded context 26 words over its budget (`test/core/agent-guide/lint.test.ts`). Re-probed with Haiku and Sonnet: both used `local-time` and did not mention the host's date.
  - Scheduled and invoked agents (`core/agent/invoke/run.ts:257-260,302-305`, which append only the timezone context): when `boxClockShiftMs(boxRoot) !== 0`, append *"This box runs on a simulated clock. The current time is <box time, local, with weekday>. The date in your system context is the host's; use the current time given here and do not mention the difference."* A scheduled run has no `<chat-app>` tag, so the time is stated in the sentence.
- **First chunk.** The edits, a test that renders the full `<chat-app>` tag with and without an offset, and a test of the invoke append. The chat probes above used this sentence and attribute and passed with Haiku and Sonnet. The invoke append was probed on 2026-10-23 (preset system prompt plus the append with `Friday 2026-10-30 09:00 CDT`, host date 2026-10-23, a daily todo-review prompt): Haiku, *"Call the insurer … is due Thursday, November 5, which leaves 6 days"*; Sonnet, *"due Thursday, November 5, which is 6 days from today (Friday, October 30)"*. Neither mentioned the host's date.

### Track 5: git commit dates

- **Direction.**
  - In-process commits: `commitEnvironment(boxRoot)` (`lib/git/core/operations.ts:306`) adds `GIT_AUTHOR_DATE` and `GIT_COMMITTER_DATE` = `"<seconds of getBoxTime(boxRoot)> +0000"` when `boxClockShiftMs(boxRoot) !== 0` and neither is already set. This covers commits during a wait's replay, where `BBX_TIME` sets the box time before the offset exists. Its callers already hold the box root.
  - Agent-shell commits: on a walk fixture, `buildScriptEnv` (`core/script-env/core.ts:126`) prepends `<box>/.beebox/bin` to `PATH`, where the box writes a `git` shim on first use. The shim takes the box time from `BBX_TIME` when set (a replayed run), else real time plus the offset file's `offsetMs`; it sets the two variables when that differs from real time and neither is set, and `exec`s the real git, whose path is written into the shim. With no offset file it runs the real git unchanged.
- **First chunk.** Both paths with tests: an in-process commit on an offset box, and one under `BBX_TIME` with no offset file, carry the box date; a shell `git commit` through the shim does the same in both cases; a commit on a box with neither is unchanged.

### Track 6: the app's displayed dates

- **What.** Displayed dates use the box clock; timers and expiry checks keep the browser's real clock.
- **Direction.**
  - Server: a `clock` query on an existing authed router returns `{ shiftMs: boxClockShiftMs(ctx.boxRoot) }`.
  - Frontend `lib/box-clock.ts`: `boxNow(): number` and `useBoxNow()` (a hook like `useNow`), fed by the query on load and on window focus. With no offset it equals `Date.now()`.
  - Display sites move to it: the todo prefix and year, chat message stamps and times, the time-passed note, the "N ago" labels, `useNow` consumers that show a time, and the check-in countdown (all listed in *What already exists*). `DatedList.tsx:31` passes `todayIso` from `boxNow()`.
  - Expiry and timer sites are not touched (pairing tickets, screenshot consent, upload stalls).
- **First chunk.** The query, `box-clock.ts`, two display sites (todo prefix, chat time), and a frontend test. Then the remaining sites.

### Track 7: the wait

- **Direction.**
  1. Read the box offset; `from` = box now, `to = from + d`. Record `wait: { from, to, started: [], done: [] }` in `phone.json` before any tick.
  2. List every occurrence in `(from, to]`: one-shot `notify:` cards at `at` (and overdue ones, as today); repeating `notify:` and `runs:` cards at each cron (`next()`) or RRULE (`between`) occurrence, with the libraries `due.ts` uses. Caps: 50 occurrences per `notify:` card; 14 `runs:` occurrences per wait in total (each runs an agent). Over a cap, refuse before any tick, naming the cards.
  3. Run them in time order. For each occurrence: add it to `wait.started`; run `bbx tick --script <name>` with `BBX_TIME = occurrence + 1 s`, fake channels forced and real keys stripped as today, and `--force` for a `runs:` card (a chat left open would otherwise defer it: `cli/commands/tick.ts:88-93`; `--force` keeps the liveness gates, `cli/tick-helpers.ts:147-151`). Then read the outcome, not the exit code (`bbx tick` exits 0 with errors and deferrals, `tick.ts:171-173`): a `notify:` occurrence by the log, as today; a `runs:` occurrence by the script's state (`core/schedule/state.ts:164`, `loadScriptState`): `lastRun` at or after the occurrence means it ran, with `lastResult` saying how. A `runs:` occurrence that did not run stops the wait with the tick's output. One that ran and failed is recorded as failed, as the real box records it (`core/schedule/run-action.ts:181-186`), and the wait continues; the box's health shows it, and a failed occurrence is not retried, as a real box's scheduler would not retry it. Add it to `wait.done`. After a `runs:` occurrence, drain jobs as `advanceDays` does (a failed job is reported like a failed run, and the wait continues) (`src/field-test/run/pre-actions.ts:205-208`), then re-list the cards: an occurrence of a card created during the wait (for example by `create-after-success`, `cli/tick-utils.ts:243-284`) that falls after the current one and by `to` joins the queue, within the same caps.
  4. At `to`: `bbx engine wakeup --skip-push` with `BBX_TIME = to`, then drain; a failure of either is reported, and the clock still moves.
  - Caps, as built: 8 occurrences per `runs:` card per wait (a fresh box enables three daily and one weekly `runs:` card, so a week is 22 runs; a total cap of 14 would refuse every week-long wait), 50 per `notify:` card.
  5. Only then write the offset (`offsetMs = to − real now`) and clear `wait`.
  6. A wait that stops or is killed leaves the offset unchanged and `wait` recorded. The next `phone.ts` call with a recorded `wait` refuses `--wait` and resumes the recorded interval: it skips `done` entries, and lists an entry in `started` but not `done` as interrupted and does not rerun it, because its command may already have written or committed. One-shots already fired are gone from disk, and a repeating card's `lastRun` records its completed runs, so the resumed ticks do not repeat them.
  - `phone.json` keeps `shown` and `wait`; the walk clock is the box clock.
- **Walk wiring.** The walker prompt drops "the wait is your last act": after a wait, come back in a new `--session`; the app and the agent know it is later. G's closing beat: a week passes; read the phone, then come back and deal with what it says. The journeys README describes the moved clock and its limits.
- **First chunk.** Occurrence listing, caps, and queue merging (pure, tested), the wait record and resume, the offset written last, and the script-level test: a daily `notify:` card fires seven times in order across `--wait 1w`; a `runs:` card due twice runs twice; a `runs:` card that fails is recorded and the wait continues; a card created by a `runs:` occurrence fires later in the same wait; a wait stopped after the first tick resumes without repeating it; an entry left in `started` is listed as interrupted and not rerun.

## Could this be simpler?

Simplest: keep the phone as built (a wait ends the walk). That is the current state, and it cannot show a return visit or the box's own scheduled work, which the boxholder approved.

Next: the frozen-clock restart (*Smallest fix*). It fails on time flowing within a sitting, on walks using the shared router, and on the agent's real-date line.

Considered and cut: a global `Date` shift in the browser (breaks expiry checks), one tick at the end of a wait (runs a daily card once for a week), and making walk boxes scheduler-daemon boxes (the daemon would tick on its own clock).

## Subplans

None.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| An offset file lands on a box that is not a walk fixture | New: Track 1 | Ignored; health reports it | Clear |
| A malformed offset file | New: Track 1 | Warns once, no offset | Clear |
| A file-age check compares box time with a real mtime | New: Track 2 | The four known sites move to real time | Silent if a fifth exists: Track 2 greps `getBoxTime` near `mtime`/`stat` |
| A question made on an offset box keeps a real `askedAt` | New: Track 2 | Template context | Clear in the test |
| A check-in armed before a wait never fires, or the agent reads its time wrong | New: Track 3 | Re-arm on offset change; box clock in the pending text | Clear |
| The agent tells the walker its system date differs | Probes recorded above | `clock="simulated"` sentence | Clear in the walk report if it recurs |
| An agent shell commit bypasses the shim (absolute `/usr/bin/git`) | — | Accepted: its commit carries the real date; the history view shows it older | Visible in the history view |
| A displayed date still reads the real clock | New: Track 6 tests for the moved sites | — | Visible in screenshots; a missed site is a follow-up |
| A wait fails midway | New: Track 7 test | Offset written last; recorded wait resumes | Clear |
| A `runs:` tick is deferred (open chat, lock group) and looks done | New: Track 7 test | `--force` for the wait's own ticks; outcome read from script state; a not-run occurrence stops the wait | Clear |
| A scheduled run fails during a wait | New: Track 7 test | Recorded as failed, as a real box records it; not retried; health shows it | Clear |
| A run killed mid-command would repeat its side effects on resume | New: Track 7 test | `started` without `done` is listed as interrupted, not rerun | Clear: the walker sees which run was cut off |
| A schedule created during the wait is missed | New: Track 7 test | Cards re-listed after each `runs:` occurrence | Clear |
| A scheduled agent run reasons from the host's date | Track 4 invoke probe | Invoke append states the box time | Clear in the probe record |
| A commit during a wait's replay keeps the real date | New: Track 5 test | Shift keyed on box time, `BBX_TIME` included | Clear |
| A wait would run too many agents | New: Track 7 test | Refuses before any tick, naming the cards | Clear |
| `BBX_TIME` and an offset both set | New: Track 1 | `BBX_TIME` wins | Clear |

No critical gap.

## Agent-flow / user-flow edge cases

- **Wrong field**: an agent sets `fakeNotifications` or writes an offset. ADDRESSED: both show in health.
- **Stale ref**: a card deleted between listing and ticking. ADDRESSED: "no record", as in the phone plan.
- **Two writers**: `phone.ts` writes the offset; the server and the check-in manager only read it. ADDRESSED.
- **Hand-edit drift**: not applicable.
- **Fabricated value**: the agent states a date. ADDRESSED: `local-time` is box time, and Track 4 removes the conflicting cue.
- **Validation error UX**: cap refusals name the cards and counts.
- **Transition state**: a box with no offset file behaves exactly as today. A run directory from the previous phone version has a `phone.json` `now`, which `phone.ts` ignores once it reads the offset.

## NOT in scope

- **A global `Date` shift**, server or browser.
- **The scheduler daemon.** Walk boxes stay unregistered; `phone.ts` ticks them.
- **The ten other no-root `getBoxTime` calls.** A walk does not read them.
- **Connectors** (Gmail, Calendar): walk boxes have none.
- **Moving the clock backwards.** `offsetMs` only grows.
- **Codex-engine agents.** Track 4's probes cover the Claude preset; a walk box runs Claude by default.

## Open design questions

None.

## Knowledge audits

Skip: the only agent-facing text is one sentence that appears only on simulated-clock boxes. The Track 4 probes are its check, and they passed.

## What will hold this after it ships

- Unit tests per track, listed in each first chunk.
- The `journey-phone` script test, extended to repeating cards, `runs:` cards, and a resumed wait.
- A frontend test for `boxNow` and the moved display sites.
- The next G walk with a return visit: its report should show the box, the agent, and the app agreeing it is a week later.

## Implementation order

1. Track 1. Commit.
2. Track 2. Commit.
3. Track 3. Commit.
4. Track 4. Commit.
5. Track 5. Commit.
6. Track 6. Commit.
7. Track 7 and walk wiring. Commit.
8. Cross-model review of the diff; fix; report.

## Rollout shape

Done when the tests above pass, `test:changed`, typecheck, `lint:changed`, layout-check and doc-check are clean, and a throwaway-box run shows: a reminder and a daily reminder firing across a wait in time order; a `runs:` schedule running per occurrence; a check-in armed before the wait firing at once; a commit after the wait dated in box time; and the app's todo prefix and chat times reading the box date in a new browse session. No data migration: the offset file is new and only walk boxes get one.
