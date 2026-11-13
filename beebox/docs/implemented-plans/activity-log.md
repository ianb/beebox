---
title: "Activity log: what a person did in views and figures, on demand for the chat agent; figures lose file writes"
status: implemented
workstream: canvas-brushes
issues:
  - ../../../issues/decisions/2026-11-13-view-file-writes-too-broad.md
---
# Activity log

Views and figures report what a person did in them. Today the chat agent sees
only the latest action per kind, cut at 200 characters, attached to the next
message. This plan keeps every action: beebox appends each one to a
machine-local log, the agent's next message carries a count, and the agent
lists the actions with `bbx chat activity` when it wants them. The same plan
takes file writing away from figures, because the one box that wrote from
figures did it to keep such a log.

**Issues addressed:** related, not resolved:
`issues/decisions/2026-11-13-view-file-writes-too-broad.md` (views keep their
writes here; that issue decides their scope). Queue searched for "activity",
"card-activity", "reportActivity", "event log": no other open item.

## Design

### Situations

- When Juni has spent ten minutes in the molecule builder beside the chat and
  then types "I can't make water", I want the tutor to see every atom she
  added and removed, so it can answer about what she tried, not guess.
- When Priya scrolls through a budget view while talking about the month, I
  want the agent to know which categories she opened if it matters, so I
  don't have to say "I was looking at groceries".
- When Wren clicks around a figure and then asks about something unrelated, I
  want the agent to ignore that activity, so the reply is not about the
  figure. (The count is a hint; the agent fetches only when it helps.)
- When a figure's code is wrong, I want it not to be handed tools that
  overwrite my files, so a drawing toy does not damage a document by
  following its own API. (Figure code still runs in the page and could call
  the file routes itself; real enforcement is a decision listed below.)

### Right place, right time

| Situation | Act, show, or quiet | Surface and card | Attention |
|---|---|---|---|
| Juni's builder session | quiet until she writes; the agent fetches | chat, the next agent turn | background |
| Priya's budget view | quiet; a count on her next message | chat | background |
| Wren's unrelated question | quiet; the agent skips the fetch | none | none |
| A broken figure | the figure API offers no write | none | none |

The person never sees the log during normal use. The agent sees a count with
each message, and the full list only on request.

### Spirit

- **Serves:** "You should be able to see the gears": the agent reads the same
  record of what happened that a person could read, instead of a lossy
  summary. "Nothing should just disappear": actions are kept, not overwritten.
- **Risks:** "It should feel like a place" — a place that watches every click
  can feel like surveillance. Guard: the log stays on the box's machine, out
  of git, rotates (a new file after about 30 days or 8 MB, keeping one older file), and records only what the view or figure
  chose to report (handled actions and param changes, not pointer motion).
  The person can see their own activity by asking; the agent reads it to
  them, or writes a view for it.

### Trust

Shows only; takes no action. The agent decides whether to fetch. Nothing
moves up the ladder.

### When it goes wrong or does nothing

- The server is unreachable: actions wait in the page's queue and send in
  order when it returns within a minute; after that, or when the queue fills,
  the oldest are dropped and the console says how many. Nothing the person does is blocked.
- No activity: the message carries no hint, and `bbx chat activity` prints
  "No activity since your last reply."
- A view reports junk: entries are truncated to a fixed size; the agent sees
  what was sent.

### Walkthrough

Juni opens the molecule builder beside the chat. She adds C, H, H, then
removes an H. Each handled click is an `onEvent` entry from canvas-loop with
the sketch's `activity(model)` (molecules and open bonds). The figure harness
turns each into an activity entry and queues it. The queue posts batches to
`activity.record` in order, one request at a time. The server stamps time,
user and chat, and appends JSON lines to `.beebox/activity.jsonl`. Juni types
"I can't make water" and sends. The page flushes the queue first, then sends.
The server counts this chat's entries since the agent's last reply and adds
`<activity entries="7" cards="1"/>` to the message. The tutor runs
`bbx chat activity`, reads seven lines (add C, add H, …, remove H, each with
the molecules then), and answers about the missing oxygen. The lines stay in
the log until rotation.

## Smallest fix and budget

- Smallest fix: make `figure.file` read-only. That removes the danger but
  leaves the agent with latest-only activity, which is why a box built its
  own log.
- Chosen: four tracks.
  - A: read-only figures (about 40 source and 30 test lines).
  - B: canvas-loop `activity` export on `onEvent` entries (about 40 source and 40 test lines).
  - C: activity log, record route, send hint, `bbx chat activity` (about 450 source and 300 test lines).
  - D: page-side queue and the figure and view reporters (about 150 source and 120 test lines).
