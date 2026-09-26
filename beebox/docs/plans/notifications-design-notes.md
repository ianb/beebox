---
title: "Notifications and proactive work: experience, pieces, and worked examples"
status: draft
workstream: notifications
issues:
  - ../../../issues/features/2026-09-25-notifications-and-proactive-design.md
  - ../../../issues/features/2026-08-09-agent-outcomes-need-a-voice.md
  - ../../../issues/features/2026-08-21-capture-confirmation-misses-a-user-who-left.md
  - ../../../issues/features/2026-08-22-file-asks-agent-flagged-attention.md
  - ../../../issues/bugs/2026-09-21-agent-promises-unconfigured-calendar-delivery.md
  - ../../../issues/code-quality/2026-07-04-web-push-followup-testing.md
---
# Notifications and proactive work: experience, pieces, and worked examples

This is the design conversation before the plan. Where this document and
[notifications.md](notifications.md) differ on mechanism (output cards
versus bus events, `bbx remind` versus a `notify:` field), the plan is
current; the rulings here still stand.

This is the design conversation before the plan. It records what the
boxholder wants the experience to be, the small set of pieces an agent
composes to get there, and one worked example per use case. The
implementation plan follows from it and will cite it. Rulings marked
**Boxholder** were given in discussion on 2026-09-26. Everything else is
proposal.

## The design in one paragraph

The box does not decide what is notification-worthy in code. It gives the
agent a few pieces: send a notification now, send one at a time, send one
when a condition becomes true, and run an agent on a schedule. The judgment
about when to use them, and how loud, lives in the briefing. Failures and
things the person asked to be told about are loud. Routine success is
silent. Health problems stay in the app unless they block something the
person asked for. Notifications know whether the app is open, and a
notification whose target is already on screen is not sent.

## What exists, in brief

- `notifyBoxholder` (`src/core/notify-boxholder.ts:66`) writes one durable
  output card per channel (web push when a device is subscribed, Telegram
  when `healthAlerts.telegramChat` is set) and flushes them at finalize or at
  once with `deliver: true`. Only system code calls it: schedule health,
  Google auth expiry, connector activity, engine quota, new questions, the
  7-day question nudge.
- Web push is complete and has never delivered. No VAPID keys on prod, no
  subscription store anywhere
  (`issues/code-quality/2026-07-04-web-push-followup-testing.md`).
- The iPhone app is a SwiftUI shell around `WKWebView` (`ios-app/README.md`).
  `WKWebView` has no service-worker push, so web push cannot reach the app
  the boxholder uses. No APNs code exists. Each phone already has a device
  record from pairing (`docs/mobile-contract.md`, `pairing.devices`), which
  is where an APNs token belongs.
- Scheduled scripts (`src/schemas/scheduled-script.tsx`) already run any
  command at a `cron`, `at`, or `rrule` time, with `once` and `until`. A
  timed notification is a scheduled script whose command is a notify.
- Jev (`src/services/jev.ts`) answers typed questions about supplied state
  with a probability per option and a confidence. Today it is used for chat
  routing. It does not run an agent, so a yes/no criterion can be tested on
  every new item at a cost that makes noisy polling practical.
- In-app attention is the pending-question count and the plate badge
  (`src/frontend/src/components/app-nav-badges.tsx`). Nothing marks a reply
  as unread and nothing badges the app icon.
- The dev-side schedule alerts (`bin/schedules`, macOS alerter, daily digest
  for the quiet tiers) are a separate system for the developer. They are
  precedent for the vocabulary, not part of this design.

## Vocabulary

**Loudness.** One word on every notification, from the agent or the card
that created it.

| Word | Phone | Desktop web | In the app |
|---|---|---|---|
| `dot` | app icon badge, no banner | no push | unread mark on the target |
| `quiet` | notification in the list, no sound | push, silent | unread mark on the target |
| `loud` | banner and sound | push with sound | unread mark on the target |

