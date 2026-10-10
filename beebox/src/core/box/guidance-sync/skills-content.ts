/**
 * Content for the managed box skills installed by `generateSkills`
 * (box-skills.ts). Kept separate so the provisioning logic stays small and the
 * skill prose reads on its own. Authored as escaped-backtick template literals,
 * the same pattern as schema `instructions`.
 *
 * A plugin's skill lives with the plugin (`src/plugins/<name>/skill.ts`), not here.
 */

import { BOX_PACKAGE_DOCS } from "../../docs-gen/shared.js";

/**
 * The `calendar` skill: authoring `.ics` events for two-way Google Calendar
 * sync. A static constant: the box's timezone is referenced by the `BOX_TZ`
 * placeholder (already on the `Timezone:` line in the agent's system context),
 * and the box-specific VTIMEZONE block is fetched at author time with
 * `bbx calendar vtimezone` rather than baked in (hand-writing DST rules is
 * exactly the error this prevents).
 */
export const CALENDAR_SKILL = `---
name: calendar
description: Work with the box's calendar — view, create, edit, or delete Google Calendar events by authoring .ics files in _content/calendar/. Use when scheduling, adding/changing/removing an event, setting up a meeting or appointment, or any task that touches the box's calendar.
---

# Calendar

Calendar events live as \`.ics\` files in \`_content/calendar/\`. Sync with Google Calendar is **two-way**:

- **View events:** \`bbx calendar\` shows upcoming events (\`bbx calendar today\`, \`bbx calendar 2w\`, …).
- **Create an event:** write a new \`.ics\` file in \`_content/calendar/\`. The next sync pushes it to Google Calendar.
  - Include \`X-BBX-CALENDAR-ID:<calendar-id>\` to target a specific calendar (defaults to primary).
  - Optionally include \`X-BBX-REASON:<why>\` and \`X-BBX-REF:<path>\` for tracking.
- **Edit an event:** modify a tracked \`.ics\` file directly. The next sync pushes the changes.
- **Delete an event:** add an \`X-BBX-DELETE:<reason>\` property to a tracked \`.ics\` file. The next sync deletes it from Google Calendar.
- **\`_content/calendar/stranded/\`** holds edits Google would never take (the event was deleted there, or the push failed for a week). They are not synced. Move a file back up into \`_content/calendar/\` to push it as a new event, or delete it.

**Timezone requirement:** non-all-day events MUST include a VTIMEZONE component and a TZID parameter on DTSTART/DTEND. Never create floating-time events — they'll be rejected.

- \`BOX_TZ\` in the example below is this box's timezone — it's on the \`Timezone:\` line already in your system context (or run \`bbx calendar vtimezone\`, which prints it). Substitute it wherever \`BOX_TZ\` appears.
- Get the box's exact VTIMEZONE block by running \`bbx calendar vtimezone\` and paste it verbatim into the VCALENDAR (hand-writing DST rules is error-prone).

Example minimal \`.ics\` for a new event:

\`\`\`
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Bee Box//EN
<paste the output of \`bbx calendar vtimezone\` here>
BEGIN:VEVENT
UID:unique-id-here
SUMMARY:Dentist appointment
DTSTART;TZID=BOX_TZ:20260401T140000
DTEND;TZID=BOX_TZ:20260401T150000
X-BBX-REASON:confirmed in the reschedule email
X-BBX-REF:/_bookkeeping/archive/Dentist_Reschedule.email-message.card
END:VEVENT
END:VCALENDAR
\`\`\`
`;

