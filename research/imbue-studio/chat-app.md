# The chat app, read for lessons (2026-10-08)

Read after a first hands-on session in which the chat held up well. Paths under `system/apps/chat/`, `docs/` and `.agents/` are in `default-workspace-template`; Bee Box paths start with `beebox/`. Written by a reading agent and edited by the research session. Nothing here is copied code: the chat app is Fair Core licensed or unlicensed (see [README](README.md), Licensing).


Read-only notes; no code copied. Paths under `system/apps/chat/`, `docs/` and
`.agents/` are in the Studio repo's `default-workspace-template/`; Bee Box paths
start with `beebox/`. The app is a Python backend (~23k lines) and a Mithril
TypeScript frontend (~41k lines with tests) supporting four harnesses behind
one event contract; this note follows the claude path.

## 1. Transcript model

**Events.** Every parser emits `user_message`, `assistant_message` (text plus
`tool_calls`) and `tool_result`, plus `special` turn markers claude lacks
(`system/apps/chat/imbue/chat/harnesses/events.py`). Event ids come from the
harness's stable identity (claude's message UUID), so a re-serialised line
dedups and an updated one supersedes in place (`events.py`, "Event-id rule").

**Payload-free wire.** Events never carry tool inputs, outputs or thinking;
they carry `input_chars`/`output_chars`, a 200-char `error_snippet`, a
`tk_stamp`, structured `permission_request`/`secret_request` objects,
parser-computed labels (`header_label`, `caption_label`, `action_verb`,
`action_target`, `action_note`) and `has_thinking` (`events.py`;
`frontend/src/models/Response.ts`). The payload is fetched on first expand via
`GET .../events/<event_id>/detail`, re-read from the JSONL by byte range, which
lets a whole parsed transcript stay resident until the agent stops
(`views/tool-payloads.ts`; `harnesses/transcript_store.py`).

**Reading the JSONL.** `harnesses/claude/watcher.py` discovers sessions from
`claude_session_id_history`, keeps one lane per file (main plus
`<session>/subagents/*`), reads by byte cursor, and polls at 1s with batched
path-watch wakes (`watcher_common.py`; `harnesses/path_watch.py`).
`harnesses/claude/session_parser.py` rebuilds `/foo bar` from the
`<command-name>` expansion, drops the interrupt sentinels and the `--resume`
synthetic "Continue from where you left off." pair, and reads `queued_command`
attachments so a queued message gets a bubble. Claude thinking is not surfaced
("encrypted and useless to the user"; `session_parser.py` ~635).

**Classification is backend-side.** `user_message` is overloaded (human turn,
Stop-hook text, skill expansion, task notification, compaction summary,
permission verdict). One detector table, `harnesses/message_display.py`, stamps
`display` (`hidden`, `chip`, `skill_expansion`, `status`, `notice`,
`permission_resolution`, `prompt_with_context`, ...) plus `display_label`/
`display_body`; undetected `isMeta` messages are hidden. The
frontend maps the decision to a `UserMessageKind` and never sniffs text
(`frontend/src/views/message-classification.ts`, `message-kinds.ts`); tool
calls likewise get `hidden`, `permission_request` or `secret_request`
(`harnesses/tool_output.py`).

**Rendering.** `views/conversation-rows.ts` walks the transcript once into turn
sections and flattens them to rows: user bubble, a `ProgressBlock` for a turn
with `tk` steps, an ungrouped assistant run, a chip, a handoff node, or a
trailing reply. A run of tool calls collapses to one wrapping row of ghost
chips (icon, past-tense verb, target), one open at a time
(`views/ToolChipGroup.ts`); an open call is a "▸ header" block with monospace
panes (`views/ToolCallBlock.ts`). Expansion state is a module-level set keyed
by stable id so an evicted row comes back open (`views/expansion-state.ts`).
`StableAssistantMessage` re-renders only when event, tool-result count, detail
or expansion version change (`views/message-renderers.ts` line 204).

