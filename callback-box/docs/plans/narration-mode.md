---
title: "Narration Mode — Design"
status: active
workstream: unknown
issues: []
---
# Narration Mode — Design

> Note: this doc references the Activities system as a coordinate ("the infrastructure that makes activities being phased out work"). Activities have since been removed entirely — see [activities-retrospective.md](../activities-retrospective.md). The narration-as-piecemeal-feature direction described here is what stuck.

## Motivation

Today's chat assumes a conversational rhythm: each user message is a discrete utterance or question, the agent replies, repeat. That's the right default for a conversational assistant — and the wrong shape when the user wants to *narrate*: speak for a long stretch, dump content the agent should sort and file, only sometimes ask a question that needs a real answer.

Narration is **still turn-based** — the user sends a message at a checkpoint, the agent gets a turn to respond. The mechanics don't change. What changes is the *expectations* on each turn:

- The user's turn carries a long, loose dump rather than a discrete utterance.
- The agent's turn is mostly silent: a few `<ack>` chips, maybe a `<callout>` if a real question got asked, no obligation to converse back.
- Transcript quality outweighs transcript latency, because the content is the durable artifact.

## Three features plus a behavior overlay

Narration mode is three features and a system-prompt overlay. The features each ship as one piece — the sub-parts inside each only make sense together — but the three features compose freely with each other and with other chat features. Features (2) and (3) are general-purpose; narration is one consumer.

| # | Feature | Standalone use |
|---|---|---|
| 1 | **Voice intake redesign** — commitment is checkpoint-driven (not natural end-of-utterance), and the committed text comes from a non-streaming HQ transcription pass (Whisper/Voxtral) instead of the realtime track. Realtime stays where it already lives: UI feedback and keyword spotting. | Any chat where voice input wants accuracy over latency, and the user prefers to commit segments deliberately rather than per-utterance. |
| 2 | **Structured response output** — two new tags (`<ack>`, `<callout>`) sit alongside `<speech>` and shape the visible portion of the agent's reply. Backed by a new display pane that gives them dedicated rendering. | Any chat where the agent does real work and the response wants more structure than a wall of prose. |
| 3 | **Control plane** — three coordinated surfaces (user, landmark, agent) for flipping chat-feature flags, with precedence rules and a shared closed set of feature names. | Any chat feature beyond narration: prose visibility, camera view, doc-pinning, etc. The infrastructure that lets activities go away. |

The "narration" UI toggle uses the control plane to enable voice intake redesign and adds a **system-prompt overlay** that tells the agent how to behave: receive content, mostly stay silent, prefer structured output, surface real answers via `<callout>`. Each feature can also be enabled independently — the overlay is the part that's narration-specific.

## (1) Voice intake redesign

Today's voice path already separates the live transcript (UI feedback, keyword spotting) from what reaches the agent — only on send / end-of-utterance does the realtime text become a user message. Narration changes two things about that flow:

1. **HQ transcription** replaces the realtime transcript as the source of the committed user message.
2. **The user's existing send-message keywords** drive commitment, not natural end-of-utterance.

The microphone stays open across segments. Two transcription tracks run on the audio:

| Track | Service | Latency | Used for |
|---|---|---|---|
| Realtime | Voxtral Realtime / Deepgram (existing) | ~100ms | Keyword spotting, live UI text, segmentation cues |
| HQ | Whisper / Voxtral non-streaming | seconds | The text the agent sees, persistent record |

The realtime track keeps doing what it already does — keyword spotting (existing `speech-keywords.ts`), live UI display, and `cancel` / `erase` segment boundaries. The user sees the realtime transcript throughout, including as the draft of the message that's about to be committed. The HQ track is new: when a checkpoint fires, the segment's audio is sent for HQ transcription, and the HQ result **replaces the realtime text in the committed user message** before it reaches the agent. Trade-off: slightly higher latency (HQ is non-streaming) for substantially better accuracy.

The existing send-message keywords ("send message", "deliver message", etc. — see `speech-keywords.ts`) act as **checkpoints** in narration mode. No new keyword vocabulary; narration reuses today's trigger set as-is. A checkpoint triggers:

1. Capture the audio recorded since the last checkpoint (browser-side buffer).
2. Flush it to the backend HQ transcription service.
3. While waiting, the realtime transcript remains visible as a ghosted placeholder of the pending user message.
4. On HQ result, the user message is committed with the HQ text; the realtime buffer clears; mic stays open for the next segment.
5. On HQ failure, fall back to the realtime transcript with a visible error indicator — the user message still goes through.

Existing keywords still work: `mic off` ends the loop; `cancel` / `erase` discard the current buffer. Multiple checkpoints can be in flight — checkpoint flushes the buffer and lets the user keep talking; HQ jobs queue and commit in order.

**Storage.** The HQ transcript is canonical text. The audio is **not** retained after HQ transcription — keeping audio for every segment would stack up fast. The realtime track is throwaway.

**Reuse.** The HQ transcription service is generally useful — capture pipeline, manual upload — but those uses are out of scope here. Designing it as a typed service in `src/services/` (real + fake) keeps future reuse cheap. The HQ provider (Whisper API, Voxtral non-streaming, self-hosted whisper.cpp) is configurable per box/setting.

### UI notes

- Realtime transcript displays as it does today, including during checkpoint processing.
- Some indicator distinguishes narration mode from ordinary recording — wording TBD ("narration mode" is the working name but the chat surface may say something else). Revisit at implementation time.

### Future considerations

Not in this design, noted for later:

- **Temporary audio retention**: keep the segment audio briefly (e.g., one session, then discarded) so the agent can re-read or re-transcribe on demand if a transcription looks wrong. Costs storage; only worth doing if real cases motivate it.
- **Multimodal audio input**: instead of (or alongside) HQ transcription, feed the raw audio to a multimodal model. Genuinely useful for language learning, accent work, pronunciation correction — anything where the *audio itself* is the content, not just a vehicle for words. Would be a separate setting/feature, composing with narration.

## (2) Structured response output

Two new tags shape the visible portion of the agent's reply, backed by a new display pane that gives them dedicated rendering. They sit alongside `<speech>` (auditory) and existing structural tags.

Three tiers of agent output, sorted by how prominent each is intended to be:

| Tier | Tag | Nature |
|---|---|---|
| Background | (untagged prose) | Thinking-aloud, sorting decisions, processing notes. Visibility is a separate concern (see below). |
| Transient | `<ack kind="…" ref="…">` | Indication, not reading material. Icon + earcon primary, with optional brief text. The user becomes aware the action happened; doesn't need to read details. |
| Durable | `<callout context="…">` | Presented and persistent. Content the user must read, written to stand alone in any future view. Survives in feeds, digests, notification previews. |

The two tags are complementary, not alternatives. A turn might emit several `<ack>` indications and one `<callout>`, with surrounding untagged prose that may or may not display depending on the prose-visibility setting.

**Untagged prose visibility is a separable concern**, not intrinsic to narration. There will be cases where hiding untagged prose makes sense outside narration (focused work, low-distraction reading) and cases where showing it makes sense within narration (debugging, agent training). The frontend may bundle it with the narration toggle for UI simplicity, but architecturally it's its own control-plane flag (e.g., `prose="off"`), defaulted to `on` outside narration and `off` when narration is on.

### `<ack>` — transient action indication

The agent emits an `<ack>` to indicate "yes, I'm doing what you asked" — not to write about it. The primary expression is an **icon + earcon**; inner text is optional and is used only when the action isn't obvious from the user's input.

```xml
<ack kind="appended" ref="recipes/Bread.recipe.card"/>     <!-- user asked to add a note; the action is obvious -->
<ack kind="todo-added" ref="todos/Call_Mom.todo.card"/>
<ack kind="edited" ref="recipes/Bread.recipe.card">Rewrote the proofing section for clarity</ack>  <!-- not obvious; text earns its place -->
<ack kind="created" ref="recipes/Sourdough.recipe.card"/>
```

**Schema:**

- **`kind`** (required): closed set of named actions. Each kind has a default icon, default earcon, and default verb-phrase used when the inner text is empty.
- **`ref`** (optional): path to the affected card or file. Renders as a tap link.
- **Inner text** (optional): a short modifier — only included when the action isn't already obvious from the user's input. If the user said "add cardamom to the recipe" and the agent appended a cardamom note, no text is needed. If the agent did something less obvious (chose a specific amount, restructured a section, picked a related file), text earns its place.

Initial closed set (subject to design):