`dot` and `quiet` need the native app on the phone: the icon badge and
silent delivery come through APNs. Web push covers the desktop.

**Target.** Where tapping lands: a chat (existing or new, seeded with
context), a card, or a question. Every notification has one. The target is
also what presence checks.

**Presence.** The server knows which sessions are live and what each shows
(the chat-everywhere plan's attention snapshot,
`docs/plans/chat-everywhere.md`, Track C). A notification whose target is on
a live screen is delivered in-app only. When the person sees the target in
the app, the unread mark and the phone notification clear.

## The pieces

### 1. Notify now

An agent command. Proposed shape:

```
bbx notify --loud "Capture failed" --body "I could not read the photo" \
  --target chat:2026-09-26-capture-a1b2
```

Writes the output cards `notifyBoxholder` writes today, plus an
`unread` entry for the target, and delivers at once. The command is the
whole agent-facing surface; the briefing decides when to use it and how
loud. **Boxholder:** agents must be able to notify immediately.

### 2. Notify at a time, with no agent

A scheduled script whose command is a notify. This needs no new card type.
Proposed streamlining is one command that writes the card:

```
bbx remind --at 2026-10-02T08:30 "Call the vet about Pepper's shots" \
  --target chat:new
```

which writes `_config/schedules/remind-pepper-vet.scheduled-script.card`:

```yaml
at: 2026-10-02T08:30
once: true
runs: bbx notify --loud "Call the vet about Pepper's shots" --target chat:new --context todo:pets/pepper-shots
description: Reminder the boxholder asked for on 2026-09-26
```

At fire time the scheduler runs the command. No agent runs. Tapping opens
a new chat whose first message is the reminder and its context, so "done"
or "push it a week" is one message to an agent that then has the todo in
hand. **Boxholder:** this is a schedule and should be streamlined.

### 3. Notify when a condition becomes true, with no agent

A watch card. The agent writes a natural-language yes/no criterion and
names the stream of items to test it against. Code evaluates it on every
new item with Jev. When the probability clears the threshold, the watch
fires its action. No agent runs unless the action asks for one.

```yaml
# _config/watches/field-trip.watch.card
on: new-card
under: _content/inbox/
criteria: "This is an email from the school about the spring field trip: dates, permission form, or payment."
threshold: 0.8
then: notify --loud "School field trip email arrived" --target card:$item
until: 2026-11-01
once: true
```

`then` is either `notify ...` (deterministic, the item is the target) or
`run <command>` (an agent step, for when the notification text or the
next action needs judgment). A watch with `once: false` fires per matching
item. The evaluation runs where new cards are already noticed: after
connector sync and at finalize, over cards added since the watch's cursor,
so it is deterministic and replayable. A watch that never fires expires
quietly at `until`; the agent that set it is told in its next run, not the
person.

Jev's `Noul` question type (probability that a yes/no condition holds) is
the fit. The service today exposes only `Choice`
(`src/services/jev.ts:4`); adding `Noul` is part of the plan.

**Boxholder:** it is up to the agent to design the system: poll, keep
pushing a todo out until it is ready, or set a trigger. The pieces have to
make all three cheap.

### 4. Run an agent on a schedule, which may notify

This exists. A scheduled script runs `bbx procedure run` or a script; the
agent inside has piece 1 available and the briefing tells it when to use
it. Nothing new except the availability and the guidance.

### 5. The briefing section

A standard part of every box briefing, because when to interrupt the
person is a consideration in most agent work, not a feature. Proposed
default text the boxholder edits in their own words:

> **Reaching me.** Notify me when something failed or you could not
> understand what I gave you. Do not notify me that routine work succeeded.
> A question for me is a dot unless it blocks something with a date. Things
> I asked to be told about are loud. Health problems stay on the health
> page unless they stop something I asked for. Never notify between 22:00
> and 07:00 unless I said loud. When I ask for a reminder, set it with
> `bbx remind`; when I ask to be told when something happens, set a watch.