**Subagents.** An `Agent` call renders as a card from its input description at
once, "Running…" until `subagent_metadata.session_id` lands (the watcher
enriches the parent in place), then "View conversation" to a `SubagentView` on
the same row builder (`message-renderers.ts` lines 279-413; `views/SubagentView.ts`).

**Steps via `tk`.** The timeline is built from the transcript alone: structure
from `tk create/start/close` Bash calls whose results print
`Updated <id> -> <status>`, decoration from `Created <id>: <title>` and
`tk-step <id> title|summary:` stdout lines (`views/turn-grouping.ts` header).
One step open at a time; closing prose is ejected after the node; an open step
carries over to the next turn; a system chip breaks the timeline like a user
turn. The current step shows the agent's latest prose as a shimmering caption
(`views/ProgressBlock.ts` lines 79-100). Hooks enforce it: `tk start`/`close`
alone in a tool call (P6, hard block), soft reminders for work with no open
step (P5) and open steps at stop (P7) (`core-contracts/tool-call-policies.md`).

**Errors and compaction.** `harnesses/claude/error_notice.py` reads Claude
Code's record stamps (`isApiErrorMessage`, `apiErrorStatus`, `error`) rather
than prose, so "You've hit your session limit" renders as a failed turn.
`isCompactSummary` renders as a "Context was compacted" status pill with an
expandable summary (`changelog/danielmewes-compaction.md`).

**agent_switch, Source view, streaming.** A chat that moved agents gets a
synthesized `agent_switch` event between segments
(`imbue/chat/chat_transcript.py`), drawn as a timeline node "Handed off from
Claude Code to Codex" (`views/handoff-node.ts`). The transcript and the agent's
ttyd terminal are one card's two faces; a `role=switch` "Source view" flips it
(`views/chat-flip.ts`). Claude writes whole JSONL lines, so there is no token
streaming: a message appears when its line lands; liveness comes from the 1s
watcher, the activity strip and step captions. Deltas reach pages over SSE
per chat (`models/StreamingMessage.ts`).

**Paging and virtualization.** Three layers: Visible (mounted rows plus 800px
overscan), Physical (up to 50,000 contiguous events with measured heights),
Virtual (the server total, known only by count)
(`models/transcriptScroll/types.ts`; `docs/system/specs/transcript-smooth-scroll.md`).
First load is a 50-event tail; a jump loads 500 around the target; growth is
2,000-event chunks, one fill in flight (`models/transcriptScroll/fillPlanner.ts`).
Unmounted rows are measured offscreen in 8ms idle batches
(`views/offscreen-measure.ts`). The native scrollbar is hidden; a custom
overlay maps the loaded window in pixels and unloaded history in index space
(`views/TranscriptScrollbar.ts`).

## 2. Composer

**Attachments.** Files dropped, pasted or picked upload at once to
`/api/uploads`; the composer appends a "See attachment here:" markdown line
(`![path](path)` for browser-decodable images, `[path](path)` otherwise)
naming the absolute path on the agent VM, so bubble, agent transcript and file
server share one text (`models/attachments.ts`). Ready chips persist to
localStorage beside the draft (`models/ComposerAttachments.ts`); send awaits
uploads and refuses when one failed (`MessageInput.ts` `prepareSend`). An
element reference (right-click on any UI element) travels as a fenced `json`
block and becomes a `REF-<id>.json` upload with a summary chip
(`models/elementReferences.ts`).

**Drafts.** Draft text is localStorage `message-text:<chatId>`
(`MessageInput.ts`). The `draft` launch path lands text in a composer unsent
through a one-time intake token held 15 minutes and applied once, so a reload
does nothing (`README.md` "The intake route"; `imbue/chat/chat_intakes.py`).

