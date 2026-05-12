# Narration Mode — Design

Status: proposal, for discussion.

## Motivation

Today's chat assumes turn-taking. Voice goes through realtime transcription, every utterance becomes a user message, every user message gets an agent reply. That's the right default for a conversational assistant — and the wrong shape when the user wants to *narrate*: speak for a long stretch, dump content the agent should sort and file, only sometimes ask a question that needs a real answer.

Narration mode is a chat feature where:

- The user speaks freely, often at length, without expecting a reply per utterance.
- The agent's primary job is to receive — listen, capture, sort, schedule — not to converse.
- Embedded questions ("what's on my calendar tomorrow?") get real answers; the rest of the dump does not.
- Transcript quality outweighs transcript latency, because the content is the durable artifact.

## Three features plus a behavior overlay

Narration mode is three features and a system-prompt overlay. The features each ship as one piece — the sub-parts inside each only make sense together — but the three features compose freely with each other and with other chat features. Features (2) and (3) are general-purpose; narration is one consumer.

| # | Feature | Standalone use |
|---|---|---|
| 1 | **Voice intake redesign** — voice no longer reaches the agent in realtime. A checkpoint keyword commits a segment; the segment is transcribed at high quality (Whisper/Voxtral non-streaming) and sent as a single user message. The realtime transcript drives keyword spotting and UI feedback only. | Any chat where voice input wants accuracy over latency, and the user prefers to commit segments deliberately rather than per-utterance. |
| 2 | **Structured response output** — two new tags (`<ack>`, `<callout>`) sit alongside `<speech>` and shape the visible portion of the agent's reply. Backed by a new display pane that gives them dedicated rendering. | Any chat where the agent does real work and the response wants more structure than a wall of prose. |
| 3 | **Control plane** — three coordinated surfaces (user, landmark, agent) for flipping chat-feature flags, with precedence rules and a shared closed set of feature names. | Any chat feature beyond narration: TTS, camera view, doc-pinning, etc. The infrastructure that lets activities go away. |

The "narration" UI toggle uses the control plane to enable voice intake redesign and adds a **system-prompt overlay** that tells the agent how to behave: receive content, mostly stay silent, prefer structured output, surface real answers via `<callout>`. Each feature can also be enabled independently — the overlay is the part that's narration-specific.

## Naming convention

State identifiers — feature names (`NARRATION`, `TTS`, `STRUCTURED_OUTPUT`), state values (`ON`, `OFF`), and `<ack>` kinds (`FILE_UPDATED`, `TODO_ADDED`, etc.) — are written in `SCREAMING_SNAKE_CASE` everywhere they appear: as XML attribute names, attribute values, and references in system prompts and docs. The visual shouty-ness signals "this is a named state, not a colloquial word."

Tag names (`chat-app`, `callout`, `ack`, `speech`) and free-form/verb attribute names (`time`, `ref`, `context`, `kind`, `enable`) stay lowercase/kebab — matches existing project convention. The visual rhythm — uppercase identifiers next to lowercase metadata attributes — makes it easy to scan which attributes are state-flags vs free-form data.

## (1) Voice intake redesign

The microphone stays open. Two transcription tracks run on the same audio stream, used for different purposes:

| Track | Service | Latency | Used for |
|---|---|---|---|
| Realtime | Voxtral Realtime / Deepgram (existing) | ~100ms | Keyword spotting, live UI text, segmentation |
| HQ | Whisper / Voxtral non-streaming | seconds | Agent-visible user message, persistent record |

The realtime transcript is **not** sent to the agent. Its only jobs are:

- Live keyword spotting (existing `speech-keywords.ts`).
- UI feedback — showing the user what's been recognized so far.
- Defining segment boundaries for `cancel` / `erase`.

A **checkpoint** keyword (likely reuses the existing `send`, or adds narration-specific phrases like "checkpoint" / "save that") triggers:

1. Capture the audio recorded since the last checkpoint.
2. Submit it to the HQ transcription service.
3. On result, send to the agent as a single user message.
4. Clear the realtime UI buffer; mic stays open for the next segment.

Existing keywords still work: `mic off` ends the loop; `cancel` / `erase` discard the current buffer.

**Storage.** The HQ transcript is canonical text. The audio file may persist as an attachment (mirroring the existing memo+attachment pattern). The realtime track is throwaway.

**Reuse.** The HQ transcription service is generally useful — capture pipeline, manual upload — but those uses are out of scope here. Designing it as a typed service in `src/services/` (real + fake) keeps future reuse cheap.

**Open questions**