| `kind` | Default phrase | Notes |
|---|---|---|
| `created` | "Created" | A new file/card now exists. |
| `appended` | "Added to it" | Content was added to an existing file/card. Semantic append — may be added to a specific section, not strictly end-of-file. Light editing for flow is OK; the action is still "added content." |
| `edited` | "Edited" | Existing content was changed (not just added to). Wording undecided — `revised` is the other candidate. |
| `todo-added` | "Added to todos" | A new todo. |
| `todo-completed` | "Done" | A todo marked complete. |

The closed set keeps icon and earcon mapping reliable. **If no kind fits the action, don't use `<ack>` at all** — fall back to prose or a `<callout>` if the user needs to see it.

Authoring rules (covered in the system-prompt overlay):

- Use `<ack>` for discrete actions that map to a `kind`. Don't shoehorn other things into it.
- Use inner text conservatively. Default to no text when the action is the obvious thing the user asked for. Only add text when the agent did something the user couldn't have predicted from their input.
- Don't emit `<ack>` just to say "I heard you" — silence is the default acknowledgement in narration. Only emit when actual work happened.

Earcons come later — design once kinds are stable.

**Rendering:**

- Default chat view: a row of compact chips. Multiple acks of the same kind may visually group.
- Narrow display contexts: chips reduce to a single summary indicator ("3 actions"). Tap to expand.
- History rendering: chips remain — structural, not ephemeral.
- TTS: silent.

### `<callout>` — durable, self-contained content

The agent emits a `<callout>` when part of the response needs to be lifted out of the response flow: shown in narrow views, surfaced later in digests, quoted in notification previews. The author writes it knowing it may travel.

```xml
<callout context="What's the weather Saturday?">
Saturday: sunny, high of 72.
</callout>

<callout context="cardamom variation on bread recipe">
Try 1tsp ground cardamom in the dry mix; it'll bloom during proofing.
</callout>

<callout context="calendar conflict">
Your dentist appointment overlaps with the soccer match — both at 10am Saturday.
</callout>
```

**Schema:**

- **`context`** (required): a short string that answers "why are you telling me this?" if the user encounters the callout cold. When the user asked a question, `context` is the question (or a faithful paraphrase). For an alert, it's the subject ("calendar conflict"). For an observation, it's the topic ("about the bread"). Whatever the reason this callout exists — that's the context.
- **Body**: the durable content. Must stand alone — no "as you said" / "that thing" / "the one we discussed."
- No `kind` for now. May add one later if visual differentiation between answers / alerts / questions pays off; defaulting to one undifferentiated tag.
- A response may contain zero, one, or many callouts. Most narration responses will have zero.

`context` is an attribute (not a nested element) because it's a short label, not body content. Keeping it terse keeps the agent honest about whether a single callout is the right granularity — if the context can't be summed up shortly, that's a sign there should be two callouts.

**Provenance.** When a callout is persisted (history, digest, notification), the system records which user message it was a response to. The callout body, the context, and the originating user message together form a unit — the user can navigate back to "what was I doing when this came up?" without that information living inside the callout itself.

**Rendering:**

- Default chat view: rendered inline with mild visual treatment — context as a small heading, body below, distinct from surrounding prose.
- Narrow display contexts (camera view, document view, phone in narration mode): callouts render at full visibility in the visible chat strip; surrounding prose hides; `<ack>` chips collapse. Tap-to-expand reveals the rest of the response.
- Digest / notification / preview: `context` and body together, or `context` alone if heavily compressed. The "context-carries-the-question" convention is what makes this work.
- History rendering: preserved; structural metadata.
- TTS: independent. `<callout>` does not imply speech. To speak the answer, the agent emits `<speech>` separately. Same-content-twice is the agent's responsibility — different jobs, decoupled paths.

**Authoring rules** (covered in the system-prompt overlay):

- Use `<callout>` only when the user must see the content. Most turns have zero callouts.
- Always write callout body as if it's standalone. If the user re-encounters this in a notification three days later with no chat history, does it still make sense?
- If the user asked a clear question, the question (or paraphrase) goes in `context`. The body answers it.
- For proactive observations, `context` is a topic line, body is the observation.

### Display design

