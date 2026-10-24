---
title: "One pink bar flattens unrelated status and error states"
workstream: error-severity
resolution: implemented
area: beebox
labels: [journey-findings, ui-sensibility]
filed-by: agent
discovered-by: agent
discovered-in: worktree-user-stories-refresh — journey A, 2026-08-25 walk
priority: important
---

> **Closed 2026-10-20 (bug-burndown-4):** fixed by `d820b66ab` ("Chat status
> bar shows errors and warnings at their real severity", on `main`), per the
> plan and outcome below. The unreproduced new-chat session-id residual is
> filed as
> [its own issue](2026-10-20-new-chat-dropped-stream-warning-can-stick.md).
> The other residuals stay as recorded in the outcome.

## Recovery assessment (2026-09-21)

The shared error banner remains: `InteractiveChat-layout.tsx:26-44` combines
plain chat and transcription error strings under the same danger styling.
The original first-run navigation error-counter subclaim is outdated:
`AppNav.tsx:239-249` now gates that counter on opening Debug Log, as recorded in
the [closed vocabulary sweep](2026-08-08-implementation-vocab-leaks-into-ui.md).
This is not the schedule-alert surface fixed in September. The mic interaction is excluded from the product finding. No current browser
comparison of the remaining auth and connection states was performed.


> Recovered 2026-09-21 from `worktree-user-stories-refresh` at `f914fcb4e`.
> The account below describes the 2026-08-25 walk, not a new reproduction.
> Source line numbers in that account are historical. Current disposition is recorded above.


When the box shows me red text, I want its urgency to mean something, so that
when it matters I still look.

Journey A's walker met the same pink error bar for two independently observed
product states in one evening, with unrelated meanings:

1. **"Claude Code is not logged in — run `claude auth login` on this machine"**
   — the box's AI was unreachable; their message got no answer. Severe, and
   transient — retrying fixed it, which nothing on screen suggested.
2. **"Active connection is not open"** — benign; the reply arrived fine anyway.

The historical account also includes **"Recording didn't start. Please try
again."** from an automated-browser interaction. Journey walks do not test
microphone or voice behavior, so this observation is excluded from the product
finding.

The walker reported learning to ignore the shared error surface. Their original
comparison also included the excluded microphone interaction; it does not
establish a third product severity.

Learning to ignore the error surface on night one is the worst possible
training. The severities are already distinguishable at the call sites; the
presentation flattens them. A transient that self-healed (2) arguably should
not surface at all once the reply lands — code-style's logging-levels policy
("a degradation that stayed visible" is warn, not error) has no UI counterpart.

Also observed, same family: each of these increments the red nav error counter,
so by evening's end the badge read 3+ with nothing wrong.

Related: [implementation-vocab-leaks-into-ui](2026-08-08-implementation-vocab-leaks-into-ui.md)
(the wording of 1); the debug-log badge notes appended there on 2026-08-23.

## Plan (2026-10-17, worktree-error-severity)

Every source that reaches chat's status bar, by what it means for the person:

| Source | What the person sees | Class |
|---|---|---|
| History failed to load (`fetchInitial` onError) | The conversation did not load | a — must act |
| Send refused, or its start request failed (`STREAM_FAILED`, `accepted: false`; includes the "not logged in" refusal) | Message got no answer, as far as the page knows | a |
| The box reported the turn failed (`STREAM_ERROR`) or the run died (turn-stream `error` frame) | Message got no answer | a |
| Legacy `STREAM_BUSY` | Message was dropped | a |
| Native composer did not confirm a selection | Selection was not added | a |
| Live turn stream dropped (subscription `onError`, e.g. "Active connection is not open"; stream ended with no result) | The live text stopped; the reply may still land | c if the reply lands, b while the box is still working, a if the box stopped with no reply |
| Recording did not start (start timeout, setup error) | Nothing was recorded | a |
| Live transcription lost during recording, transcription timeout, microphone interruption or loss | Recording kept going or kept its text | b (interruption already clears itself on recovery: c) |

Change:

1. Chat machine: a dropped turn stream becomes its own event. It does not set
   `error`. The refresh that follows decides: the reply is in history → clear
   with no banner; the box is still busy → a warning that the reply will
   appear; the box is idle with no reply → an error that the box stopped
   before answering.
2. Transcription machine: each error carries a level (`error` or `warning`).
3. The status bar renders errors in the existing danger style and warnings in
   the existing `warning-50` style used by settings and voice notices.

Not changed: wording of server refusals (their own copy; see the vocab issue).

### Outcome (2026-10-17)

Implemented as planned, plus two fixes from the cross-model review (codex
gpt-6-sol): a reply already in history clears the warning even while a queued
later turn keeps the box busy, and *dismiss* clears only the message shown.
Verified in the worktree's test box by making the turn-stream subscribe fail
with "Active connection is not open": a short reply landed with no bar; a long
turn showed the warning, which cleared when the reply landed; with the box's
agent process killed mid-turn, the error showed.

Residuals, left in their current class:

- A send whose start request fails on the network (`accepted: false` with no
  refusal) may still have been admitted by the box. It stays an error and the
  optimistic message is dropped, as before this change. Telling the two apart
  needs a receipt lookup.
- If the history refresh after a dropped stream fails, and `chat-complete`
  arrived during that refresh, the warning stays until the next send or
  dismiss. Before this change the same case left the danger bar.
- A message queued while the dropped turn's box is still busy sits after the
  reply in history, so the warning stays until that later turn ends, then
  clears. Identifying the dropped turn's own reply needs turn correlation.
- Reviewer-reported, not reproduced: in a new chat, if the turn stream fails
  before the box assigns the session id, the machine keeps `sessionInput:
  "new"` and every refresh takes the no-history branch, so the warning could
  stay until the next send, dismiss, or reload. Two test-box runs of a new
  chat recovered. A reliable fix needs the session assignment tied to the
  accepted turn (a protocol choice for Ian).
- The legacy `STREAM_BUSY` text ("Agent is busy with another request") is
  unchanged.

Decided (Ian, 2026-10-17): server refusals keep their own words in the bar,
e.g. "Claude Code is not logged in — run `claude auth login` on this machine".
Repeating the server's error is acceptable; the chat bar does not remap them.