- Multiple checkpoints in flight: does checkpoint immediately reset the local buffer so the user can keep talking while HQ is processing the previous chunk? (Probably yes — that's the natural narration cadence.)
- HQ failure: fall back to the realtime transcript, or show an error and let the user retry from the audio?
- Audio transport: browser-side buffer flushed at checkpoint, or streamed to the backend continuously and assembled there?
- HQ provider: Whisper API, self-hosted whisper.cpp, Voxtral non-realtime? (Not blocking — the interface is the same.)
- Pending-state UI: while HQ is in flight, show the realtime transcript as a ghosted placeholder user message and swap on completion? Or just a spinner?

## (2) Structured response output

Two new tags shape the visible portion of the agent's reply, backed by a new display pane that gives them dedicated rendering. They sit alongside `<speech>` (auditory) and existing structural tags.

Three tiers of agent output, sorted by how much of the user's attention each asks for:

| Tier | Tag | When to use |
|---|---|---|
| Background | (untagged prose) | Thinking-aloud, sorting decisions, processing notes. Hidden by default in narration; visible in regular chat. |
| Compact | `<ack kind="…" ref="…">` | "I did the thing you asked" — confirmations of discrete work. |
| Durable | `<callout context="…">` | Content the user must read, written to stand alone in any future view. |

The two tags are complementary, not alternatives. A turn might emit several `<ack>` chips and one `<callout>`, with surrounding untagged prose that gets hidden in narrow views.

### `<ack>` — compact acknowledgements

The agent emits an `<ack>` chip to confirm a discrete action, instead of describing it in prose.

```xml
<ack kind="FILE_UPDATED" ref="recipes/Bread.recipe.card">Added cardamom note</ack>
<ack kind="TODO_ADDED" ref="todos/Call_Mom.todo.card"/>
<ack kind="SCHEDULED" ref="schedules/Saturday_Reminder.schedule.card">Saturday morning</ack>
<ack kind="NOTED">Got it</ack>          <!-- no ref; bare acknowledgement -->
```

**Schema:**

- **`kind`** (required): closed set of state identifiers. Each kind has a default icon and default verb-phrase used when the inner text is empty.
- **`ref`** (optional): path to the affected card or file. Renders as a tap link.
- **Inner text** (optional): a short modifier — what changed, when, where. Falls back to the kind's default phrase when empty.

Initial closed set (subject to design):

| `kind` | Default phrase | Typical ref |
|---|---|---|
| `FILE_UPDATED` | "Updated" | a card or file path |
| `FILE_CREATED` | "Created" | new card path |
| `TODO_ADDED` | "Added to todos" | the todo card |
| `SCHEDULED` | "Scheduled" | the schedule card |
| `CAPTURED` | "Captured" | the captured artifact |
| `NOTED` | "Noted" | none — generic ack |

New card types reuse `CAPTURED`, `NOTED`, or the file-CRUD kinds. The closed set keeps icon mapping reliable. Earcons come later — design once kinds are stable.

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

- **`context`** (required): a short string that contextualizes the callout when shown detached. When the callout answers a question, `context` carries the question (or a faithful paraphrase). For proactive observations, it's a topic line. The `context` value is the agent's commitment that this callout will still make sense later, alongside this label.
- **Body**: the durable content. Must stand alone — no "as you said" / "that thing" / "the one we discussed."
- No `kind` for now. May add one later if visual differentiation between answers / alerts / questions pays off; defaulting to one undifferentiated tag.
- A response may contain zero, one, or many callouts. Most narration responses will have zero.

`context` is an attribute (not a nested element) because it's a short label, not body content. Keeping it terse keeps the agent honest about whether a single callout is the right granularity — if the context can't be summed up shortly, that's a sign there should be two callouts.

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

Both tags depend on a new chat display surface with distinct visual treatments. Pixel-precise specs come at implementation time; this section pins the visual model.

**Ack chips.** A row of small inline pills, typically at the end of the agent's message but rendered wherever they appear in the response stream. Each chip:

- Type icon (~16-20px) at the left, a short label to its right (the inner text, falling back to the kind's default phrase when empty).
- The whole chip is a tap target if `ref` is present, navigating to the affected card or file.
- Muted/secondary surface color — designed to be low attention budget. Acks should read as "the thing happened" without competing with surrounding content.
- Multiple chips wrap horizontally, with normal inline-flow gap.

When several acks of the same kind appear consecutively, the renderer may visually group them into a count chip (e.g. "📋 3 todos added") that taps to expand the individual chips with refs. This avoids visual repetition when the agent files a flurry of similar work.

**Callouts.** Block-level cards with elevated visual treatment, separated from surrounding prose:

- The `context` attribute renders as a small label/eyebrow above the body — slightly muted, sentence-case.
- Body uses normal text size, typeset against a subtle background tint or with a left accent stripe for visual lift.
- Vertical space above and below to separate from surrounding text.
- Multiple callouts in one response stack vertically — each is its own card.

The visual lift is enough to mark a callout as the standalone unit it is, but not so loud it competes with itself when stacked. Color and primitive choices follow the box's semantic palette (see `FRONTEND.md`); the accent role is appropriate.

**Display states.** The chat surface has three progressive states. Each shares the same render rule — structured output (callouts, acks) stays visible while untagged prose progressively hides — but in increasingly aggressive form. State is driven by what's competing for screen space, not by an explicit feature flag.

| State | Trigger | What's visible |
|---|---|---|
| **Full** | chat is the main thing | Whole conversation: prose, callouts, acks, all rendered normally. |
| **Strip** | chat shares screen with another view (camera, document preview, side-by-side mode, phone in narration) | Chat compresses to a strip. Callouts at full size in the strip; prose hides behind a "more" affordance; ack chips collapse to a summary indicator ("3 actions") that taps to expand. |
| **Overlay** | user is focused on a document or other primary content; chat is hidden | Chat history not visible at all. New callouts appear as transient overlays on the focused content. Acks flash briefly with earcons and dismiss. Live transcript-in-progress (when voice is active) shows as an overlay while the user is speaking. The chat is summoned back via gesture or button. |

The three states are a progression of how much room the chat is willing to take. Narration mode doesn't fix any one state — narration on a phone with camera open is **strip**; narration while focused on a document is **overlay**; narration on a desktop with a wide chat is **full**. Same render rule, different aggression.

In **overlay** state, callouts may persist briefly then fade, or persist until dismissed — the right behavior depends on whether the user wanted to read the answer (persist) or just be told (flash and dismiss). Probably an attribute on the callout, or a heuristic on body length, decides; defer this until building.

Speech via `<speech>` plays in any state, independent of the visual collapse. TTS is the only signal the user gets in overlay state if no callout is emitted.

**History and external surfacing.**

- History scroll (full state): same as default view. Very old messages may aggressively collapse acks; callouts always remain visible.
- Digests / notifications / link previews: callout `context` + body together when space allows; `context` alone when heavily compressed. Acks don't surface externally — they're low-attention by design and not standalone-meaningful.

### Open questions

- Bare `<ack/>` with no `kind`: error, or fall back to `noted`? (Probably error.)
- Is the `kind` set box-extensible? (Probably yes — boxes can register additional kinds with icon, renderer falls back for unknowns.)
- Composition of `<callout>` with `<speech>`: siblings, not nested (proposed). Cost: repeat content when both are wanted. Benefit: one tag, one job; decoupled rendering and audio paths.
- Multiple callouts per turn: allowed; in narrow views, stack or page through? Probably stack.

## (3) Control plane

A unified mechanism for flipping chat-feature flags, with three surfaces and predictable precedence. Built once, all chat features ride on it. This is the infrastructure that makes activities being phased out work — any chat can mix features, and any feature can be flipped from any of the three surfaces.

### Symmetric envelope: `<chat-app>`

One envelope tag — `<chat-app>` — carries chat-app state in both directions. Children are flat attributes:

```xml
<!-- Server-injected on each user message (full snapshot): -->
<chat-app NARRATION="ON" TTS="OFF" STRUCTURED_OUTPUT="ON" time="2026-05-09T14:23:00-05:00"/>

<!-- Agent emits to mutate state (delta — only what to change): -->
<chat-app TTS="OFF"/>

<!-- Landmark seeds initial state (snapshot at session open): -->
<chat-app NARRATION="ON" TTS="OFF"/>
```

Same outer tag, same attribute shape, semantics implicit by direction:

- **System → agent**: full snapshot, prepended to each user message. Carries `time` (lowercase, free-form) plus all current feature states (UPPERCASE state identifiers). The agent always sees the latest world.
- **Agent → system**: delta. Only the attributes present count; absent attributes mean "no opinion."
- **Landmark → system**: snapshot at session open. User can override afterward.

Some children are read-only by convention (`time`, future read-only state like `view`, `pinned`); the agent doesn't try to write them. Vocabulary discipline, not a hard schema rule.

`time` lives here because it's stale the moment the system prompt is fixed — moving it to the per-turn `<chat-app>` block keeps it fresh.

### Three surfaces

**User control.** UI toggle in the chat (settings dropdown, command palette), voice keyword ("narration on"), or slash command (`/narration on`, `/tts off`). The most common path; the user is in charge by default.

**Landmark control.** A chat landmark card declares feature defaults for chats opened from it. Recurring narration sessions don't need a manual toggle each time.

```xml
<landmark>
<label>Daily dump</label>
<symbol>🎙️</symbol>
<chat-app NARRATION="ON" TTS="OFF"/>
<link ref="..."/>
</landmark>
```

Landmark settings are seed values applied at session open. The user can still override them after the chat opens.

**Agent control.** The agent emits a `<chat-app>` delta in its response.

```xml
<chat-app NARRATION="ON"/>
<chat-app TTS="OFF"/>
```

Use cases: detecting that the user has shifted into narration shape and adjusting; confirming a voice toggle the user requested ("turn on narration mode" → agent confirms with `<chat-app NARRATION="ON"/>` plus an `<ack>`); turning off TTS because the user asked for quiet.

### Closed feature-name set

All three surfaces speak a **shared closed set of feature names**. Adding a new chat feature means registering its name; all three surfaces understand it without further plumbing. Initial set: `NARRATION`, `TTS`, `STRUCTURED_OUTPUT`. Future additions: `CAMERA`, `DOC_PINNED`, etc.

Values are `ON` / `OFF` — also UPPERCASE state identifiers.

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

- Single-turn flips: should the agent be able to flip a feature for just one response (e.g. "callout-only view for this answer")? Probably yes, via a duration attribute or a separate scoping tag — defer.
- Per-thread persistence vs session-only: does flipping narration in a thread carry over when the user returns? Probably yes for landmark-defaulted threads, no otherwise — but worth deciding explicitly.
- How visible is "agent just flipped a feature" — inline notice, toast, status-bar change, or all three?
- Does landmark control distinguish "default" (user can override) from "required" (locked)? Probably "default" only, to start.
- Do we ever need to send a mid-response state change to the agent (e.g., user toggled mid-stream)? Probably not — the next turn's snapshot covers it. Flag if real cases emerge.

## Composition examples

- Narration alone (full state): agent listens, no TTS by default, mostly emits `<ack>` chips with occasional `<callout>` when there's something to surface.
- Narration + camera view on phone (strip state): `<callout>` blocks hoist into the visible strip; surrounding prose hides; `<ack>` chips reduce to a single summary indicator.
- Narration while reading a document (overlay state): chat is fully hidden; new callouts appear as overlays on the document; acks flash briefly with earcons; transcript-in-progress shows live while the user speaks.
- Narration + TTS on: agent speaks `<callout>` content via a sibling `<speech>` block when the answer is worth hearing aloud. Useful while driving.
- Structured output without narration: any chat can use `<ack>` and `<callout>`; the display pane renders them whether or not voice intake is in narration mode.
- Landmark-driven narration: a "Daily dump" landmark opens its chat with narration on, TTS off; the user starts talking immediately.

## System-prompt overlay

When `NARRATION="ON"` (visible to the agent in the `<chat-app>` snapshot on each user message), the chat system prompt gets an overlay along these lines (final wording TBD):

- The user is dumping content, not chatting. Receive it: capture memos, file todos, schedule follow-ups, ask clarifying questions only when essential.
- Don't reply per checkpoint just to acknowledge. Silence is the default response. Confirm work with `<ack>` chips (e.g. `kind="TODO_ADDED"`, `kind="FILE_UPDATED"`), not prose.
- When the user asks a real question, put the answer in a `<callout>` with the question (or paraphrase) as the `context` attribute. Write the body to stand alone — assume the user might re-encounter this callout in a digest with no surrounding context.
- Use `<speech>` only when the answer is worth speaking aloud. `<callout>` and `<speech>` are siblings; emit both when you want the same content shown and spoken.
- Tool-driven action (capture, schedule, file) is the primary work; conversation is incidental.

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
- Single-turn `<chat-app>` flips — needed, or always sticky?

Implementation-level (not design-blocking):

- HQ transcription service interface and provider choice.
- Audio buffering and transport for checkpoint capture.
- How `<ack>`, `<callout>`, and `<chat-app>` parsing slot into the existing tag-parser pipeline.
- New display pane scope: standalone component, or extension of the existing chat message renderer?
- Earcons for `<ack kind>` — designed once kinds are stable.
- Feature-flag persistence layer: server-side session storage, per-thread persistence, per-box defaults file?
- Feature-name registry: where the closed set is declared and how a feature registers itself.
