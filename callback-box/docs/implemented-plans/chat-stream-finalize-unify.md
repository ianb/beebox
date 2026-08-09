---
title: "Chat streaming/finalize unification: one stably-keyed assistant turn"
status: implemented
workstream: unknown
issues: []
---
# Chat streaming/finalize unification: one stably-keyed assistant turn

When a streamed assistant response finalizes, the live streaming bubble is
unmounted and the completed message is mounted in its place — a visible
"shudder" (the streamed text disappears and the full response pops in). This
plan renders the live assistant turn and its finalized form through **one
component under one stable React key**, so finalize becomes an in-place props
update rather than a remount. It also brings the now-playing speech highlight to
the streaming state (today it only appears after finalize).

## Implementation notes (as shipped — supersedes details below)

The plan body below is the original design; a cross-model (codex) review of the
implementation corrected three points. As shipped:

- **Keying binds to a *specific* group, not "the newest assistant."** The early
  draft (Track 3, Implementation order) keyed whichever assistant group was
  newest while `liveTurnId` was set — which a background/queued turn appending
  later would hijack (remounting the real turn, mis-keying the new one).
  `MessageList` instead tracks the live group's uuid across renders
  (`nextLiveTargetUuid` + set-state-during-render): the provisional's synthetic
  uuid while streaming, then the finalized group's real uuid captured at the
  transition, held until the next turn. A no-response turn finalizes to no
  assistant group, so nothing stays live and the provisional simply unmounts.