/** The `drive` skill: reading/editing/syncing Google Drive sheets and docs. */
export const DRIVE_SKILL = `---
name: drive
description: Work with Google Drive content in the box — mirror a folder, sync a spreadsheet (.gsheet.card) or document (.gdoc.card), or keep a pointer to a file. Use when a task involves a Drive link, a Drive-synced file, or bbx drive commands.
---

# Google Drive

## Three kinds of Drive card

- **Pointer** (\`.glink.card\`) — "this Drive item exists, here is where, here is what it's for." Nothing is copied. \`title\` and \`drive:\` (\`id\`, \`link\`, \`mime\`) are connector-stamped; the body is yours for purpose notes.
- **Synced file** (\`.gdoc.card\`, \`.gsheet.card\`) — content mirrored **two-way**, kept in the card's attach scope (\`<basename>.attach/\`). \`bbx mv\` moves the card and everything with it; the \`drive.id\` keeps the upstream link. Don't move the pieces by hand.
- **Mirrored folder** (\`.gfolder.card\`) — the directory the card sits in mirrors the Drive folder. Docs and Sheets become synced files, subfolders become subdirectories with their own folder card, and **every other child becomes a pointer** — a PDF, a Slides deck, an image is never copied.

## Setting one up: the boxholder pastes a Drive link in chat

That is the normal path (the settings page is the other one). Use \`bbx drive list <folder-url>\` to see what a folder holds before mirroring it, then:

- "mirror this" / "keep this folder in the box" → \`bbx drive mount <folder-url> <dir>\`. **There is no default directory** — propose one that fits how the box is organized and say why; if you can't tell where it belongs, ask.
- "keep a pointer to this" / "just remember this exists" → \`bbx drive link <url> <path>\`
- one Doc or Sheet, synced two-way → \`bbx drive add <url> <path>\`

## The directory IS the mount

There is no config file — the folder card's own location is the configuration. \`bbx mv\` on the card re-homes the mirror: the next sync mirrors into its new directory and the children left behind stay as ordinary cards. Move the whole *directory* and the mount travels with its children, which is usually what you want.

- **Unmount:** \`bbx drive unmount <dir-or-card>\`. Discovery stops; every child stays exactly where it is, synced ones still syncing. Nothing is deleted.
- **Stop one file:** \`bbx rm <card-path>\` — the card and attach scope move to \`_bookkeeping/trash/\`, a durable tombstone a mirror will not undo. Restore from trash, or \`bbx drive add\` again, to resume. A child **trashed on Drive** lands there too, and the sync says so; a child *moved out* of the folder is left alone and keeps syncing.

## Inside a synced file

- **Sheet tabs:** each tab is a JSON file in the attach scope, referenced from the card. Plain cells are bare values; formula cells are \`{"f": "=SUM(A1:B1)", "v": "$42.00"}\` — formula and computed result. Edit the JSON (for a formula cell, the \`f\` field) and commit; the next sync pushes it.
- **Doc body:** markdown at \`attach/<basename>.md\`. Edit it and commit, and the next sync converts and pushes it.
- **Comments:** a \`<basename>.comments.json\` sidecar in the attach scope holds the full threads (author, timestamps, resolved status, anchored text, replies), read-only. Editing and pushing a Doc's \`.md\` does NOT write comments back upstream — a push may even orphan the upstream anchors.
- **Lossy content:** a Doc card's \`lossy:\` frontmatter lists upstream features that don't survive markdown export (footnotes, embedded images, equations, suggestions, complex tables). When it's non-empty, pushing local edits will destroy them — surface the loss before encouraging a push.
- **Conflicts:** when both sides changed, the card gets \`conflict: true\` and the upstream content is written to \`attach/<basename>.remote.md\`. Merge the two, delete \`.remote.md\`, commit.

Also: \`bbx drive inspect <url>\` (preview one item), \`bbx drive sync\` (all Drive cards), \`bbx drive status\` (what this box has mounted).
`;

/**
 * The `email` skill: the doorway from "email someone" to an email-outbound
 * card. The field-level reference (headers, threading, lifecycle) lives in the
 * email-outbound schema's own instructions, which load via the card rule when
 * the card exists — this skill covers the intent, where the card goes, and how
 * to write it, then hands off.
 */
