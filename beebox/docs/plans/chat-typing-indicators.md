---
title: "A shared chat shows who is typing or dictating"
status: draft
workstream: self-hosted-turn
issues:
  - ../../../issues/features/2026-11-12-chat-shows-who-is-typing-or-speaking.md
---
# A shared chat shows who is typing or dictating

When two people have the same chat open, each sees the other's head under the
profile avatar. This plan adds what the other person is doing in the
composer: typing, or dictating with the mic. It rides the existing presence
channel and stores nothing.

**Issues addressed:** `issues/features/2026-11-12-chat-shows-who-is-typing-or-speaking.md`
(web half; see NOT in scope for iOS). Grepped the queue for "typing",
"speaking", "dictating", "is typing": the closed parent
`issues/closed/features/2026-11-11-chat-shows-who-is-present-and-typing.md`
is the only other hit.

## Design

### Situations

- When Priya and Tomas share a chat about the weekend and Tomas is writing a
  long reply, Priya wants to see that he is writing, so she waits for it
  instead of sending a message that crosses his.
- When Tomas is dictating to the chat with the mic, Priya wants to see that
  he is talking to it, so she does not start a second thread of thought.
- When Priya is alone in a chat, she wants nothing new on screen. The heads
  are already absent then, so the indicator is too.
- When Tomas types a word and stops, Priya does not want a "typing" mark that
  sticks. It goes away a few seconds after his last keystroke, and at once
  when he sends or clears the text.

### Right place, right time

The indicator is a small badge on the person's head under the avatar: three
dots for typing, a mic for dictating. The head is where the person already
appears, so the badge needs no new surface. It waits to be seen; it makes no
sound and moves nothing. The head's tooltip and accessible name say "Tomas is
typing" or "Tomas is dictating". A person counted in the `+N` disc shows no
badge; the disc's label names them as before.

### Spirit

Serves "feel like a place": two people in one chat see each other act.
Risks "see the gears" only if the badge lingers after the person stopped, so
the badge expires on its own (Failure modes).

### Trust

Automatic and ambient, like presence itself: a person present in a chat is
already visible to the others there. The indicator says only *that* someone
is typing, never what. Nothing is stored.

### Wrong or nothing

A lost "stopped" message leaves the badge for at most the server's expiry.
A dropped connection removes the head, and the badge with it.

## Smallest fix and budget

Smallest fix: one upstream mutation, one frame kind, a badge. Chosen design
is that, plus an expiry so a badge never sticks. Estimate: ~180 source lines,
~150 test lines; docs ~25 lines (`docs/chat-presence.md`).

## Stated preferences this plan trades against

- `docs/chat-presence.md`, "Adding to the channel": *"Later work (typing
  indicators, call signaling, ringing) adds frame kinds to the
  `ChatPresenceFrame` union, and an upstream message gets its own
  `authedProcedure` mutation"* and *"Nothing about presence is stored."* This
  plan follows both.
- Keystroke performance, `components/chat/input-store.ts:5-7`: *"each
  keystroke would re-render the whole chat subtree"*. The composer reports to
  a module store; nothing above the textarea re-renders on a keystroke, and
  the network sees a change only when the state changes.

## What already exists

- Presence room and frames: `src/core/chat/presence/room.ts` (`notifyWatchers`
  sends each kind only when its JSON changed, `lastSent`). Reuse; add a kind.
- Watch subscription: `src/webapp/trpc/routers/chat-presence.ts` keeps the
  newest unsent frame per kind. Reuse as is; a new kind fits.
- Who the caller is: `personFor(ctx)` in `src/webapp/trpc/chat-room.ts`. Reuse.
- Heads: `PresenceHeadsFace.tsx` (pure) and `PresenceHeads.tsx` (subscription,
  knows the watched `sessionId`). Extend both.
- Typed keystrokes: `ComposerTextarea.tsx:52` `onChange` runs only for the
  person's own typing (`if (!isTranscribing)`), so draft restores and
  programmatic `setInput` do not count. Hook there.
- Dictation: `voice.ts:200` `isTranscribing`. Read it in `shell.tsx` where
  `voice` is in scope.

## Prior art (external)

No decision depends on an external premise. The pattern (state on change,
refresh while active, server expiry) is the common typing-indicator shape.

## Ontology

- **Composing** (new, `Composing`): `"typing" | "dictating"`; what one person is
  doing in a chat's composer now. Not stored. Not the message text.
- **Composing frame** (new `ChatPresenceFrame` kind): `{ t: "composing",
  active: { email, doing }[] }`, everyone else in the room composing. Named "composing", not "activity", so it is never mistaken for the activity log (`docs/implemented-plans/activity-log.md`).
- `PresentPerson`, watcher, room: existing (`presence/types.ts`, `room.ts`).

## Tracks / scope

### A. Server: composing in the room