The agent guide gains the matching mechanics section: the three commands,
the loudness words, targets, and that the briefing owns the policy.

## The stories, with rulings and worked examples

### S1. Capture and pocket the phone

You snap a receipt in the app, lock the phone, and the agent files it later.

**Boxholder:** no notification when it worked; be confident it worked. Notify
when it did not work, including utterly confusing input. Some captures are
important enough that after analysis they warrant a notification, and the
briefing says which.

Worked example. The capture agent finishes triage. Nothing to send. On a
photo it cannot read:

```
bbx notify --quiet "I could not make out the capture from 14:02" \
  --body "The photo is too blurry to read. Send it again or tell me what it was." \
  --target chat:2026-09-26-capture-14-02
```

`quiet` because the person has left and failure should not vanish, but it is
not urgent. Tapping opens the capture's chat with the photo in it.

### S2. A reminder you asked for

"Remind me Thursday morning to call the vet."

**Boxholder:** a schedule, streamlined, and easily a notification.

Worked example: piece 2 above. The agent also links the reminder to a todo
if one exists, so that tapping lands in a chat that already knows the todo
and can close it.

### S3. Watch for something

"Tell me when the school emails about the field trip."

**Boxholder:** yes. The agent designs the mechanism.

Three designs the agent can pick between, all with the pieces above:

- **Trigger.** The watch card in piece 3. Best when the signal is a new
  item in a stream: mail, a calendar change, a captured document.
- **Poll.** A scheduled script every morning that runs a small procedure
  ("check the school portal for the permission form") and notifies on
  change. Best when the source is outside the box.
- **Rolling todo.** A todo with a `recheck` date the review job keeps
  pushing out until the condition is met, then a notify. Best when the
  condition is about the person's own cards.

The watch is the new piece. The other two exist.

### S4. Something finished after you left

You asked in chat, it took a while, you closed the app.

**Boxholder:** a notification dot on the app.

Worked example. The chat engine, not the agent, marks the reply unread and
sends a `dot` to the paired phones when no live session shows that chat.
The reply carries no push text. The app icon shows a count; opening the app
shows the chat marked unread; opening the chat clears both. The agent does
nothing. This is the first end-to-end target because it needs APNs, the
badge, presence, and unread, and it needs no policy.

### S5. The agent needs an answer

Triage hits a decision it cannot make and writes a question card.

**Boxholder:** a dot, unless the urgency says otherwise.

Worked example. The existing question sweep (`src/core/question-alert.ts`)
sends `dot` by default. A question card gains an optional `urgency` the
agent sets when the question blocks something with a date; the sweep sends
`quiet` for those. The briefing tells the agent when to set it. The
existing pending-question badge and the app icon badge count the same
thing.

### S6. The morning summary

**Boxholder:** only if the person wanted it. Not a default.

Worked example. The person asks for it in chat. The agent writes a
scheduled script at 07:30 that runs a summary procedure; the procedure
ends with `bbx notify --quiet "Your Tuesday" --body "<summary>" --target
card:$summary`, and skips the notify when there is nothing actionable.
Nothing in the box turns this on by itself.

### S7. Health, demoted

Auth expired, a connector went quiet, the box cannot push.

**Boxholder:** correct that these stay in the app unless they block
something meant to be proactive.

Worked example. The existing health alerts change from `notifyBoxholder`
with `severity: alert` to a health-page entry and a `dot`. The promotion
rule lives in one place: when a scheduled script or watch fails or skips
because of a health condition (`requires.connectors` unmet,
`invalid_grant`, engine quota), that failure sends `loud` with the fix link
and names what it blocked: "Your field-trip watch cannot read mail: Google
needs reconnecting." Once per episode, as today.

### S8. "Look at this, I made it for you"

After a discussion the agent builds a page or a draft.

**Boxholder:** can be a notification, per the briefing.

Worked example.

