# Notifications

How a box reaches the boxholder when they are not looking: one notification
now, a reminder at a time, and a watch that fires when something in the box
changes. Design history: [the plan](plans/notifications.md) and its
[design notes](plans/notifications-design-notes.md).

## What it is

Everything that tells the person something goes through one function,
`notifyBoxholder` (`src/core/notify-boxholder.ts`), and one command for agents,
`bbx notify`. When and how loud is policy, and the policy lives in the box: the
root briefing's "Reaching me" section, which a new box's briefing template
carries (`REACHING_ME_DEFAULT`, `src/schemas/briefing.tsx`). The agent guide's
`REACHING_THE_BOXHOLDER` section (`src/core/agent-guide/reaching.ts`) teaches
the mechanics and quotes the default for boxes whose briefing has no such
section.

Vocabulary:

- **Intent.** One attempt to reach the person: title, body, target, loudness,
  an optional tag (a later intent with the same tag replaces it), and the
  source that wrote it. A TypeScript type (`src/core/notification/intent.ts`)
  and one log line. Never a card.
- **Loudness.** `dot`, `quiet`, or `loud`: a badge only; a muted
  notification; a notification with sound. In an open app, `quiet` and `loud`
  show a banner and `dot` shows nothing.
- **Target.** Where a tap lands: `chat:<sessionId>`, `chat:new`,
  `card:<path>`, `question:<path>`, `admin:<section>`, `dashboard`. One parser
  (`target.ts`) renders it as each channel's link.
- **Channel.** A way to deliver: `apns` (the iPhone app), `web-push`
  (browsers), `telegram`. Each has a real and a fake service and an audience.
- **Presence.** How many web sessions for this box had a person interacting
  in the last two minutes, from a client heartbeat, in `.beebox/presence.json`.
  A missing or stale file counts as nobody present, so an error falls toward
  sending.
- **Log.** `.beebox/notifications.jsonl`: one line per intent and one per
  delivery attempt (`sent`, `skipped` with `present`, `no-audience`, or
  `unconfigured`, or `failed`). The record the Admin Notifications section,
  the `chat:new` banner, and the health checks read.

## How it works

### Channels

`channelsToTry` (`src/core/notification/channels.ts`) is the whole rule:

| Loudness | iPhone (`apns`) | Browser (`web-push`) | Telegram | While a person is present |
|---|---|---|---|---|
| `dot` | badge | not tried | not tried | still badges |
| `quiet` | passive banner | muted notification | message without sound | nothing sent; the open app shows it |
| `loud` | banner with sound | notification | message | sent anyway |

A channel with nobody to reach is `skipped: no-audience`; one whose server keys
are missing is `skipped: unconfigured`. A caller that knows its target is on
screen passes `onScreen` to `notifyBoxholder`: a `quiet` or `loud` intent is
then `skipped: present` on every channel, and a `dot` still badges.

### Sources

- **`bbx notify`** (`src/cli/commands/notify.ts`): an agent's call. From a
  box-spawned shell it goes through the box server; otherwise it runs in
  process. `--check` sends nothing and exits 1 when no channel can reach the
  person; agents run it before promising a reminder or a watch.
- **Callouts.** `<callout loudness="quiet|loud">` in a chat turn becomes one
  intent at turn end, targeted at that chat, tagged with the session so a later
  turn replaces it (`src/core/chat/callout-tags.ts`). A callout needs a
  `context` and a body; with no `loudness` it is a `dot`. While a web session
  is present the callout is on screen, so even a `loud` one is not pushed.
- **Questions.** The question sweep sends a `dot`; a question with
  `urgency: time-bound` sends `quiet`. The aging nudge is `quiet` by design: a
  question unanswered for a week gets one quiet push before it expires, the one
  exception to "a question is a dot unless time-bound".
- **Capture failure.** A capture that fails for good sends `quiet` to its chat
  when nobody is present.