- Docs: card-figure instructions, views doc, TEA.md, agent guide, agent-changes (about 120 lines).
- Total about 1,300 lines. Not a BIG CHANGE.

## Stated preferences this plan trades against

- Boxholder, 2026-11-13: figures "shouldn't have that much power"; a figure
  that must save belongs inside a view. Track A.
- Boxholder: activity is "a general pattern", attached to "this box, this
  chat, and this message", fetched "on demand" by a `bbx` command "that knows
  what the current message is". Track C: the command takes no id.
- Boxholder: "ref only if it's an actual URL"; the hint carries counts, not a
  `ref`.
- Boxholder: "get-ignored and rotated". `.beebox/` (gitignored), rotation as
  the notification log does.
- Boxholder: canvas-loop stays unaware of cards; activity goes through the TEA
  cycle; saving logs never blocks or fails the sketch, with a console warning
  at most. Tracks B and D.
- `beebox/docs/adding-api-endpoints.md`: tRPC is the default. The record
  route is a tRPC mutation.
- Precedent: `src/core/notification/log.ts` (line cap 4,000 bytes, 30-day or
  8 MB rotation to a `.1` file, readers read both).

## What already exists

- Activity reporting: `reportActivity(kind, detail)` bound per card in
  `src/frontend/src/components/WorkspaceCanvas/view.tsx:35`; the in-memory
  `CardActivityStore` captured at send (`src/frontend/src/components/chat/InteractiveChat-card-hooks.ts:52`,
  "Activity follows its content source, independently of the selected
  conversation"). Keep as the latest-wins snapshot; add the log beside it.
- Rendering into the agent's message: `renderActivityChildren`
  (`src/core/chat/card-activity.ts:115`) and `composeChatAppSnapshot`
  (`src/core/chat/features.ts`), called at `src/core/chat/session/run/start.ts:211`.
  Reuse: add one `<activity>` child.
- Figure activity: `figure-canvas-loop.ts:77` (`reportActivity("explored", detail)`)
  from canvas-loop `onEvent`. Extend with the sketch's activity and the log.
- Session from the agent's environment: `resolveChatSessionId()`
  (`src/core/chat/session/id-file.ts:107`, `BBX_CHAT_SESSION_ID`, then the id
  file). Reuse. Do not copy `whats-changed`'s default of the most active
  session (`src/webapp/routes/chat/send-routes.ts:152`, `requestedSession ?? (await getMostActive(boxRoot))`).
- Per-session state precedent: the turn marker
  `.beebox/chat-turn-marker/<session>.json` `{head, time}` (`src/core/chat/turn-marker.ts:61`).
  Not used as the window start: it is written when the reply completes
  (`src/core/chat/session/run/consume.ts:82`), so an entry that arrives
  after a send but before the reply ends would fall between two windows.
  The activity cursor below follows its file pattern.
- Message ids: client `messageId` on every frontend send (`src/frontend/src/api-chat.ts:380`,
  `params.messageId ?? newMessageId()`); absent on scripted and scheduled
  turns (`src/core/chat/session/deliver-user-message.ts:185`). Recorded as
  provenance only, never as the cursor.
- Rotating JSONL: `src/core/notification/log.ts` (`MAX_LINE_BYTES`,
  `ROTATE_AGE_MS`, `ROTATE_BYTES`, `rotateIfNeeded`). Model the activity
  writer on it; do not refactor the notification log in this plan.
- Figure file helpers: `FigureView` builds `figure.file` from
  `useViewFileHelpers(apiBase)` (`src/frontend/src/components/FigureView/view.tsx:97-105`).
  Narrow to read helpers.

## Prior art (external)

No decision depends on an external premise.

## Ontology

- **activity entry** (new): one action a person took in a view or figure.
  `{ at, user, chat?, afterMessage?, card, via?, kind, detail?, data? }`.
  `card` (required) is the card that produced the action: the figure's own
  card for a figure, even when a view embeds it; `via` is the card that
  showed it, when different (the embedding view).
  `kind` is one of the existing four (`src/shared/card-activity-kinds.ts`).
  `detail` is short text; `data` is a small JSON object from the view or
  figure. NOT a chat message, NOT a card, NOT committed.
- **activity log** (new): `.beebox/activity.jsonl` plus `.beebox/activity.1.jsonl`.
  Box-wide, machine-local.
- **entry sequence** (new): a number the server gives each entry as it
  appends, increasing in log order across rotation.
- **activity cursor** (new): per chat session, the highest sequence already
  counted into a hint: `.beebox/activity-cursor/<session>.json`
  `{ hinted, previous }`. At a person's send, the server sets `previous` to the
  old `hinted` and `hinted` to the current highest sequence.
- **activity window** (new): chat session plus sequence, read with time. For
  a session, its entries with sequence above `previous`. An entry that lands
  after a send is above `hinted` and so falls in the next window; none is
  skipped. Entries whose `at` is later than the message are shown as after it.
- **pending conversation key** (new): a new conversation has no session id
  until its first message is accepted. The page tags entries with its own
  key for that conversation; the first send carries the key; the server binds
  the key to the assigned session, and those entries count as that session's.
- **activity export** (new, canvas-loop): an optional pure export
  `activity(model) => JSON object`, a second `draw` that turns the state into
  data instead of pixels; the runtime adds its value as `activity` to each handled
  `onEvent` entry. canvas-loop does not know where it goes.
- **activity queue** (new, frontend): the page's ordered, bounded,
  best-effort sender.
- card-activity snapshot, `reportActivity`, turn marker, `messageId`: existing names.

## Tracks / scope

### Track A: figures lose file writes

- What: `figure.file` keeps `readFile`, `fileUrl`, `imageUrl`; drops
  `writeFile`, `appendFile`, `commitFile`, `adapterFetch`.
- Why: a figure's code runs with the person's write rights over every
  non-card file in the box.
- Direction: a `FigureFileHelpers` type and a function that picks the read
  helpers from `ViewFileHelpers`; `FigureContext.file` uses it. Docs say a
  figure that must save lives inside a view.
- First chunk: the type, the pick, a test that `figure.file` has no write
  member, the doc change.

### Track B: canvas-loop `activity` export

- What: a sketch may export `activity(model): Record<string, unknown>`. After a
  dispatch that handled a name or changed a param, the runtime calls it on the
  new model and adds `activity` to the `onEvent` entry. Headless transcripts
  show it on the event line.
- Why: the host needs the state after an action without wrapping `update`.
- Direction: `activity` is pure and part of the cycle. An exception in it is
  caught: the entry goes without `activity` and the console warns once; the
  sketch keeps running. No card, chat or file names in canvas-loop.
- First chunk: browser runtime and headless runner, tests, TEA.md.

### Track C: the log, the route, the hint, the command

- What:
  - tRPC mutation `activity.record({ entries: [...] })`: the server stamps
    `at` and `user`, truncates, and appends lines in the order given.
  - At a person's send, the server advances the cursor, counts the window and adds
    `<activity entries="N" cards="M"/>` to the chat-app snapshot when N > 0.
    Scheduled and self-note turns get no hint.
  - `bbx chat activity [--card <path>] [--json]`: prints the window for the
    agent's own session (`resolveChatSessionId`), oldest first, one line per
    entry; `--json` prints JSON lines for piping.
- Why: the agent gets every action on demand, and nothing writes outside `.beebox/`.
- Direction: `src/core/activity/` owns the writer (line cap, rotation and
  sequence, modeled on the notification log), entry validation, the cursor,
  the window and the reader.
- Vocabulary lock-ins: `activity.record`, `<activity entries cards>`,
  `bbx chat activity`, the entry fields above.
- First chunk: the writer and reader with sequence across rotation, and their
  tests.

### Track D: the page side

- What: one activity queue per page. Reporters push entries; the queue sends
  batches to `activity.record`, one request in flight, in order.
  - On failure it retries with backoff for up to 1 minute, then drops the
    batch with one `console.warn`. Above 500 queued entries it drops the oldest and
    warns. It never throws to the caller.
  - A chat send awaits a flush of at most 1 second, then sends anyway.
  - Each entry carries the chat the page has selected and the last
    `messageId` the page sent in it.
- Figure reporter: the harness's `onEvent` wrapper (`figure-canvas-loop.ts`)
  pushes `explored` entries with `detail` and `data: activity`, and keeps the
  latest-wins `reportActivity` call.
- View reporter: `reportActivity(kind, detail, data?)` pushes an entry and
  keeps the snapshot. `reportActivity(kind, detail, activity?)`: the third
  argument is the same kind of data object a figure's `activity` export gives.
- Scroll, views only: the companion pane reports the topmost visible heading
  of the view's content, once scrolling has settled (about 1 second without
  movement) and the heading differs from the last one logged:
  `scrolled` with `detail: "Moles and mass"`. Raw scroll positions are never
  logged; a view with no headings logs no scroll.