```
bbx notify --quiet "The kitchen budget page is ready" \
  --body "Three options, with the contractor quotes side by side." \
  --target card:projects/kitchen/budget
```

The agent decides on `quiet` versus `loud` from the briefing and the
conversation. If the person is still in the chat that asked for it, presence
makes it an in-app reply only.

## The phone channel

The paired iPhone app gets APNs. The device record from pairing holds the
token; the server sends through the existing output-card path with a new
`apns` connector beside `push` and `telegram`. `dot` sends a badge-only
push, `quiet` a passive one, `loud` an active one. Web push stays for the
desktop, activated by setting the VAPID keys. Telegram is unchanged. The
web push connector's endpoint-keyed store and prune-on-410 pattern
(`docs/implemented-plans/web-push-notifications.md`, Track B) is the model
for the APNs store.

Verification the boxholder can run: pair a phone against a box, send
`bbx notify --loud "test" --target chat:new`, see the banner, tap it, land
in the chat. Then S4 for real. APNs delivery needs a real device and the
boxholder's Apple credentials; the simulator covers everything up to the
send.

## Open questions

1. **Reminder target.** Piece 2 opens a new chat seeded with the reminder.
   The alternative is the todo card itself with a reply box. A chat lets the
   person answer in one message; a card is where the todo lives. Lean: chat,
   because the person is on a phone and will type one line.
2. **Who evaluates watches.** After connector sync and at finalize covers
   mail and captures. A watch on a calendar change or on a card edited by the
   person needs an evaluation on card write. Lean: start with the sync and
   finalize points and add card-write later.
3. **Jev cost and quota.** A watch runs one Jev call per new item per watch.
   Ten watches and a hundred mails a day is a thousand calls. The plan needs
   the real per-call cost and a per-box daily cap that degrades to "evaluate
   at the next agent run" rather than dropping items.
4. **Unread on replies.** S4 needs an unread state on chat replies. Today no
   such state exists. The plan has to decide whether unread lives on the
   session record or as a separate per-device read cursor. Lean: per-box
   read cursor per session, since one boxholder reads from two devices.
5. **Quiet hours.** In the briefing as text, or a field the dispatcher
   enforces. Lean: both; the field is the floor, the briefing can be
   stricter. A `loud` inside quiet hours is held until they end unless the
   agent says `--now`.

## Walkthroughs (2026-09-26, after the plan's third draft)

Each scenario traced hop by hop through the plan's mechanism, against the
code as it is. "Leaves behind" says what persists and where. Problems found
are marked **found** and are folded into the plan.

### W1. "Remind me Thursday morning to call the vet"

1. In chat, the agent writes
   `_config/schedules/remind-vet-2026-10-02.scheduled-script.card` with
   `at`, `once: true`, `requested-by: boxholder`, `notify: { title, loudness:
   loud, target: chat:new, context: pets/pepper-shots.todo.card }` and
   commits it. One commit: the rule. The agent replies "Set for Thursday
   8:30."
   **Found:** before promising, the agent must know a channel exists. Today
   nothing tells it. `notifyChannels` exists in code; the agent guide and
   a `bbx notify --check` must make it the first step, or the calendar-promise
   bug repeats with reminders.
2. Thursday 08:30 the scheduler daemon runs the tick in process
   (`src/core/schedule/scheduler.ts:250` calls `runTick`), finds the card
   due, and calls `notifyBoxholder` in that process. `loud` tries every
   channel with an audience. APNs sends to the phone; web push to the
   desktop. The intent and both deliveries are appended to
   `.beebox/notifications.jsonl`; a bus event lets an open app show it.
   The tick records success, deletes the card, and commits. Second commit:
   the fire. Git has both ends of the reminder.
   **Found:** the plan had the bus as the record. The server prunes the bus
   at 24 hours (`src/webapp/server.ts:244`), so it is a live signal only.
   The record is the JSONL log.