**Queued sends.** The lifecycle contract defines five exclusive states
(Composer, Sending, Queued, Delivered, Returned), the law
`delivered + queued + sending + returned = total accepted`, and "never
swallowed": a message that left the composer is always on screen
(`harnesses/core-contracts/messages-lifecycle-contract.md` A1, A1a). The UI
queue is claude's own `queue-operation` ledger, mirrored by
`harnesses/claude/queue_tracker.py` and pushed as
`active_agent.queued_messages`; the frontend holds no queue state
(`views/QueuedMessageView.ts`). The one optimism is a "Sending…" bubble drawn
identical to a delivered turn, removed only when the backend reports the real
representation (`models/OutgoingMessages.ts`); "Connecting…" shows while a
send waits for the agent (`views/ConnectingIndicator.ts`). "Shoulder tap"
flushes the queue into the live turn via a `meta+q` chord
(`harnesses/claude/tap.py`). The queue dies with the session (contract, "Queue").

**Slash commands.** A slash-shaped message consults the harness catalog's
`composer_command` popups (auth commands open sign-in, declined ones a notice);
`/fast on|off` is the chat's own setting; the rest go to the harness as typed
(`MessageInput.ts` lines 510-540).

**Model menu and Stop.** Provider (accounts) first, then Model, Effort (only
if the model declares more than one), Fast mode (off/auto/on with a turn
limit), Stop agent, and on phones Source view (`views/ModelProviderMenu.ts`).
The chip moves only on backend confirmation (contract A2). Picking another
account arms a switch; the send button reads "Switch and send"
(`models/PendingLane.ts`). Stop is one button and one `interrupt` route with
per-harness behavior behind it (`harnesses/interrupt.py`); it ends the turn
and returns every undelivered message to the composer, prepended in send
order, text computed by the backend (`drain-to-composer`; contract "Interrupt").

**Keyboard and phone.** Enter sends, Shift+Enter newlines, no `isComposing`
guard (`MessageInput.ts` line 845); pasted images upload; the textarea caps at
200px. Compact layout when a touchscreen is phone-sized either way round or a
mouse window is ≤500px (`frontend/src/compactLayout.ts`): 44px header with
list button, title and kebab; the chat list in a drawer; the model menu from a
settings button with sliding submenus (`changelog/dwt-phone-interface.md`).

## 3. Chat lifecycle

A chat is a sequence of agents, one active; its id is the first agent's id so
old URLs survive (`docs/system/blueprint/chat-agent-split/plan-chat-agent-split.md`;
`imbue/chat/chat_records.py`). Per-chat routes cover `destroy`, `rename`,
`start`, `stop`, `message`, `interrupt`, `drain-to-composer`, `handoff`,
`presence`, `model` (`imbue/chat/server.py` lines 2060-2107). A chat with
nothing sent is "awaiting", held in memory; its first send launches it and a
cheap model names it in the background (`imbue/chat/chat_naming.py`).

**Presence, death, restart.** The page reports `visible`/`hidden`/`closed`
with a one-minute heartbeat; reports expire after ten minutes
(`frontend/src/presence.ts`, `imbue/chat/presence.py`); the aggregate drives an
OOM prioritizer so the chat on screen is shed last (`imbue/chat/oom_prioritizer.py`).
The chat dot has active, waiting, dormant and no red: every non-running state
is recoverable because a message revives the agent (`views/agentLiveness.ts`).
Status (`working`, `idle`, `attention`, `stopped`, `error`) is computed
backend-side (`agent_manager.py` `chat_status_for_agent`). The app folds an
observer's lifecycle event file, serves 503 until the first snapshot, and
reports degraded if the observer dies (README "The agent observer");
unfinished handoffs resume from the record; a tail older than the
process-start marker never shows "Thinking…" (`imbue/chat/activity_state.py`).