For the first cut, both tags render **inline in the normal chat stream** — no separate display pane, no narrow/overlay states yet. The visual model below describes how they look when rendered inline; the more aggressive display states (strip, overlay) are deferred until after the first implementation lands.

**Ack indications.** On emit: a brief earcon plays and a small icon flashes into view, the user's signal that an action happened. After the flash, the indication settles into a compact form attached to the agent's message — a thin chip with the type icon, optional inner text if present, and `ref` as a tap target. Visually muted; not asking for attention, just there if the user looks for it.

- Icon + earcon are the **primary** expression. Inner text is secondary; when omitted, the chip is essentially just the icon.
- Tap target opens the affected card/file if `ref` is present.
- Multiple chips wrap horizontally on the message. When several acks of the same kind appear consecutively, the renderer may visually group them into a count indication ("📋 3 todos") that taps to expand.
- Earcons themselves are TBD — sample audio for each kind needs sourcing. Initial implementation can ship without earcons and add them in a follow-up.

**Callouts.** Block-level cards with elevated visual treatment, separated from surrounding prose:

- The `context` attribute renders as a small label/eyebrow above the body — slightly muted, sentence-case.
- Body uses normal text size, typeset against a subtle background tint or with a left accent stripe for visual lift.
- Vertical space above and below to separate from surrounding text.
- Multiple callouts in one response stack vertically — each is its own card.

Color and primitive choices follow the box's semantic palette (see `frontend.md`); the accent role is appropriate.

**Future: alternate display states.** Once the inline rendering is solid, more aggressive layouts become possible — a strip mode where the chat shares screen with another view and untagged prose hides behind a "more" affordance, or an overlay mode where the chat is hidden entirely and only callouts/acks surface as transient overlays. These are deferred; the initial implementation can ignore them and render everything inline.

**History and external surfacing.**

- History scroll: callouts always remain visible. Very old messages may aggressively collapse acks.
- Digests / notifications / link previews: callout `context` + body together when space allows; `context` alone when heavily compressed. Acks don't surface externally — they're indications by design, not standalone-meaningful.

### Decisions

- Bare `<ack/>` with no `kind` is an error. No fallback — the agent should pick a kind from the closed set or not emit an ack.
- Box-extensible `kind` set is future, not now. Closed set for the initial implementation; revisit if real cases emerge.
- `<ack>`, `<callout>`, and `<speech>` are **siblings, never nested**. If the agent wants the same content shown via callout and spoken via TTS, it emits both as separate tags with the same content.
- Multiple callouts per turn are allowed; they stack vertically.

## (3) Control plane

A unified mechanism for flipping chat-feature flags, with three surfaces and predictable precedence. Built once, all chat features ride on it. This is the infrastructure that makes activities being phased out work — any chat can mix features, and any feature can be flipped from any of the three surfaces.

### Symmetric envelope: `<chat-app>`

One envelope tag — `<chat-app>` — carries chat-app state in both directions. Children are flat attributes:

```xml
<!-- Server-injected on each user message (full snapshot): -->
<chat-app narration="on" prose="off" time="2026-05-09T14:23:00-05:00"/>

<!-- Agent emits to mutate state (delta — only what to change): -->
<chat-app prose="off"/>

<!-- Landmark seeds initial state (snapshot at session open): -->
<chat-app narration="on" prose="off"/>
```

Same outer tag, same attribute shape, semantics implicit by direction:

- **System → agent**: full snapshot, prepended to each user message. Carries `time` plus all current feature states. The agent always sees the latest world.
- **Agent → system**: delta. Only the attributes present count; absent attributes mean "no opinion."
- **Landmark → system**: snapshot at session open. User can override afterward.

Some children are read-only by convention (`time`, future read-only state like `view`, `pinned`); the agent doesn't try to write them. Vocabulary discipline, not a hard schema rule.

`time` lives here because it's stale the moment the system prompt is fixed — moving it to the per-turn `<chat-app>` block keeps it fresh.

### Three surfaces

**User control.** The chat has a `...` menu where settings live; the explicit narration toggle goes there. Voice keyword and slash command paths are possible too, but the menu is the primary surface. The user is in charge by default.

**Landmark control.** A chat landmark card declares feature defaults for chats opened from it. Recurring narration sessions don't need a manual toggle each time.

```xml
<landmark>
<label>Daily dump</label>
<symbol>🎙️</symbol>
<chat-app narration="on" prose="off"/>
<link ref="..."/>
</landmark>
```