3. Phone: banner with the title. Tap opens
   `/<box>/chat?new=1&notification=<id>`. The chat page fetches the intent by
   id (a new `notifications.get` query over the log), shows it as a banner
   with the context link, empty composer. "done" goes to the agent with the
   reminder as context; the agent closes the todo.
   Feels right. Tapping twice makes two sessions; acceptable.
4. Nobody paired, nobody subscribed, no Telegram: the log records
   `no-audience` for every channel and the dashboard health check "1
   notification had nowhere to go" shows the title. The person learns when
   they next open the app. Step 1's check is what prevents this.

**Leaves behind:** two commits; one log line plus deliveries; nothing else.

### W2. "Tell me when the school emails about the field trip"

1. The agent checks that the Gmail connector is configured, then writes
   `_config/watches/field-trip.watch.card`: `under: _content/inbox/`,
   `criteria`, `threshold`, `then: { notify: { title, loudness: loud } }`,
   `once: true`, `until`, `requires: { connectors: [gmail] }`. Commits.
   **Found:** a watch must declare its connector. Without `requires`, a
   Gmail grant that expires means no new cards, and the watch waits forever
   with nothing wrong to report. With it, the promotion rule can say "your
   field-trip watch cannot see mail".
2. Each wakeup: the reactor runs sync, then jobs, then finalize
   (`src/core/reactor/engine.ts:2-14`). Gmail writes cards under
   `_content/inbox/email/` and commits. Triage, in the jobs phase, renames
   them into `inbox/triaged/<category>/` (`src/core/triage/routing.ts:74`).
   Finalize evaluates watches: lock, cursor commit to HEAD tree diff under
   `_content/inbox/` with filter A, one Jev call per new card with the card
   text as state.
   **Found:** because finalize runs after triage, the diff sees the card at
   its post-triage path, which is what the notification should target. But
   a card triaged in a later cycle moves after the notification was sent,
   and the tapped target 404s. Targets are paths, and the box moves cards.
   The plan accepts this for v1 and notes it; a stable card id is a
   separate problem the box does not have today.
3. Fire: `loud` to the phone with the title; tap opens the card page. The
   watch sets `enabled: false` and `fired-at`, and commits with the item
   path in the message. Git has the rule and the fire.
4. Cost: ten new mails a day and one watch is ten Noul calls a day, each a
   few thousand input tokens, under a cent a month.

**Leaves behind:** two commits; a cursor in `.beebox/watches.json`; one log
line.

### W3. Something finished after you left

1. The chat turn ends. The server already parses `<schedule>` tags from the
   response at that point (`src/webapp/routes/chat.ts:125-138`); callouts
   are parsed beside them. The in-memory presence count for the box is
   zero.
2. One intent per turn: body is the first callout, `tag` is the session id
   so a second turn replaces rather than stacks. Loudness is the highest
   any callout asked for, else `dot`.
3. `dot` sends a badge-only APNs push. The icon shows 1. Opening the app
   clears it and shows the last chat, where the reply is. No unread mark;
   accepted.
   **Found:** the plan sent `dot` regardless of presence. If the person is
   in the app on the desktop, every reply badges the phone, and the badge
   sits there until the phone app is foregrounded. Presence suppresses
   `dot` too; only `loud` ignores presence.

**Leaves behind:** nothing in git beyond the chat transcript; one log line.

### W4. A question needs an answer

Finalize's sweep finds a newly pending question: `dot`, or `quiet` when the
card carries `urgency: time-bound`. Tap opens the question with its answer
buttons. Same presence rule as W3. Feels right and is nearly what exists.

### W5. A capture the agent could not read

The capture agent is an agent; it runs `bbx notify --loudness quiet
--target chat:<session> "I could not make out the capture from 14:02"
--body-file /tmp/why`. Presence zero, phone gets a passive banner; tap
opens the capture chat with the photo.
**Found:** a body composed by an agent does not belong on a shell command
line. `bbx notify` takes `--body-file` or stdin.

### W6. The morning summary, if asked for