- **Health** never notifies on its own: failing syncs, expired auth, and
  failing schedules are health checks on the dashboard. The one exception is
  promotion, below.

### Reminders: `notify:` schedule cards

A scheduled-script card with `notify:` in place of `runs:` is a reminder
(`src/schemas/scheduled-script.tsx`; the card instructions have the example).
`bbx tick` calls `notifyBoxholder` in process: no agent and no shell. With
`at` and `once: true`, the card deletes itself after it fires. The chat's
`<schedule>` tag is a different thing: it comes back to one conversation
within hours ([chat timers](chat/schedules.md)).

### Watches: schedule memory, `bbx changes`, `bbx judge`

- **Memory** (`src/core/schedule/memory.ts`). Schedule state keeps
  `lastCommit` (the box HEAD at this schedule's last run) and `carry` (one
  value up to 4 KB). A `runs:` command sees `BBX_SINCE_COMMIT`,
  `BBX_SINCE_TIME`, `BBX_CARRY_IN`, and the writable paths `BBX_CARRY_OUT` and
  `BBX_DEFER_FILE`. Before a schedule's first run, `lastCommit` is set to HEAD,
  so the first run sees no changes.
- **`bbx changes`** prints the cards added or modified under `--match` globs
  since `$BBX_SINCE_COMMIT`, from a tree diff, so a card moved during the
  window appears once at its final path. `--cat` prints each card after a
  `=== <path>` line; `--or-skip` defers when nothing changed.