export const EMAIL_SKILL = `---
name: email
description: Draft or reply to an email for the user to review and send. Use when asked to email someone, reply to a message, follow up by email, or send anything that isn't a chat or Telegram reply.
---

# Email

You don't send email directly — you **draft** it, and the user reviews and sends. A draft is an \`email-outbound\` card; the Gmail connector picks it up on the next sync and creates a Gmail draft.

## Create the draft

- **Replying** to a thread: put the draft inside that thread's attach scope, beside the message you're answering — e.g. \`_content/inbox/email/<thread>.attach/draft-001.email-outbound.card\` — and set \`in-reply-to.ref:\` to the source \`.email-message.card\` (a path relative to the draft, usually just the sibling filename) so Gmail threads it correctly.
- **A new email** (no thread): a fresh card under \`_content/inbox/email/\`.

\`bbx create <path> -t email-outbound\` scaffolds one. The field details — required headers, threading, lifecycle — are in the \`email-outbound\` card's own instructions, which load when you create or open it. Follow them.

## How to write it

- It's a draft on purpose: the user has the last word before anything leaves the box. Compose the *whole* message — don't hand them a half-written stub to finish.
- Match the user's voice and their relationship to the recipient (read the person card if there is one). A note to a sibling isn't a note to a landlord.
- Only real recipients — never invent an address. If you don't have one, say so or raise a question card.

If the user only wants to *know* about an email they received, that's \`bbx search --kind email-message\`, not a draft.
`;

/**
 * The `location` skill: the box's on-demand location surface (reading the
 * user's shared device location + teaching named places). Moved out of the
 * always-loaded guide — location never appears in context automatically, so
 * an agent only needs this when a task actually turns on where the user is.
 */
export const LOCATION_SKILL = `---
name: location
description: Find where the user is, or teach the box a named place (Home, Office). Use when a task needs the user's current whereabouts, or to record or recognize a location by name.
---

# User location

The boxholder can share their device location from the web UI. It is **on-demand only** — it never appears in your context automatically, so query it when the conversation needs it. It comes from the browser, so it stays \`unknown\` on Telegram and other channels.

- **Read it:** \`bbx location get\` prints the last-known fix as \`lat,lng (±accuracy, captured <age> ago, web)\`, prefixed with the place name (\`Home — …\`) when the fix is inside a known place. Add \`--json\` for structured output (\`place\`, \`lat\`, \`lng\`, \`accuracy\`, \`capturedAt\`, \`ageMs\`, \`stale\`).
- **Not shared:** prints \`unknown\` when the boxholder hasn't shared location. Don't guess or fabricate a location — report that it's unknown.
- **Staleness:** an old fix is flagged \`[stale]\` (and \`stale: true\` in JSON); treat it as approximate.

## Named places

Place cards (\`places/<Name>.place.card\`) let the box recognize a location by name — so \`bbx location get\` can say "Home" instead of bare coordinates.

- **Record a place (card first, then mark):** create the card describing the place — \`bbx create places/Home.place.card name=Home address="…"\` — with a body explaining what it is and why it matters. Then, while the boxholder is physically there, run \`bbx location mark places/Home.place.card\` to stamp the current location into it. Don't hand-type \`lat\`/\`lng\` — \`mark\` writes them from the live fix and reports the fix's age so you can judge whether it's current.
- **Outside the radius:** if the boxholder is now outside a place's radius, \`mark\` won't change it; re-run with \`--expand\` to grow the radius to include the new spot.
`;

/**
 * The `schedules` skill: authoring a scheduled-script card so the box does
 * something later or on a cadence. The description is the discovery surface —
 * an agent forms the "come back to this later" intent from it — while the card
 * format lives in the scheduled-script card's own docs.
 */