- Where: the companion pane beside a chat, where `reportActivity` is bound
  today (`WorkspaceCanvas/view.tsx:35`). On a card page or inline, views get
  a no-op reporter (`src/frontend/src/components/FileView/AgentViewRenderer.tsx:65`);
  wiring them is NOT in scope (no chat to attribute to).
- First chunk: the queue with fake transport tests (order, retry, drop, never
  throws), then the reporters.

## Could this be simpler?

- Simplest: a larger latest-wins detail cap. It still loses everything but
  the last action, which is what made a box build a file log.
- Without a page queue, entries could ride the next chat send as today. That
  loses everything when no message follows, and makes one send carry
  hundreds of entries. The queue is the smallest thing that sends in order
  without blocking.
- Without the window, the command could print the whole log. The window is
  what makes "since your last reply" true without the agent passing an id.

## Subplans

None. The view-and-embedded-figure message channel is a later plan.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Server down while Juni works | to add (queue, fake transport) | retry, then drop with a warning | console |
| A view floods entries (every keystroke) | to add | line truncation; queue cap | console when dropping |
| Two tabs append at once | to add (concurrent append) | one `appendFile` per line under 4,000 bytes | n/a |
| A new chat has no session id yet | to add (pending key bound at first send) | key binding | n/a |
| An entry lands after the send, before the reply ends | to add (late entry falls in the next window) | sequence cursor | n/a |
| Queued sends merged into one turn | to add | the cursor advances once per turn | n/a |
| `activity` throws | to add | caught at the enrichment step; the entry goes without `activity`; one console warning | console |
| Scroll floods the queue | to add | only a settled change of topmost heading is logged | n/a |
| A box figure still calls `figure.file.appendFile` | courseware's helper checks `file?.appendFile === undefined` and returns | box-side | silent: its log stops growing; agent-changes says so |
| Rotation during a read | to add | the reader reads `.1` then the live file | n/a |