Cron 07:30 schedule card with `runs: bbx procedure run morning-summary`.
The procedure's first step: precheck `shells` gather calendar and due
todos, `judge` asks "Is there anything actionable today?". Below
threshold: skip, the run dir is removed (`src/core/procedure/engine-orchestrate.ts:109`),
the schedule records `deferred`, nothing in git. Above: an `agents` step
writes the summary card and runs `bbx notify --target card:<summary>
--body-file`. The run card is committed as procedures do today.
Feels right; the deferred outcome makes a daily cron that usually does
nothing cost nothing and leave nothing.

### W7. Google auth expired on Monday

The dashboard shows the health entry. Nothing notifies. Thursday's reminder
does not need Google; it fires. The field-trip watch declares `gmail`;
the connector's activity record shows the failing episode
(`src/core/schedule/connector-activity-alert.ts:40` already tracks it), so
the promotion rule sends `loud` once: "Your field-trip watch cannot see
mail: Google needs reconnecting", target `dashboard`. Reconnect clears the
episode. Feels right: the person hears about health exactly when it costs
them something they asked for.

### W8. "Look at this, I made it for you"

In chat, the turn ends with `<callout loudness="quiet" context="you asked
for a kitchen budget">The kitchen budget page is ready.</callout>`; W3's
path delivers it if the person has left. From a procedure, `bbx notify
--target card:projects/kitchen/budget`. Feels right.

### W9. Cheap polling until something is true

"Tell me when the contractor's quote is in the shared folder." A cron
schedule every two hours runs a procedure whose precheck lists the folder
and judges "Is there a quote from the contractor here?". Deferred, deferred,
deferred, then fires: the step notifies, `once` deletes the schedule. Only
the firing run leaves a run card. Health shows `waiting: judge 0.2`
between. Feels right, and it is the same shape as W2 without a per-item
cursor. Two ways to watch remain: per new item (watch card) and per
snapshot (cron plus judge). The plan keeps both and the guide says which
is which; if the second covers the first in practice, the watch card is
dropped before shipping.

### What the walk changed in the plan

- The record is `.beebox/notifications.jsonl`, not the bus; the bus is the
  live signal only. No per-channel cursor, no finalize retry: one attempt
  at emit time, then the log and a health check.
- Presence suppresses `dot` and `quiet`; only `loud` ignores it.
- Watches declare `requires.connectors`; the promotion rule covers them.
- `bbx notify --check` and the agent guide's "check before promising".
- `bbx notify --body-file` and stdin.
- Card-path targets can go stale when triage moves a card; accepted for
  v1 and written down.
- Health "entries" are computed checks over these files, not a store.
- An in-app banner component is new work; no toast exists today.

### Addendum, later on 2026-09-26: the watch card is gone

The boxholder: a check like "is the quote in the folder" should not even
call Jev when nothing happened, and "the git log since the last call" is
the pattern to support and suggest. That is the watch card's cursor, moved
onto the schedule where every scheduled thing can use it. W2 and W9 become
one pattern: a schedule card (`on-wakeup` or `cron`, `once`, `requires`)
running a procedure whose precheck is `bbx changes --match <glob> --or-skip`
followed by a judge, per item for a stream or over the state for a
snapshot. No new card type. The plan's Track D has both worked examples.

### Addendum, later still: the judge is a command and the prompt is a card

The boxholder: the judge should not be hard-coded to one question and one
rule; prompts for Jev are something to learn and iterate on; paths, not
names; the schedule should know its last commit and time and have a spot
to carry one value forward. So: `bbx judge <card-path>` reads a `judgment`
card (questions in frontmatter, instructions in the body, state on
stdin), prints answers, and applies a basic filter; `bbx changes` lists
what changed since the schedule's last run, with the env variables as
defaults it can override; a schedule's `runs:` is a pipeline of the two
plus `bbx notify`, and a pipeline that skips is the scheduler's deferred.
A procedure is for several steps or an agent. The plan's Track D has both
pipelines.