export const SCHEDULES_SKILL = `---
name: schedules
description: Have the box do something later or on a cadence — a reminder, a recheck, a periodic job that runs on its own. Use when you want to return to something after this turn, revisit a decision at intervals, or run a command on a schedule.
---

# Schedules

A scheduled script — a \`.scheduled-script.card\` in \`_config/schedules/\` — runs a \`bbx\` command on a recurring schedule, or once at a future time. The built-in ones are mechanical (connector syncs, maintenance); the ones **you** create serve the user: checking something on a cadence, revisiting a decision at intervals, or a one-off further out than a chat \`<schedule>\` can reach. Keep them practical, not dramatic.

\`\`\`
---
cron: 0 8 * * 1              # Mondays at 8am
not-before: 3d              # skip if it already ran within 3 days
runs: bbx procedure run weekly-digest
description: Monday digest of the week's still-open threads
reason: Boxholder wanted a summary to start the week
---
\`\`\`

They run in the background automatically; \`bbx scheduled\` lists them. A job you write ends with \`bbx run-summary "<what this run did>"\` so the boxholder sees the run's result on the dashboard (an agent step in a scheduled procedure is told this too). Use \`at:\` (a future timestamp) with \`once: true\` instead of \`cron:\` for a one-shot. Full format — cron/at/rrule, \`not-before\` throttling, \`create-after-success\` chaining — is in \`${BOX_PACKAGE_DOCS}/card-scheduled-script.md\`.

(This is for durable, box-level schedules. A quick in-session follow-up while chatting — "remind me in 20 minutes" — is the chat \`<schedule>\` tag, not a card.)
`;

/**
 * The `tricks` skill: formalizing a repeated operation as a reusable script.
 * The trigger is *self-noticing* ("I keep doing this"), so the description
 * carries that instinct — nothing else in context plants it once this leaves
 * the always-loaded guide.
 */
export const TRICKS_SKILL = `---
name: tricks
description: Formalize a repeated operation as a reusable script you can rerun with bbx trick. Use when you notice you're doing the same multi-step task by hand more than once (a particular fetch, an export, a search-and-summarize) and want to package it.
---

# Tricks

A **trick** is a reusable script — you package a useful operation once and rerun it with \`bbx trick <name>\`, instead of redoing it by hand each time. The signal to make one is *repetition*: the second time you find yourself running the same multi-step task, that's when it's worth formalizing.

Each trick lives in \`src/tricks/scripts/<name>/\` with an \`index.ts\`. \`bbx trick\` lists the box's tricks; \`bbx trick <name>\` runs one. Read \`${BOX_PACKAGE_DOCS}/tricks.md\` before writing one: it covers the script interface, how the engine runs and commits a trick, secrets, and dependencies.

Tricks are box-local by default, but the operation itself needn't be box-specific — a general utility (an image generation, a format conversion) is a fine trick if it's something this box does repeatedly.
`;

/**
 * The `views` skill: authoring a .tsx view. Rare, mechanics-heavy box-building
 * work — out of the always-loaded guide, reached when a card type needs a
 * richer interface than the default renderer.
 */
export const VIEWS_SKILL = `---
name: views
description: Give a card type a custom interface — a React component that renders a card in the browser. Use when a card type needs a richer display than its default renderer.
---

# Views

Views are React (\`.tsx\`) components that render box data in the browser. **Read \`${BOX_PACKAGE_DOCS}/views.md\` before creating or modifying one** — it carries the full API, including cached \`imageUrl\` variants for image displays, the view-host context, and how to test a view.

A view always gives a **card type** a custom interface; there is no card-less standalone view.

When the user says a view "looks wrong" and the source doesn't tell you why — a broken layout, a visual glitch, something rendering unexpectedly — run \`bbx chat screenshot\` to see what's actually on their screen right now instead of guessing from the code. It asks the user's browser, so it may come back declined or unavailable; reach for it when appearance is genuinely the question, not by reflex. When the question is *where* a control is rather than how something looks, \`bbx chat ui\` lists the controls on screen and the \`control:\` links that point at them — same rule: reach for it when interface location is genuinely the question, not by reflex.
`;