> **Accepted risk:** the courseware box's lab log goes quiet for figures until
> its agent moves to the native log. The agent-changes entry names the change.

## Agent-flow / user-flow edge cases

- Wrong tool: the agent runs `bbx chat whats-changed` for activity. ADDRESSED
  in the agent guide: whats-changed is files; activity is actions.
- Fabricated value: the agent cannot pass an id; nothing to fabricate.
- Stale window: the agent runs the command during a long turn; new entries
  appear. ADDRESSED: they are listed, marked as after the message.
- A scheduled or self-note turn (no `messageId`, `user: null`): ADDRESSED.
  No hint; nobody interacted. `bbx chat activity` still works if run.
- Partial migration: views keep `reportActivity(kind, detail)`; `data` is
  optional.

## NOT in scope

- Narrowing view file writes: the decision issue above.
- The view-and-embedded-figure channel, so a drawing figure can save through
  its view: a later plan.
- A page for the log: the person asks the box, and the agent reads the log
  to them or writes a view for it (boxholder, 2026-11-13).
- Pointer motion and scrolling as entries: only handled actions, param
  changes and what views report.

## Open design questions

- **Enforcing the figure boundary (human decision).** Figure code runs in the
  page, same origin, with the person's session; it can call
  `PUT /api/files/...` itself (`src/webapp/routes/api/register/files-write.ts:49`).
  Track A removes the API, not the ability. Enforcement means running
  figures in a sandboxed iframe without the session (and a message channel
  for params, events and activity), or a server check that rejects writes
  from figure code. Views run the same way. Lean: Track A now, isolation as
  its own plan with the view-and-figure channel, since that channel is the
  same piece.

Otherwise none. Settled by the boxholder on 2026-11-13: the person sees activity by
asking; scheduled and self-note turns get no hint; the window is time plus
chat session; retries stop after 1 minute.

## Knowledge audits