Landmark settings are seed values applied at session open. The user can still override them after the chat opens.

**Agent control.** The agent emits a `<chat-app>` delta in its response.

```xml
<chat-app narration="on"/>
<chat-app prose="on"/>
```

Use cases: detecting that the user has shifted into narration shape and adjusting; confirming a voice toggle the user requested ("turn on narration mode" → agent confirms with `<chat-app narration="on"/>` plus an `<ack>`); showing prose because the user asked to see processing detail.

### Closed feature-name set

All three surfaces speak a **shared closed set of feature names**. Adding a new chat feature means registering its name; all three surfaces understand it without further plumbing. Initial set: `narration`, `prose`. Future additions: `camera`, `doc-pinned`, etc.

Values are `on` / `off`.

### Snapshot vs delta

The system emits **full snapshots** on each user message; the agent emits **deltas**. Reasons:

- The state is small (time + a handful of flags). Cost of full snapshot is negligible.
- Full-each-turn is trivially robust against context compaction — the latest user message always carries current truth.
- Delta-with-periodic-refresh would be meaningfully more code: tracking what changed since when, deciding refresh cadence, handling agent "did I miss something" cases.

Revisit if `<chat-app>` grows fat (pinned files, open views, sync details) and the per-turn cost becomes real.

### Precedence

Within a session: **agent flip > user flip > landmark default**. Any explicit flip overrides earlier state and is sticky for the rest of the session. Landmark settings apply only at session open.

The user can always re-override an agent flip from the UI; the agent doesn't lock anything.

### Visibility

When the agent flips a feature, the change is visible — a brief notice in the chat ("narration mode on"), and the toggle UI updates to reflect the new state. The agent doesn't silently change behavior.

The chat header (or a small status area) shows currently-active features so the user always knows what mode they're in.

### State

Feature state lives server-side per chat session, with the browser syncing. The user-toggle UI is bound to the same state the agent flips, so all three surfaces converge.

### Open questions

- Per-thread persistence vs session-only: does flipping narration in a thread carry over when the user returns? Probably yes for landmark-defaulted threads, no otherwise — worth deciding explicitly at implementation time.
- How visible is "agent just flipped a feature" — inline notice, toast, status-bar change, or all three?
- Does landmark control distinguish "default" (user can override) from "required" (locked)? Probably "default" only, to start.

## Composition examples

- Narration alone: agent listens, mostly emits `<ack>` indications, occasional `<callout>` when the user actually asked for something. Untagged prose hidden (prose-visibility bundled with narration).
- Agent speaks when worth it: when an answer is worth hearing aloud (driving, hands-busy), the agent emits a sibling `<speech>` block alongside the `<callout>`. Per-segment choice, not a global flag.
- Structured output without narration: any chat can use `<ack>` and `<callout>`; they render inline whether or not narration is on.
- Landmark-driven narration: a "Daily dump" landmark opens its chat with narration on; the user starts talking immediately.

## System-prompt overlay

When `narration="on"` (visible to the agent in the `<chat-app>` snapshot on each user message), the chat system prompt gets an overlay along these lines (final wording TBD):

- The user is dumping content, not chatting. Receive it: capture memos, file todos, follow up on what was said, ask clarifying questions only when essential.
- Stay quiet unless the user indicated they wanted something — to know something, to have you look something up, to double-check on something. Otherwise, no `<callout>`.
- Confirm work with `<ack>` indications (e.g. `kind="todo-added"`, `kind="appended"`), not prose. Use inner text on the ack only when the action isn't obvious from the user's input.
- When the user asks a real question, put the answer in a `<callout>` with the question (or paraphrase) as the `context` attribute. Write the body to stand alone — assume the user might re-encounter this callout in a digest with no surrounding context.
- Use `<speech>` only when the answer is worth speaking aloud. `<callout>` and `<speech>` are siblings; emit both when you want the same content shown and spoken.
- Tool-driven action (capture, file, follow up) is the primary work; conversation is incidental.

This overlay belongs with the other prompt fragments — see how existing chat composes `CHAT_SYSTEM_PROMPT` plus mode prompts in `src/activities/runtime.ts:resolveSystemPrompt`. Once activities go away, narration's overlay slots into whatever replaces that composition layer.