- **`liveTurnId` is set only on the idle `SEND`**, not in `dispatchQueuedSend`
  (the queued/background path doesn't stream a fresh provisional bubble, and the
  specific-group binding above means it can't steal the live key anyway). The
  "dispatchQueuedSend sets it" mentions below are not implemented.
- **Provisional content order is `[...streamTools, textBlock]`** (tools above
  text) — this matches the typical finalized order (tools usually run before the
  answer), minimizing reshuffle. The "[textBlock, ...toolBlocks]" note below is
  wrong.
- Verified via `bin/browse` node-identity checks (the tagged streaming node keeps
  its JS identity through finalize) on synthetic and real turns, plus a
  `buildStreamEntry` doctest. No automated queued-path test was added.

## Stated preferences this plan trades against

- `callback-box/CLAUDE.md` — *"don't add features beyond what the task
  requires."* The unification removes a parallel render path rather than adding
  one; the only net-new surface is an `isStreaming` branch inside an existing
  component.
- `callback-box/CLAUDE.md` — *"Frontend uses UI primitives and a semantic
  palette. Read frontend.md before writing UI"* and the
  `restrict-component-classes` rule (chat is under `components/`, so exempt).
- `~/.claude` memory `feedback_components_own_a11y` — the streaming cursor is an
  element rendered by `AssistantMessage` itself, not a wrapper bolted on.
- `callback-box/code-style.md:37` — max 2 positional params; new/changed
  signatures take a named options object. `:58` — files ≤300 lines, functions
  ≤150 (`ChatMessages.tsx` is at 229 and `AssistantMessage` is ~100 lines — the
  `isStreaming` additions must not push the function past 150; extract a helper
  if needed).
- `callback-box/docs/testing.md:5-9` + `:474-521` — layout/streaming behavior is
  verified via `bin/browse` + `/fakestream`, not doctests; tests anchor specific
  regressions.
- Precedent: `docs/implemented-plans/chat-scroll-redesign.md` (just shipped) —
  established the "exactly one authority owns the behavior" principle for scroll;
  this plan applies the same single-source-of-truth idea to message *identity*.

## What already exists

- **`InteractiveChat-message-items.tsx:107-129`** — the `DataItem` union and
  `dataItemKey`. The streaming tail is a distinct `{ kind: "stream" }` variant
  keyed `"stream"` (`:110`, `:124`); a finalized turn is `{ kind: "group" }`
  keyed `group.entries[0].uuid` (`:108`, `:127`). **This key+kind change is the
  remount.** Rebuilt: the streaming tail becomes a `{ kind: "group" }` holding a
  provisional assistant group, and keying is overridden so the streamed and
  finalized turn share a key (Track 3).
- **`InteractiveChat-message-items.tsx:80-88`** (`StreamingMessage`) and
  **`:270-303`** (`renderDataItem`, the `"stream"` branch `:280-295` rendering
  `StreamingMessage` + `ToolList` + `StreamingThrobber`). Rebuilt: streaming
  renders through `GroupItem`→`AssistantMessage` instead. `StreamingMessage`
  becomes dead and is removed.
- **`InteractiveChat-message-items.tsx:32-43`** (`chunkOnParagraphs`) — trims the
  streamed buffer to the last safe boundary (paragraph break or closed
  `</speech>`/`</ack>`/`</callout>` tag) so half-typed structured tags don't leak
  as raw XML. Reused: the provisional group's text is `chunkOnParagraphs(streamText)`
  for the same safety reason.
- **`InteractiveChat-message-items.tsx:98-105`** (`StreamingThrobber`) — reused
  for the `{ kind: "processing" }` reload-mid-turn case (`:296-298`) and as the
  "no text yet" state inside the streaming `AssistantMessage`.
- **`InteractiveChat-message-items.tsx:210-263`** (`GroupItem`) and
  **`ChatMessages.tsx:61-159`** (`AssistantMessage`) — the finalized renderer.
  `AssistantMessage` groups entries via `groupIntoParts` (`:91`), renders text
  through `AssistantSpeechText`→`MarkdownContent` (`:140-156`), interleaves tool
  activity, and shows the `SpeechMenu` + now-playing highlight (`:122-139`,
  `activeIndex` `:107`). Reused as the single renderer for both states; extended
  with an `isStreaming` option (Track 4).
- **`ChatMessages.tsx:30-59`** (`AssistantSpeechText`) — already the shared text
  renderer for both paths (`StreamingMessage` calls it at
  `message-items.tsx:85` with `activeIndex={null}`; `AssistantMessage` calls it
  at `:145-151` with the real `activeIndex`). This is why unifying is cheap and
  why the streaming highlight gap closes for free once streaming goes through
  `AssistantMessage`.
- **`chat-actors.ts:362-375`** (`rollupStreamToEntry`) — already builds a
  synthetic assistant `SessionEntry` from `streamText` + `streamTools` (content =
  `[...streamTools, { type:"text", text }]`, uuid `assistant-stream-${Date.now()}`).
  Reused (lifted to a shared pure helper) to build the provisional group's entry
  for rendering — same shape the machine already rolls up on the `"new"` path.
- **`message-parsing.ts:169-170`** — `MessageGroup` assistant variant is
  `{ type: "assistant"; entries: SessionEntry[] }`. Reused: the provisional group
  is exactly this shape, so `GroupItem`/`AssistantMessage` accept it unchanged.
- **`chat-types.ts:46-94`** (`ChatContext`) and **`chatMachine.ts:163-180`** (the
  idle `SEND` assign) — the machine context + where a turn starts. Extended with
  `liveTurnId` (Track 1).
- **`chat-actors.ts:362-375`** synthetic uuid and **`chatMachine.ts:318-324`**
  (refreshing onDone, `"new"` path rollup) / **`:326-339`** (real path
  `reconcilePending`) — the two finalize paths. Both must end with the finalized
  assistant group keyed the same as the streamed provisional (Track 3).
- **`InteractiveChat-speech.ts:54`** — speech playback id is
  `stream-${Date.now()}-${baseIndex}`; **`message-items.tsx:240-244`** matches it
  by `playingMessageId.startsWith("stream") && groupIndex === lastAssistantGroupIndex`.
  Reused: once the streaming turn renders through `AssistantMessage` at the
  last-assistant index, this existing match lights the highlight during streaming
  with no new wiring — provided `lastAssistantGroupIndex` counts the provisional
  group (Track 4).
- **`InteractiveChat-scroll.ts`** (shipped) — the content `ResizeObserver`
  re-pins while following. Reused unchanged: the provisional group growing in
  place fires the observer exactly as the old stream item did, so follow-the-tail
  is unaffected.

## Prior art (external)

From the cross-app research pass on stream→final flicker (assistant-ui, Vercel
ai-chatbot, Streamdown):

- **One stably-keyed message, content grows, status flips — unanimous.** Vercel
  ai-chatbot keys strictly `key={message.id}` and derives streaming as a boolean
  (`status === "streaming" && last index`), never a different component
  (`components/chat/messages.tsx`). The AI SDK wire protocol enforces one stable
  `messageId` from `start` through `finish`
  (https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol). assistant-ui renders each
  part by index-memoized component with `status: running → complete` as a prop on
  the same instance
  (`packages/core/src/react/primitives/message/MessageParts.tsx`). **Our separate
  streaming bubble + swap is the named anti-pattern.** This is the architecture
  this plan adopts.
- **Don't key off content or status.** Streamdown keys markdown blocks by index,
  not content hash, with an explicit comment that hashing "causes unmount/remount
  when content changes" (https://github.com/vercel/streamdown). Mirrors our fix:
  the live turn's key must not change at finalize.
- **Incomplete-markup healing** (`remend` in Streamdown) renders half-typed
  constructs as their final element so nothing is withheld-then-revealed. Our
  `chunkOnParagraphs` is the opposite (withhold-then-reveal), which is why a small
  remainder still settles at finalize. Full healing of our app-specific
  `<speech>`/`<callout>` tags is **out of scope** here (NOT-in-scope) — noted as
  the residual after the remount is gone.
- **Inline cursor, not a block** — assistant-ui's `MessagePartPrimitive.InProgress`
  renders the caret inside the text flow so its removal is a repaint, not a
  reflow. This plan's `isStreaming` caret follows that.
- No prior art found for unifying *app-specific structured-tag* streaming
  (`<speech>` segments with now-playing highlight) with the finalized render —
  that integration is ours; the building blocks above inform it.

## Tracks / scope

Ordered by dependency: machine id first (unblocks keying), then the provisional
group + unified render, then keying, then the `isStreaming` polish.

### Track 1 — `liveTurnId` in the chat machine

- **What.** A per-turn client id, stable from the moment a turn starts streaming
  through its finalize, until the next turn starts.
- **Why this needs to change.** The streamed tail and the finalized group must
  share a React key to avoid the remount, but the finalized group's real uuid
  isn't known while streaming (server-assigned on the real path). A turn id known
  at send time, carried across the transition, is the shared handle.
- **Direction.** Add `liveTurnId: string | null` to `ChatContext`
  (`chat-types.ts:46`), init `null` (`chatMachine.ts` context init ~`:55-71`).
  Set it to the turn's `messageId` wherever a turn begins streaming: the idle
  `SEND` assign (`chatMachine.ts:163-180`) and the queued-dequeue dispatch
  (`dispatchQueuedSend`). Do **not** clear it at finalize — it persists so the
  finalized group stays keyed by it; the next `SEND` overwrites it. Expose it
  through `InteractiveChat` → `InteractiveChat-view` → `MessageList` as a prop
  (alongside the existing `scrollToBottomTrigger` threading).
- **Vocabulary lock-ins.** Context field name `liveTurnId`; the React key form
  `live-${liveTurnId}` (Track 3).
- **First implementation chunk.** Add the field + init + idle-`SEND` assignment +
  prop threading; no behavior change yet (nothing reads it). No open questions.

### Track 2 — Provisional assistant group + render streaming via `AssistantMessage`

- **What.** While streaming, build a provisional `{ type:"assistant", entries }`
  group from `streamText` + `streamTools` and render it through the normal
  `GroupItem`→`AssistantMessage` path, replacing the `{ kind:"stream" }` item and
  `StreamingMessage`.
- **Why this needs to change.** Same key alone isn't enough — React reconciles
  children by component type, so `StreamingMessage`→`AssistantMessage` remounts
  the inner subtree even under a shared wrapper key. The streamed and finalized
  turn must render through the *same component*.
- **Direction.**
  - Lift `rollupStreamToEntry` (`chat-actors.ts:362-375`) into a shared pure
    helper (e.g. `message-parsing.ts` or a small `chat-stream-entry.ts`) and use
    it in `buildDataItems` to build the provisional entry from
    `chunkOnParagraphs(streamText)` + `streamTools`, uuid `live-${liveTurnId}`.
    Entry content order `[textBlock, ...toolBlocks]` matches the current streaming
    layout (text, then tools, then throbber).
  - `buildDataItems` (`message-items.tsx:148-190`): when `streamingShown`, push
    `{ kind:"group", group: provisional, groupIndex }` (the live tail) instead of
    `{ kind:"stream" }` (`:187`). `processingShown`/`pendingHq` unchanged.
  - Remove the `{ kind:"stream" }` union member (`:110`), its `dataItemKey` case
    (`:124`), and the `renderDataItem` `"stream"` branch (`:280-295`); delete
    `StreamingMessage` (`:80-88`). `StreamingThrobber` stays (processing case +
    Track 4 no-text state).
- **Vocabulary lock-ins.** Provisional entry uuid = `live-${liveTurnId}`.
- **First implementation chunk.** The shared rollup helper + `buildDataItems`
  swap + render through `GroupItem`, with `isStreaming` *not yet* wired (so it
  briefly shows no cursor) — verify via `/fakestream` that streaming text appears
  through `AssistantMessage` and finalize no longer swaps component types. No open
  questions in the chunk.

### Track 3 — Stable keying so finalize is in-place

- **What.** Key the streamed provisional group and the finalized group identically
  (`live-${liveTurnId}`), so the finalize render reconciles in place.
- **Why this needs to change.** The provisional uuid is `live-${liveTurnId}`
  (Track 2), but the finalized group carries its real/server uuid — without an
  override its key changes at finalize and remounts.
- **Direction.** In `MessageList`'s render map, compute the key with context:
  the **newest assistant group** (when `liveTurnId` is set) is keyed
  `live-${liveTurnId}`; every other item uses `dataItemKey`. During streaming the
  provisional already yields `live-${liveTurnId}` via its synthetic uuid; at
  finalize the newest *real* assistant group gets the same key via this override
  → same key across the transition → in-place update. The previous turn re-keys
  to its real uuid only when the *next* `SEND` sets a new `liveTurnId` — a
  one-time remount masked by send/scroll/new-turn (the deliberate trade-off).
- **Vocabulary lock-ins.** The "newest assistant group → `live-${liveTurnId}`"
  rule lives in one place (the `MessageList` key function).
- **First implementation chunk.** The key function + wiring `liveTurnId` into it;
  verify with the `bin/browse` flash recorder that finalize shows no remount
  (the streamed DOM node persists). No open questions.

### Track 4 — `isStreaming` affordances inside `AssistantMessage`

- **What.** An `isStreaming` option on `AssistantMessage` that (a) renders an
  inline cursor after the trailing text, (b) shows `StreamingThrobber` when there
  is no visible text yet, and (c) lets the now-playing speech highlight work
  during streaming.
- **Why this needs to change.** The block throbber removal at finalize is a
  layout shift (cause #3 of the shudder); and the user requirement: the streamed
  render must show the active-speech highlight that today only the finalized
  render shows.
- **Direction.**
  - Add `isStreaming?: boolean` to `AssistantMessage` (named option; obeys
    CODE-STYLE). When set: render a caret as an inline element/pseudo-element at
    the end of the last text group (repaint on removal, not reflow); when the
    grouped content is empty, render `StreamingThrobber` inline.
  - Speech highlight: because the provisional group renders through
    `AssistantMessage` at the last-assistant index, the existing
    `playingMessageId.startsWith("stream")` match (`message-items.tsx:240-244`)
    already targets it. Ensure `lastAssistantGroupIndex` (computed in
    `MessageList`) counts the provisional group during streaming so the match
    fires. Pass the real `speechPlayback`/`activeIndex` through (today
    `StreamingMessage` hardcodes `activeIndex={null}` at `:85`).
  - Keep `AssistantMessage` under 150 lines — extract the streaming-cursor/empty
    branch into a small helper if needed (`code-style.md:58`).
- **Vocabulary lock-ins.** `isStreaming` option name on `AssistantMessage`.
- **First implementation chunk.** Add `isStreaming` (cursor + empty-throbber),
  pass it for the provisional group, and thread real speech state; verify the
  caret appears while streaming and the highlight lights on the streaming bubble.
  No open questions.

## Subplans

None. The one genuinely separate sub-question — fully healing incomplete
`<speech>`/`<callout>` tags so the trailing remainder never settles — is
explicitly out of scope (below), not deferred-but-required, so it doesn't need
its own design step now.

## Failure modes

> **Critical gap:** none unresolved. The nearest risk is a turn whose
> `liveTurnId` is never set (keying falls back to uuid → the remount returns for
> that turn); Track 1 sets it on every turn-start path and the Track 3 harness
> check would catch a regression.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| `liveTurnId` not set on a turn-start path (e.g. queued dequeue missed) → finalize remounts for that turn | Track 3 flash-recorder check; add a queued-send variant | Set on idle `SEND` + `dispatchQueuedSend`; fallback key = uuid (degrades to today's behavior, not worse) | Clear (shudder visibly returns) |
| Provisional text includes a half-open `<speech>`/`<callout>` → raw XML fl/leak | `/fakestream` with tag-bearing text | `chunkOnParagraphs` trims to last safe boundary (kept) | Clear (visible raw tag) |
| Tool order in provisional (`[text, ...tools]`) differs from server interleaving → reflow at finalize | `bin/browse` finalize check with a tool-bearing turn | Approximate match; residual is a minor settle, not a remount | Clear (minor) |
| Speech segment indices differ between partial and full text → highlight jumps mid-stream | Manual speech playback check | Indices recompute from current text each render (already how `AssistantSpeechText` works) | Clear (highlight moves) |
| `lastAssistantGroupIndex` excludes the provisional → streaming highlight never lights | Track 4 speech check | Compute it including the provisional during streaming | Clear (no highlight) |
| Removing `{kind:"stream"}` leaves a dangling reference | `pnpm typecheck` + `pnpm lint:knip` | Exhaustive `DataItem` switch makes the compiler flag every site | Clear (compile error) |
| `AssistantMessage` grows past 150 lines | `pnpm lint` | Extract streaming-branch helper | Clear (lint error) |
| Next-turn re-key remounts the previous turn visibly (the trade-off) | `bin/browse` send-time check | Masked by send/scroll/new-throbber; acceptable per Track 3 | Clear (one flash at send, not at finalize) |

## Agent-flow / user-flow edge cases

Frontend rendering surface — no cards/tags/agent-written data — so most template
scenarios are N/A by construction; listed rather than omitted:

- **Wrong tag / wrong field / stale ref / two agents / hand-edit drift /
  fabricated value / validation UX** — N/A (no card or schema path involved).
- **Partial migration / transition state** — this is the core case and is
  **ADDRESSED**: the streaming→finalize transition is exactly the "transition
  state," and the whole plan is making that transition seamless (shared key +
  shared component). The other transition, finalize→next-send, is the documented
  one-time masked remount (Track 3).

## NOT in scope

- **Fully healing incomplete `<speech>`/`<callout>`/markdown tags** (remend-style)
  so the trailing remainder never settles. Rationale: the remount is the dominant
  shudder; the trailing settle is minor and healing app-specific structured tags
  is its own effort. Revisit if the residual is still distracting.
- **Smooth char-by-char text animation** (assistant-ui `useSmooth`). Rationale:
  not the reported problem; adds a moving part. The fix targets the remount, not
  reveal cadence.
- **Streaming-markdown incremental syntax highlighting / Streamdown adoption.**
  Rationale: our markdown renderer is already shared between both states; no
  highlight-reflow was reported.
- **Changing the scroll controller.** Rationale: the provisional group grows in
  place; the shipped controller already follows it. Untouched.
- **Tool-call interleaving fidelity during streaming** beyond the
  `[text, ...tools]` approximation. Rationale: minor finalize settle; full live
  interleaving would need ordered stream events we don't currently retain.

## Open design questions

- **`liveTurnId` source: reuse `event.messageId` vs. a dedicated id?** *Lean:*
  reuse the user message's `messageId` (already unique per turn, already on the
  `SEND` event at `chat-types.ts:17`) — one less id to generate. Settled enough to
  start; revisit only if a turn legitimately has no `messageId`.
- **Inline cursor treatment** (caret glyph vs. `::after` pseudo-element vs. a
  faded dot). *Lean:* a pseudo-element on the last text node so it occupies no
  line box (no reflow on removal). A pure-appearance choice settled in
  implementation with frontend.md primitives.
- *(Resolved)* Same-component-same-key vs. minimize-the-delta — the research is
  unambiguous; this plan does same-component-same-key.

## Knowledge audits

**Skip, with rationale.** No box-agent-facing concept — no card type, tag,
convention, or rule a box agent must recall. This is frontend rendering internal
to the chat UI. The durable guidance (one stably-keyed assistant turn; don't
reintroduce a separate streaming bubble) belongs in the chat
`CLAUDE.md` (`src/frontend/src/components/chat/CLAUDE.md`, shipped with the scroll
work), updated as part of rollout — not in `knowledge-audits.yaml`.

## Implementation order

1. **Track 1** — `liveTurnId` field + init + idle-`SEND` set + prop threading.
   (Commit.) No behavior change.
2. **Track 2** — shared rollup helper + `buildDataItems` provisional group +
   render via `GroupItem`; delete `{kind:"stream"}` + `StreamingMessage`.
   (Commit.) Depends on 1 (uses `liveTurnId` for the provisional uuid).
3. **Track 3** — `MessageList` key override (newest assistant → `live-${liveTurnId}`);
   verify finalize is in-place via the flash recorder. (Commit.) Depends on 1, 2.
4. **Track 4** — `AssistantMessage` `isStreaming` (inline cursor + empty
   throbber) + streaming speech highlight (`lastAssistantGroupIndex` includes
   provisional). (Commit.) Depends on 2.
5. **Cleanup** — `dispatchQueuedSend` sets `liveTurnId` (queued path); update chat
   `CLAUDE.md` with the "one stably-keyed assistant turn" rule; `pnpm lint:knip`
   for dead code; typecheck/lint/test. (Commit.)

The plan completes when the `bin/browse` finalize check shows no remount/shudder
on both the `/fakestream` and a real-agent turn, and the speech highlight appears
during streaming. Shipping is a separate `/finish` signal.

## Rollout shape

- **Test posture.** Behavior is layout/DOM, so verification is the `bin/browse`
  procedure in `docs/chat-scroll-testing.md` (extended), not doctests
  (`testing.md:476`). Concrete done-when assertions: (1) at finalize the live
  assistant DOM node's identity persists (the streamed text node is not
  replaced) — measured by tagging the streaming bubble's node and confirming the
  same node holds the finalized text; (2) no empty/throbber-only frame *after*
  first text within a single turn (reuses the flash recorder from
  `chat-scroll-testing.md`); (3) the now-playing highlight class appears on the
  streaming bubble during playback. The pure helper lifted from
  `rollupStreamToEntry` gets a small doctest (forcing-decomposition purpose):
  given `streamText` + `streamTools`, it returns the expected provisional entry.
- **Knowledge-audit entries.** None (see Knowledge audits). The chat `CLAUDE.md`
  gains a line on the single-keyed assistant turn.
- **Migration.** No data-shape change; `liveTurnId` is transient client state.
  Staged across commits on the worktree; nothing ships until `/finish`.
- **Dependency change.** None.