- **Direction.** `Room` gains `composing: Map<emailLower, { doing, cancel }>`.
  `ChatPresence.setComposing({ boxRoot, sessionId, email, doing: Composing | null }): boolean`
  is false unless the email has a watcher in that room. A non-null value
  arms an expiry (`COMPOSING_TTL_MS = 8000`, through `setTimer`) that clears
  it. A person's state clears when their last watcher in the room leaves.
  `notifyWatchers` sends each watcher `{ t: "composing", active }` for
  everyone except itself, only when it changed (`lastSent.composing`).
  Router: `chatPresence.setComposing` mutation, input
  `{ sessionId, doing: z.enum(["typing","dictating"]).nullable() }`, caller
  from `personFor(ctx)`; returns `{ ok }`.
- **First chunk.** room + router + room tests.

### B. Client: report and show

- **Direction.** `lib/composing.ts`: a small store.
  `noteTyped(text)` (empty text clears typing; otherwise typing until
  `TYPING_IDLE_MS = 5000` after the last call), `setDictating(on)`,
  `subscribe`, `get(): Composing | null` (dictating wins). The pure
  part `composingAt({ lastTypedAt, textEmpty, dictating, now })` is tested.
  `ComposerTextarea` calls `noteTyped` in `onChange` and clears when `input`
  becomes empty (a send). `shell.tsx` effect mirrors `voice.isTranscribing`
  into `setDictating`.
  `PresenceHeads` while watching a session: sends `setComposing` on each
  change and every `ACTIVITY_REFRESH_MS = 3000` while non-null; sends null
  when it stops watching with a state set. Composing frames merge into
  heads by email; `PresenceHead` gains `doing?: Composing`.
  `PresenceHeadsFace` draws the badge and names it.

## Could this be simpler?

Simplest: no expiry, send on change only. Fails when the "stopped" message is
lost (tab frozen, network drop without socket close): the badge sticks until
the socket dies, up to ~35 s (`docs/chat-presence.md`). The expiry plus
refresh costs ~20 lines. Simpler still: carry the state inside the `others`
frame. Rejected: `others` entries are `PresentPerson` used by calls and by
every room test; a separate kind changes nothing existing.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| "Stopped" never arrives | room test: expiry clears | TTL 8 s | clear: badge goes |
| Person leaves while typing | room test | cleared on last watcher leave | clear |
| Mutation from someone not watching | room test returns false | ignored | silent, harmless |
| Draft restore marks typing | — | only `onChange` counts | n/a |
| Send leaves "typing" for 5 s | composingAt test (empty text) | clear on empty input | clear |
| Two tabs, one stops | — | last write wins; accepted | brief wrong badge |

## Agent-flow / user-flow edge cases

- The box's agent never joins a room (`ctx.actor === "agent"`), so it never
  shows as typing. ADDRESSED (`personFor`).
- Partial rollout: an old client ignores an unknown frame kind
  (`PresenceHeads` switches on `t`; the `else` branch must not treat
  `composing` as `others`). ADDRESSED in track B.
- Other edge cases (tags, cards, migration) do not apply: no stored data.

## Plan review (Codex, gpt-6-sol)

- Draft carried across a chat switch would show "typing" in the new chat:
  fixed; `reportComposingTo` forgets typing on arrival.
- First send could beat the watch join: fixed; sending starts after the
  watch's first frame, and the 3 s refresh retries a refused state.
- An older send could revive a stopped badge: fixed; sends are chained.
- One tab can clear another tab's state: accepted and documented; a per-tab
  lease costs more than the brief wrong badge it prevents.
- Box switch leaving the watch (WebSocket) and the mutation (HTTP) on
  different boxes: accepted and documented; the room refuses the state, so
  the failure is a missing badge, and calls' `signal` already has the same
  shape.

## Code review (Codex, gpt-6-sol)

- Typing during the 1 s join delay was forgotten when the watch became
  ready: fixed; typing is forgotten only when the chat changes.
- Queued sends could deliver a stale state late, across effect lifetimes:
  fixed; one module-wide sender keeps only the newest waiting state.
- A paste counts as typing: kept; a paste is composing. Docs say "an edit".

## NOT in scope

- iOS native composer typing/dictating: needs a native→web bridge message
  (`docs/mobile-contract.md`); the issue stays open for that half. iOS still
  *shows* others' badges, since the heads are web.
- Speaking on a call (active-speaker ring): a separate, local audio-level
  feature; not asked in the issue.
- "Typing" line near the composer: the head is enough for two or three people.

## Open design questions

none

## Knowledge audits

Skip: no agent-facing concept.

## What will hold this after it ships

Room unit tests (expiry, leave, not-present, self-excluded, dedupe of sends);
`composingAt` unit test; `PresenceHeadsFace` render test for the badge label.

## Implementation order

1. Track A with tests.
2. Track B with tests; docs/chat-presence.md.

## Rollout shape

Done when the room and client tests pass, typecheck and lint pass, and two
browser tabs as two people show the badge appear and clear.
