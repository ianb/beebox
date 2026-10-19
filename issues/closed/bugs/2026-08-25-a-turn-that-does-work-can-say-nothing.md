---
title: "A turn can do the work and say nothing — and the system prompt is what teaches it to"
workstream: turn-feedback
area: beebox
labels: [journey-findings, prompt-surface]
filed-by: agent
discovered-by: agent
discovered-in: worktree-user-stories-refresh — journey A, 2026-08-25 walk; mechanism traced by a verifier agent
priority: normal
resolution: implemented
---

Resolved by ed3d5ecd4 (2026-09-25). That commit found the same signature on a
production box: a turn on a Claude 5-family model rendered only "ran 2
commands" because the model wrote its answer as a progress update, and the
chat UI hid progress updates under the collapsed thinking row. Progress
updates now render as visible lines, a `no-response` ack no longer hides a
turn that has one, and `core/chat/session/prompts.ts` tells the agent to put
its answer in final reply text. A statement such as "Saoirse borrowed my
stepladder" is covered by the `<ack>` badge on the user's message, which the
prompt already requires for discrete edits. The 2026-08-25 walk's model and
transcript are not available, so this close rests on the matching signature,
not a replay. See
[chat-hides-progress-update-thinking-blocks](2026-09-25-chat-hides-progress-update-thinking-blocks.md).

## Recovery assessment (2026-09-21)

The historical empty reply is retained, but its proposed prompt cause is not
established. `beebox/src/frontend/src/components/chat/message-parsing.ts:420` renders only
nonempty text blocks. Current chat prompts still describe silent bookkeeping,
but also teach bare acknowledgments; the explicit narration-silence rule at
`core/chat/session/prompts.ts:190-192` is scoped to narration mode. Do not treat
that rule as proof that ordinary interactive turns are instructed to say nothing.
No new empty-turn reproduction was attempted. Related background-outcome work:
[agent outcomes need a voice](../features/2026-08-09-agent-outcomes-need-a-voice.md).


> Recovered 2026-09-21 from `worktree-user-stories-refresh` at `f914fcb4e`.
> The account below describes the 2026-08-25 walk, not a new reproduction.
> Source line numbers in that account are historical. Current disposition is recorded below.


When I tell the box something, I want an answer that tells me it landed, so I
can stop holding the thing in my head — which is the product's whole promise.

In journey A the user reported a new lend ("Saoirse borrowed my stepladder").
The turn did everything right in the box — correct row, no invented due date, a
sensible three-weeks-out check-in todo — and rendered as:

> ▸ ran 3 commands

Nothing else. No sentence. The user sat waiting for more, then went and checked
the document by hand:

> "If I tell it something and it answers with nothing, I have to go and check —
> and if I have to go and check, I'm still holding it in my head."
> "I have no way to tell 'done, quietly' from 'fell over'."

They ranked it the worst thing that evening after the login errors.

**Mechanism, verified:** there is no minimum-response contract anywhere. A text
block renders only when non-empty (`message-parsing.ts:384`); a text-free turn
legitimately renders as just the tool summary (`activity-rendering.tsx:260-272`
— and the multi-tool case shows only a count, strictly less informative than
the single-tool case, which names the command). Neither frontend nor backend
detects an empty turn. And the system prompt pushes toward this:
`core/chat/session/prompts.ts:22` says "do your bookkeeping silently", `:138`
provides a no-response ack, `:178` defaults narration silent — guidance written
for *unprompted* activity, with nothing distinguishing "you woke up and tidied"
(silence is right) from "the user just told you something" (silence reads as
failure). The existing empty-turn special case suppresses ack-only bubbles —
the opposite direction.

The fix is probably one distinction in the prompt surface — a user-initiated
statement always gets at least one line back ("Added the stepladder — Saoirse,
no date") — possibly backed by a rendering fallback when an assistant turn ends
text-free on a user-initiated exchange. The same walk shows the target: every
other turn ended with a short confirmation, and the user singled that pattern
out as what made the tool feel dependable.

Related: code-style.md defensiveness rule 5 is this exact rule at the UI layer
("user-initiated actions never silently no-op") — the conversation layer has no
equivalent yet.