New agent-facing concept: `bbx chat activity` and the `<activity>` hint. Add
a `knows_directly` entry in `beebox/src/dev/knowledge-audits.yaml` ("the
learner used the figure; what did they do?" → runs `bbx chat activity`) and
run it on test1.

## What will hold this after it ships

- Unit tests: the writer (truncate, rotate, sequence across rotation, read
  both), the cursor and window (late entry, merged sends, pending key), entry validation, the
  page queue with a fake transport, canvas-loop `activity` on `onEvent`, the settled-heading scroll reporter.
- A route test for `activity.record` and the send hint.
- A CLI test for `bbx chat activity` with `BBX_CHAT_SESSION_ID`.
- A browser check: a figure beside a chat, actions, a message, the hint.

## Implementation order

1. Track A (independent, smallest).
2. Track B in canvas-loop.
3. Track C: the writer and reader, then the route, cursor, hint, command.
4. Track D: queue, then figure and view reporters.
5. Docs, agent guide, knowledge audit, agent-changes; browser check.

## Rollout shape

Tests as listed; done when they pass, the knowledge audit passes on test1,
and the browser check shows the hint and the command's output. No data
migration: the log starts empty. The courseware box changes are the
boxholder's call.

## Plan review (codex gpt-6-sol)

1. Removing `figure.file` writes does not stop figure code from calling the file routes. Accepted: claims corrected; enforcement is an open decision above.
2. A time window starting at the reply's marker skips an entry that lands after the send and before the reply ends. Accepted: replaced by a per-session sequence cursor advanced at each send.
3. Untagged entries matched by user mix two new chats. Accepted: a pending conversation key, bound at the first send.
4. Cut the `summary` export and the notification-log refactor. Refactor cut (the activity writer is modeled on it, not extracted). `summary` kept: the boxholder asked for state to go through the TEA cycle, and the one box that logged did so to capture state after an action.
5. A throwing `summary` would stop the sketch. Accepted: caught, entry sent without it, one warning.
6. Page and inline views have a no-op reporter. Accepted: scope stated as the companion pane.
7. Scroll reports would evict useful entries. Accepted: `scrolled` is not logged.
8. "Rotates away after 30 days" overstated the notification log's rotation. Accepted: wording made approximate.

## Boxholder decisions after review (2026-11-13)

- Names: one word, "activity", end to end: canvas-loop's `activity(model)`
  export and the `activity` field on `onEvent` entries, `reportActivity`, the
  `<activity>` hint, `bbx chat activity`, `.beebox/activity.jsonl`. canvas-loop
  keeps `onEvent` for its stream of all inputs.
- Scroll: views only, as the topmost heading after scrolling settles; not
  pixels. Supersedes review item 7's "not logged".
- No hard block on figure writes for now and no iframes; the gap goes in the
  security report and an issue.

## Code review (codex gpt-6-sol), two rounds

Round 1, all fixed: the new-chat binding race; a timed-out batch written after a
later one; a send waiting up to 5 s on the activity lock (now 250 ms, then no
hint); a rotation during a read; the server time stamped before the lock;
heading scroll on non-view cards; headless JSON of a cyclic activity object.

Round 2:
- New chat: the command waits up to 2 s for the binding; if the cursor is
  still missing it says the chat may not be linked yet and to retry, instead
  of "No activity". Fixed.
- A request with no answer stalled the queue forever. Fixed: a 30 s request
  timeout counts as a failure, so the one-minute drop applies. Accepted risk:
  a server stalled past 30 s can still save that batch late, out of order or
  twice (best effort, per the boxholder's "nothing should block").
- "After your message" now compares `seq` with the cursor's `hinted`; times
  could tie to the millisecond. Fixed.
- The existing latest-wins `scrolled` snapshot still fires for every card.
  Declined: that hint predates this plan; the boxholder's "views only" was
  about the log, which logs headings for agent views only.

Size: about 2,080 changed lines (1,162 source, 865 tests, 57 docs) against an
estimate of about 1,300: a BIG CHANGE, reported to the boxholder after the
fact. Most of the growth is the page side (queue, chat-machine key, scope
contexts, the reporter type in every renderer).

## Track E: the log replaces the per-send snapshot (boxholder, 2026-11-13)

Boxholder: "I want to switch all activity over to this new system, including
for views." The latest-wins `<card-activity>` snapshot that rode each send
goes; the log is the only activity path.

- Frontend: `CardActivityStore`, `useCardSend`'s report/capture of kinds and
  details, and `cardActivity`/`cardState` on the send path go. The send keeps
  `openCard`/`viewContext`: that is attention, not activity.
- One reporter: a hook bound to a card logs `{card, via?}` into the chat's
  scope when the component is inside a companion-pane card, and does nothing
  elsewhere. Views, figures, the pane's `navigated` and the renderer switch
  ("viewing as …") all call it; the `reportActivity` prop threading through
  FileView goes.
- Scroll: the pane logs the settled topmost heading for any card whose
  content has headings (views and documents). The scroll-fraction snapshot
  goes. Figures have no headings and log no scroll.
- Server: `cardActivity`/`cardState` leave the send body (unknown keys from an
  old open tab are stripped, not rejected), `ChatSendInput`, the turn merge,
  and `start.ts`; `renderActivityChildren` goes. Old transcripts keep their
  `<card-activity>` tags; tag parsing for display stays.
- The agent sees the `<activity entries cards>` hint and runs
  `bbx chat activity`. The prompt and the views guide drop the
  `<card-activity>` text.
- NOT in scope: views outside the companion pane (no chat to attribute to).
