# Narration Mode — Design

Status: proposal, for discussion.

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
| 3 | **Control plane** — three coordinated surfaces (user, landmark, agent) for flipping chat-feature flags, with precedence rules and a shared closed set of feature names. | Any chat feature beyond narration: TTS, camera view, doc-pinning, etc. The infrastructure that lets activities go away. |

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

**Ack indications.** On emit: a brief earcon plays and a small icon flashes into view, the user's signal that an action happened. After the flash, the indication settles into a compact form attached to the agent's message — a thin chip with the type icon, optional inner text if present, and `ref` as a tap target. Visually muted; not asking for attention, just there if the user looks for it.

- Icon + earcon are the **primary** expression. Inner text is secondary; when omitted, the chip is essentially just the icon.
- Tap target opens the affected card/file if `ref` is present.
- Multiple chips wrap horizontally on the message. When several acks of the same kind appear consecutively, the renderer may visually group them into a count indication ("📋 3 todos") that taps to expand.

In strip and overlay display states, even the compact persistent form recedes (see Display states below).

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
<chat-app narration="on" tts="off" structured-output="on" time="2026-05-09T14:23:00-05:00"/>

<!-- Agent emits to mutate state (delta — only what to change): -->
<chat-app tts="off"/>

<!-- Landmark seeds initial state (snapshot at session open): -->
<chat-app narration="on" tts="off"/>
```

Same outer tag, same attribute shape, semantics implicit by direction:

- **System → agent**: full snapshot, prepended to each user message. Carries `time` plus all current feature states. The agent always sees the latest world.
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
<chat-app narration="on" tts="off"/>
<link ref="..."/>
</landmark>
```

Landmark settings are seed values applied at session open. The user can still override them after the chat opens.

**Agent control.** The agent emits a `<chat-app>` delta in its response.

```xml
<chat-app narration="on"/>
<chat-app tts="off"/>
```

Use cases: detecting that the user has shifted into narration shape and adjusting; confirming a voice toggle the user requested ("turn on narration mode" → agent confirms with `<chat-app narration="on"/>` plus an `<ack>`); turning off TTS because the user asked for quiet.

### Closed feature-name set

All three surfaces speak a **shared closed set of feature names**. Adding a new chat feature means registering its name; all three surfaces understand it without further plumbing. Initial set: `narration`, `tts`, `structured-output`. Future additions: `camera`, `doc-pinned`, etc.

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

When `narration="on"` (visible to the agent in the `<chat-app>` snapshot on each user message), the chat system prompt gets an overlay along these lines (final wording TBD):

- The user is dumping content, not chatting. Receive it: capture memos, file todos, schedule follow-ups, ask clarifying questions only when essential.
- Don't reply per checkpoint just to acknowledge. Silence is the default response. Confirm work with `<ack>` indications (e.g. `kind="todo-added"`, `kind="appended"`), not prose. Use inner text on the ack only when the action isn't obvious from the user's input.
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

## Note: possible SCREAMING_SNAKE_CASE pass

`SCREAMING_SNAKE_CASE` for state identifiers (feature names, `on`/`off` values, `<ack>` kinds) was considered — it would make these references read unambiguously in prompts and docs ("when `NARRATION="ON"`…"). Deferred for now, since the project hasn't used that convention elsewhere yet. If we end up doing a project-wide pass on chat-interaction tag naming, this would land naturally with it.