- **Judgment card and `bbx judge`.** A `<name>.judgment.card` is a prompt for
  Jev, a small judging model: named `noul`, `choice`, or `score` questions and
  instructions, with the situation (by default the root briefing's purpose)
  prepended. `bbx judge <card>` sends stdin as the state and applies a basic
  decision (`--min`, `--choice`, `--decide`); `--echo` passes stdin on to an
  agent, `--select` prints the inputs that passed. A daily cap of 500 calls
  per box lives in `.beebox/jev-budget.json`. The card instructions
  (`src/schemas/judgment-instructions.ts`) are the guide to writing one.
- **Composition.** When the notification text is fixed, `runs:` is one
  pipeline ending in `bbx notify`. When an agent must write it, `runs:` is
  `bbx procedure run <name>`, the procedure's precheck is the `changes | judge`
  pipeline with `pass-output: true`, and its agent step ends with `bbx notify`.

### Deferred, and the cursor rule

A command with nothing to do writes `{ "reason" }` to `$BBX_DEFER_FILE` and
exits 75. The tick records `deferred` with that reason (`bbx health`:
`waiting: <reason>`); exit 75 with no marker is a failure. The first marker of
a run wins. `bbx procedure run` exits 75 when every precheck skipped, and
writes `no-change` when no inner command wrote a marker. `once` deletes a card
only after `success`, so "run until it fires" is `on-wakeup` or `cron` plus
`once`.

| Reason | Written by | Cursor (`lastCommit`) |
|---|---|---|
| `no-change` | `bbx changes --or-skip`; a procedure whose prechecks all skipped | advances |
| `no-pass` | `bbx judge --or-skip` | advances |
| `budget`, `jev-unavailable`, `unconfigured` | `bbx judge` | held, so the items are seen again |

A failure also holds the cursor; a schedule that keeps failing shows as
`failing` in health.

### Promotion

A schedule with `requested-by: boxholder` that cannot run says so once per
episode, `loud` (`src/core/schedule/promotion.ts`): the tick held it back (a
missing connector, engine quota), a connector it requires is in a failing
episode, or its judge has no Jev key. A schedule the box set up for itself
never promotes.

### In git and transient

| In git (the rule) | Transient, gitignored (`.beebox/`) |
|---|---|
| Schedule cards with `notify:` or `runs:` | `notifications.jsonl`: rotated to `notifications.1.jsonl` at finalize when older than 30 days or over 8 MB |
| Judgment cards | Schedule state: `lastCommit`, `carry`, `lastDeferReason`, `skipped` |
| Procedure cards | `presence.json` |
| The briefing's "Reaching me" section | `jev-budget.json`, `jev-debug.log` (every Jev call and its answers) |
| | `mobile-devices.secret.json` (paired phones and their APNs registration) |

## Running it

### Testing without a device

- `BBX_NOTIFY_FAKE=1` routes every channel to its fake with a synthetic
  audience; the log records `sent (fake)`.
- `bbx notify --dry-run` prints the intent, the audience per channel, the
  presence reading, and the channels a send would try, and sends and logs
  nothing; `--presence <n>` overrides the reading.
- `bbx pairing register-fake-push <label>` pairs a stand-in phone with a fake
  APNs token (dev boxes only).
- `BBX_JEV_FAKE=1` (yes) or `=0` (no) answers every judgment with no key;
  `bbx judge --dry-run` prints the exact request, and `--replay <file>` runs a
  card against a saved state.
- The probes: the log, Admin → Notifications (recent list and phones),
  `bbx health`, and `.beebox/jev-debug.log`.

### Server setup

The VAPID keypair and the APNs key are server-wide `.env` entries; the steps
are in [server configuration](server/configuration.md#web-push-vapid-keys). The
hub passes both sets of variables to every box server (`src/hub/child-env.ts`).
The iOS app target needs the Push Notifications capability in Xcode; a Debug
build registers for the APNs sandbox and a Release build for production
([mobile contract §5.9](mobile-contract.md)).

### Verification walk

Run on a real device after the server setup, on a box whose briefing has a
"Reaching me" section.

1. Pair the phone and open the app; Admin → Notifications → Phones lists it
   with its environment.
2. `bbx notify --check` names `apns` as reachable. `bbx notify --loudness loud
   --target dashboard "Walk: loud"` arrives with sound; tap it and land on the
   dashboard. Repeat with `quiet` (no sound) and `dot` (badge only).
3. Write a schedule card with `at` two minutes out, `once: true`, and
   `notify:`; it arrives on time and the card is gone.
4. Set up the field-trip watch: the schedule and procedure cards from the
   agent guide's example (`src/core/agent-guide/reaching.ts`), and this
   judgment card, from the judgment card instructions
   (`src/schemas/judgment-instructions.ts`):

   ```yaml
   # _config/judgments/field-trip.judgment.card
   questions:
     trip:
       type: noul
       criteria:
         true: "At least one of these emails is from the school about the spring field trip: dates, permission form, or payment."
         false: "None is; a newsletter that mentions the school, or a receipt, does not count."
   ---
   You are looking at the email cards that arrived in a family inbox since
   the last check, concatenated. Judge only what the emails say.
   ```

   Mail yourself a test message about the trip; after the next wakeup the
   notification names the trip and its tap opens the email card. A second
   wakeup with no new mail shows `waiting: nothing to do` in `bbx health`.
5. Set up the fixed-text quote watch from the scheduled-script card
   instructions over a mounted folder; drop a file in and see one loud
   notification.
6. Save a test email card to a file and run
   `bbx judge _config/judgments/field-trip.judgment.card --replay <file>`;
   tune the criteria until the answer is clear.

## Failure modes

- **Nothing arrives.** `bbx notify --dry-run` shows which channels were
  skipped and why; the `notifications-no-channel` health check counts intents
  no channel could carry in the last 24 hours.
- **A channel failed.** `notifications-undelivered` counts failed deliveries;
  the log line has the error. When APNs rejects a phone's token, the server
  deletes that registration; the app's next launch restores it.
- **The log cannot be written.** `notification-log-writable` fails; delivery
  still goes ahead, with an error on the server's console, so the Admin list
  and the other checks miss those notifications.
- **A watch never fires.** `bbx health` shows the schedule `waiting` with its
  reason, or `failing`. `jev-budget` counts runs deferred for the budget.