## UI implications (narration-specific)

Display of `<ack>` and `<callout>` lives in the Display design subsection of feature (2). What follows is narration-specific UI that doesn't fit there.

- Microphone state has a third indicator: "narrating" (mic open, segments pending) vs "recording" (single utterance) vs "idle".
- Realtime transcript renders in a buffer/draft area, not as a sent message; clears at checkpoint.
- Pending HQ transcriptions: ghosted placeholder user message with a spinner; resolves when HQ returns.
- The chat header (or a small status area) shows currently-active features so the user always knows what mode they're in. This applies to all feature flags, not just narration.

## Interactions with existing systems

- **Activities** (`docs/activities-design.md`): being phased out in favor of composable feature flags. Narration is the first feature designed under the new model and explicitly does **not** extend `ActivityMode`.
- **Existing voice path** (`realtimeTranscriptionMachine.ts`, `voiceRecorderMachine.ts`, `speech-keywords.ts`): unchanged for non-narration chat. Narration layers in a parallel HQ-transcription path and changes the rule for when realtime transcripts become user messages.
- **`<speech>` tag** (`speech-parsing.ts`): unchanged. `<ack>`, `<callout>`, and `<chat-app>` are new, parsed alongside, with their own rendering paths.
- **`<self-note>` and existing structural tags**: untouched. The new tags sit beside them.

## Open questions summary

Design-level:

- `<callout>` and `<speech>` — siblings (current proposal), or some richer nesting?
- Does `<callout>` need a `kind` later to differentiate answer / alert / question? (Defer until rendering needs force the split.)
- Closed `kind` set for `<ack>` — what's the initial list, and is it box-extensible?
- Does the system-prompt overlay live with the feature-flag, or in a separate prompts directory?

Implementation-level (not design-blocking):

- HQ transcription service interface and provider choice.
- Audio buffering and transport for checkpoint capture.
- How `<ack>`, `<callout>`, and `<chat-app>` parsing slot into the existing tag-parser pipeline.
- New display pane scope: standalone component, or extension of the existing chat message renderer?
- Earcons for `<ack kind>` — designed once kinds are stable.
- Feature-flag persistence layer: server-side session storage, per-thread persistence, per-box defaults file?
- Feature-name registry: where the closed set is declared and how a feature registers itself.

## Implementation

This section walks the design back into concrete code. Each stage below is deployable on its own; the staging order is partial (B is independent of A; C depends on A; D is independent).

### Stage A — Control plane foundation

The control plane lands first because the other features want to read or write feature state.

**Feature state.** Per-session map of `{ feature-name: "on" | "off" }`. Stored as a `features` field on `SessionHistoryEntry` (defined in `src/core/chat/session/history.ts`). Default is empty — empty means "default behavior, no features active." Server-side is the source of truth.

**Registry.** A small module — `src/core/chat/features.ts` (new) — exports the closed set of recognized feature names and their defaults. Initial entries: `narration`, `prose`. Any unknown attribute on a `<chat-app>` tag is ignored with a warning. This file is also where the `<chat-app>` snapshot serializer and the agent-delta parser live.

**Snapshot injection.** `ChatSession.send()` in `src/core/chat/session/index.ts` is the funnel for user messages. Before the existing `buildContentBlocks(input)` call (around line 882 per the recon), build a `<chat-app>` string from current feature state plus the current ISO timestamp, and prepend it to `input.text`. Existing `<speech>` and `<typed>` wrappers continue as today; the new prefix sits ahead of them. Result: every user message the agent sees starts with `<chat-app narration="…" prose="…" time="…"/>`.

This replaces the timezone slot (`buildTimezoneContext()` in `src/core/box/config.ts`) for time-of-day awareness — time now refreshes per-turn instead of being baked into the system prompt at session start. Keep `buildTimezoneContext` around for non-chat contexts that still want a static TZ line.

**Agent delta parsing.** The assistant message stream contains the agent's response, sometimes including `<chat-app>` mutation tags. Add a parser module `src/core/chat-app-parsing.ts` (new) — parses `<chat-app>` tags out of the assistant content and yields `{ feature, value }` mutations. The parser is called from `ChatSession` at end-of-assistant-turn (not mid-stream — avoid races with frontend syncing). Each mutation updates the session's `features` map and is persisted.