**Helpers and intake.** A chat another agent started carries `agent_created`
and `lead_agent` labels and files under the lead's chat (`frontend/src/root/rows.ts`).
`POST /api/chats/intake` takes text, a `target` (`new_chat`, `current_chat`,
`chat_selector`, `chat_id`) and `is_draft`; the manifest's `new`/`send`/`draft`
launch paths and every in-workspace sender (`message_chat.py`) enter through
it or the send route (README).

## 4. Progress and status

Backend-derived `activity_state` (IDLE/THINKING/TOOL_RUNNING) rides the
`chats_updated` WebSocket; the strip above the composer shows "Thinking…" or
the in-flight tool's `caption_label` (`views/ActivityIndicator.ts`). Claude
has no turn markers, so working is inferred from lifecycle RUNNING plus the
tail (an unmatched `tool_use`, or a trailing `user_message`/`tool_result`)
(`harnesses/claude/activity_state.py`); the contract forbids settle timers
(A6). A chat whose status leaves `working` off screen gets an unread mark
(`frontend/src/root/chatUnread.ts`).

"Live first, ratify at turn-end" is an agent skill pattern, not a chat
mechanism: a live half confirms a cheap artifact in conversation, a ratify
half hardens it in a background worker whose `<background-task-report>`
reaches the lead chat as a notice (`.agents/shared/references/interactive-delivery.md`;
`docs/system/blueprint/generic-artifact-lifecycle/plan-generic-artifact-lifecycle.md`).

`notify-user` is a skill, at most once per turn, when a turn ends with a
deliverable, an awaited result, or a question only the user can answer; it
posts to the desktop feed and a click lands in the chat
(`.agents/skills/notify-user/SKILL.md`). It is prose-only on purpose: a Stop
hook reaches the model only by refusing the stop, which rendered as a chip
plus a duplicated reply and doubled every turn in a 2026-09-22 rehearsal
(`tool-call-policies.md` P8). Send failures return text to the composer with
one notice shape (`MessageInput.ts` `raiseFailureNotice`). Permission and
secret requests are cards built from the structured echo in the tool result,
with the verdict written onto the card (`views/permission-card.ts`).

## 5. Scroll and reading behavior

Two exhaustive reducers (`models/transcriptScroll/state.ts`): scroll position
`FOLLOW` (pinned to the tail) vs `USER_CONTROLLED` (anchor = the row
containing the viewport top plus px offset), entered by any genuine upward
input and left by reaching the true bottom or sending; and scrollbar
interaction, which freezes the track mapping while grabbed. Every programmatic
`scrollTop` write is echo-tracked (0.25px) and its scroll event consumed, so
reducers see only user input; in `USER_CONTROLLED` each redraw re-derives
`scrollTop` from the anchor (`views/transcript-scroll-engine.ts`). A live
selection freezes eviction (`views/scroll-selection.ts`); per-chat state
persists to localStorage (`models/transcriptScroll/persistence.ts`). A "jump
to latest" pill is a listed follow-up, not built (`transcript-smooth-scroll.md`).

Bee Box's model is the inverse: `useChatScroll` writes `scrollTop` only on a
discrete user action plus geometric compensations; growth below the reader
never scrolls; a send anchors the user message to the viewport top; it keeps
no intent state (`beebox/src/frontend/src/components/chat/CLAUDE.md`;
`beebox/docs/chat/scroll.md`). Studio follows and detects intent; Bee Box never
follows so needs none. Studio virtualizes to 50k events; Bee Box renders a
200-entry tail plus "load older" (`beebox/src/frontend/src/machines/chat-types.ts`)
and removed Virtuoso deliberately.

## 6. Other notable points

**Vocabulary and output style.** `.agents/shared/references/user-facing-language.md`
is the one vocabulary for replies, step titles, summaries and notifications:
version control, tests, paths, dependencies, commands, agent machinery and
container words are "invisible plumbing", each with a lay translation;
`AGENTS.md` makes every `tk` title user-facing copy. `.agents/output-styles/engineering-subordinate.md` assumes a
non-technical manager and forbids preamble, recaps and closers; its effect on
rendering is indirect (short prose runs, plain titles).

