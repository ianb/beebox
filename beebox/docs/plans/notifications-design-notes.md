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