**SSE sync to frontend.** When session features change (user toggle, agent delta, landmark seed), push a `features-changed` SSE event so the frontend toggle UI stays in sync. The existing chat SSE stream in `src/webapp/routes/chat.ts` is the channel.

**User toggle UI.** The `...` menu in `InteractiveChat.tsx` (existing — the chat already has a settings dropdown component) gains a "Narration mode" toggle. Click calls a new tRPC procedure `trpc.chat.setFeature({ sessionId, feature, value })` which mutates server state and broadcasts the SSE event. The toggle's checked state reads from the synced feature state, not from local component state.

### Stage B — Structured response output

`<ack>` and `<callout>` parsing and inline rendering. Independent of Stage A; can ship in any chat.

**Parsing.** New module `src/frontend/src/lib/structured-output-parsing.ts` (alongside `speech-parsing.ts`). Uses the same `parseTags` helper. Exports:

- `parseAcks(content: string): AckIndication[]` — returns `{ kind, ref?, text? }[]`, where `kind` is one of the closed set defined in a shared constants file.
- `parseCallouts(content: string): CalloutBlock[]` — returns `{ context, body }[]`.

The closed `kind` constants live in `src/frontend/src/lib/ack-kinds.ts` (initial: `created`, `appended`, `edited`, `todo-added`, `todo-completed`) with icon mappings. The backend has the matching list in `src/core/ack-kinds.ts` (or a shared types module if one exists). Unknown kinds emit a console warning and render with a generic fallback icon.

**Rendering.** Two new components:

- `src/frontend/src/components/chat/AckIndicator.tsx` — renders a single chip; takes the ack data and an "emit-flash" boolean to drive the on-emit animation.
- `src/frontend/src/components/chat/CalloutBlock.tsx` — renders the context-as-eyebrow + body card.

Both follow the project's UI primitive + semantic palette rules (per `frontend.md`). Hook them into `ChatMessages.tsx` in the assistant-message rendering path, alongside the existing speech-tag stripping (`stripUserDisplayTags`, `hasAssistantSpeech`). After speech parsing, parse acks and callouts; render their components; then render whatever prose remains.