**Accessibility.** Sparse: `aria-label` on buttons, `aria-live="polite"` on the
activity and connecting strips, `role=switch` on Source view (grep of
`frontend/src/views/`); no landmarks, no `role=log`, no scrollbar keyboard model.

**Tests.** vitest + jsdom, 886 tests in 70 files (`frontend/package.json`);
heaviest are the transcript walk (`views/turn-grouping.test.ts`, ~2k lines),
the composer, the model menu, and the pure scroll modules. Backend: pytest
with a 75% coverage floor, browser tests under `-m browser`, and one randomized
"conservation" test per harness (`README.md` "Development"; contract Part D).

## Lessons for Bee Box

1. Backend-stamped display decisions (`harnesses/message_display.py`) vs
   client tag stripping (`beebox/src/frontend/src/components/chat/message-parsing.ts`).
   **Adapt**: classify in `adaptSdkMessage` so web, Telegram and iOS agree.
2. Payload-free events with on-demand detail (`events.py`, `tool-payloads.ts`)
   vs image-only stripping (`beebox/docs/chat/history.md`). **Adapt**: extend
   the `<session>/<uuid>/<index>` reference to large tool payloads.
3. One chip row per tool run, verb + target (`ToolChipGroup.ts`) vs
   `ChatMessages/activity-rendering.tsx` describers. **Adopt** the collapsed
   row; the describers already produce the text.
4. Lifecycle conservation law and one permitted optimism
   (`messages-lifecycle-contract.md`) vs `history.md` pending/entries and
   `sessions.md` queue/drain. **Adopt** the states table, "never swallowed",
   and a randomized doctest over enqueue/drain/stop/restart.
5. Stop returns undelivered text to the composer in send order
   (`drain-to-composer`) vs `stop()` clearing the queue (`sessions.md`).
   **Adopt**: clearing loses typed messages.
6. Activity inferred from the JSONL tail (`claude/activity_state.py`) vs
   `isStreaming` from the SDK stream. **Reject**: Bee Box has the SDK's
   `result` event; tail inference is the workaround for lacking it.
7. `tk` step timeline with hook enforcement (`turn-grouping.ts`, P5-P7) vs no
   step concept. **Later**, as agent procedure not blocking hooks (memory:
   arrange context, don't automate judgment).
8. One user-facing vocabulary file (`user-facing-language.md`) vs STE rules in
   `issues/CLAUDE.md` and the briefing's "Reaching me". **Adapt**: one
   box-side reference the agent guide loads (`bbx-context` territory).
9. End-of-turn notification skill, explicitly no hook (`notify-user/SKILL.md`,
   P8) vs `bbx notify` (`beebox/docs/notifications.md`). **Adopt** the
   one-per-turn "must know or act" rule in `REACHING_THE_BOXHOLDER`.
10. FOLLOW/USER_CONTROLLED with echo-tracked writes
    (`transcript-scroll-engine.ts`) vs `chat-scroll.ts` "never follow".
    **Reject**: Bee Box removed intent detection after device-only bugs;
    Studio is Chromium-first. Take only the `?debug=scroll` ring trace.
11. Element references as `REF-<id>.json` (`models/elementReferences.ts`) vs
    card paths and `[file#N]` tokens (`InteractiveChat-attachments/attachments.ts`).
    **Reject**: card paths are already the primitive.
12. Intake route with `is_draft` (`chat_intakes.py`) vs quick chat routing
    (`beebox/docs/chat/quick-chat.md`). **Adapt** the draft-vs-send distinction
    for share-sheet and capture; skip tokens with one client origin.
13. Error rendering from Claude Code's record stamps (`claude/error_notice.py`)
    vs SDK stream errors and `cli/lib/session.ts` replay. **Adopt** for
    replay: a rate-limit line from JSONL should render as a failed turn.