**Provenance for callouts.** When a callout is parsed from an assistant message, it gets implicitly tied to the user message that immediately preceded it (the message it's responding to). The frontend already groups user-then-assistant pairs in `ChatMessages.tsx`; the callout knows its parent group. For external surfacing (digests, notifications) — out of scope for this stage but worth noting — the persisted callout record should include the originating user message's ID.

**Authoring rules in the system prompt.** Add a section to `CHAT_SYSTEM_PROMPT` in `src/core/chat/session/index.ts` describing `<ack>` (closed kind set, conservative use of inner text, don't shoehorn) and `<callout>` (durable, standalone, `context` answers "why are you telling me this"). This section is always present in the prompt — these tags work in any chat, not just narration.

### Stage C — Voice intake redesign

Builds on Stage A (needs `narration` feature flag to be readable).

**HQ transcription service.** New file `src/services/hq-transcription.ts`, following the existing pattern (see `src/services/openai-audio.ts` for the shape):

```typescript
export interface HQTranscriptionService {
  transcribeBuffer(audio: ArrayBuffer, opts?: { mime?: string }): Promise<{ text: string }>;
}
export function createHQTranscriptionService(opts: { provider: "whisper" | "voxtral"; apiKey: string }): HQTranscriptionService;
export function createFakeHQTranscription(opts?: { text?: string }): HQTranscriptionService;
```

Wire into `Services` container in `src/services/index.ts`. Provider choice is a per-box setting.

**Audio transport.** A Fastify raw route (not tRPC — binary upload) at `src/webapp/routes/transcribe-audio.ts` (new): POST `/api/transcribe-audio` accepts an audio blob, calls the HQ service, returns `{ text }`. Same neighborhood as the existing `chat-uploads.ts` route.

**Frontend integration.** Two pieces in `src/frontend/src/machines/`:

- `voiceRecorderMachine.ts` already captures PCM; extend it to retain the buffered audio for each segment (between `cancel` / `erase` / `send`) so it can be retrieved on checkpoint. *(Update 2026-07: `voiceRecorderMachine.ts` was deleted in the capture-mode retirement — the checkpoint-buffering idea needs a new home, likely `realtimeTranscriptionMachine.ts` or a fresh audio-buffer module.)*
- `realtimeTranscriptionMachine.ts` handles keyword detection. When the send keyword fires *and narration is on*, instead of immediately committing the realtime text, the machine grabs the segment's audio buffer, POSTs it to `/api/transcribe-audio`, and only commits the message once HQ returns. On HQ failure, commit the realtime text with an error indicator. When narration is off, the existing path runs unchanged.

Reading the narration feature state in the frontend: subscribe to the same store/state that the toggle UI binds to (synced via SSE in Stage A).

**Narration system-prompt overlay.** Conditional fragment in `ChatSession.buildSystemPrompt()` (around line 596): if `features.narration === "on"`, append the narration overlay text (the rules from the System-prompt overlay section above) to the base prompt. Lives as a constant near `CHAT_SYSTEM_PROMPT` for readability.

**Prose visibility.** `prose="off"` is purely a frontend rendering rule — when `features.prose === "off"`, the rendering pipeline in `ChatMessages.tsx` hides untagged prose in assistant messages (keeps `<ack>`, `<callout>`, `<speech>` visible). No backend change. The settings menu can bundle the prose toggle into the narration toggle for v1 (turning narration on flips both); they're separable in state so they can split later without a data migration.

### Stage D — Landmark seeding

Independent of the others. Lets landmarks declare default features.

**Schema.** Add a `LandmarkChatApp` element in `src/schemas/landmark.ts`:

```typescript
export const LandmarkChatApp = element("chat-app", {
  attrs: { narration: z.enum(["on", "off"]).optional(), prose: z.enum(["on", "off"]).optional() },
});
```

Add it to the `LandmarkSchema` children union. Cardworks/Zod handles the parsing automatically.

**Loader.** In `src/webapp/trpc/routers/landmarks.ts`, `loadLandmarkSummaries()` already iterates landmark children. Extend the per-landmark loader to extract the `<chat-app>` element (if present) and include its attributes in the landmark summary returned to the frontend.

**Application at session open.** When the frontend opens a chat bound to a landmark (the existing `contextDir` mechanism in `chat-session.ts`), the landmark's `<chat-app>` defaults are passed to the new tRPC `trpc.chat.setFeature` calls — one per feature — before the first user message is sent. The agent's first turn sees the seeded feature state in the `<chat-app>` snapshot.

### Cross-cutting notes

**Tests.** Doctest coverage per the project convention:
- Stage A: route-level doctests for `setFeature`, snapshot serialization, delta parsing, registry behavior on unknown features.
- Stage B: pure-function doctests for `parseAcks`, `parseCallouts`, kind-validation, callout `context` extraction.
- Stage C: filesystem doctest with fake HQ service simulating success and failure paths.
- Stage D: schema validation doctest for `<chat-app>` in a landmark, plus loader assertion.

**Backwards compatibility.** Existing chat sessions with no `features` map continue working — the absence of the map means "all defaults," which is current behavior. The `<chat-app>` snapshot still prepends to user messages (with `time` plus an empty feature set), giving the agent the time-of-day refresh as a free bonus. If that turns out to add unwanted prompt noise in vanilla chats, gate the snapshot itself behind a `chat-app-snapshot` opt-in feature; defer that judgment until we see real prompts.

**Logging.** `<chat-app>` mutations from the agent are interesting to log — they're the agent making decisions about its own behavior. Log them at info level alongside the existing chat session logging.

**Where the schema-level constants live.** Both backend and frontend need to know the closed feature-name set and the closed ack `kind` set. Either define them once in `src/core/chat/features.ts` and `src/core/ack-kinds.ts` and re-export from the frontend (existing pattern in the project for shared schema), or copy-with-a-comment if cross-bundle imports become awkward. Prefer the import path if it works without bundler gymnastics.

## Note: possible SCREAMING_SNAKE_CASE pass

`SCREAMING_SNAKE_CASE` for state identifiers (feature names, `on`/`off` values, `<ack>` kinds) was considered — it would make these references read unambiguously in prompts and docs ("when `NARRATION="ON"`…"). Deferred for now, since the project hasn't used that convention elsewhere yet. If we end up doing a project-wide pass on chat-interaction tag naming, this would land naturally with it.
