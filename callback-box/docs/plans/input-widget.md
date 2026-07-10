# The input — interface design

**Status:** active — design 2026-07. Revised 2026-07: capture is a
*mode of the input*, not a target — `PlaceTarget` is dropped (see
"Capture mode"). The Emission/editor/persistence/chat-target foundation
has since shipped as `input-extraction`
(`docs/implemented-plans/input-extraction.md`), and the capture-mode
slice has since shipped as `capture-mode`
(`docs/implemented-plans/capture-mode.md`). The remaining open section
of this design is "Interaction stances: conversation vs listening."

Extracts the chat composer and
its satellites into a distinct component with a firm API. Grows out of
the frame-model notes in `docs/plans/interface-as-cards.md` ("The input
is its own frame primitive — and a true singleton"). The factual ground
is the 2026-07 inventory of today's code (~4,200 LOC across 30+ files;
summarized in "What today's code maps to" below).

Three interfaces carry the whole design:

- **Emission** — the noun being composed (text + images + files +
  selections + audio), with one assembly function.
- **Input** — the singleton instrument: owns the current emission, is
  aimed at a target, hosts the feeders.
- **Target** — the acceptor: observable status, `accept() → Receipt`,
  its own control strip (stop lives here, not on the input).

```
                                  THE INPUT (singleton)
            ┌──────────────────────────────────────────────────────┐
 feeders    │                                                      │
 ┌────────┐ │   ┌────────────────────────────────┐                 │
 │keyboard├─┼──▶│                                │                 │
 ├────────┤ │   │      EMISSION (current)        │   submit()      │
 │ voice  ├─┼──▶│  text · images · files ·       ├────────────┐    │
 ├────────┤ │   │  selections · audio            │            │    │
 │ attach ├─┼──▶│                                │  assemble  │    │
 ├────────┤ │   └────────────────────────────────┘            │    │
 │ camera ├─┼──▶        ▲                                     │    │
 ├────────┤ │           │ retain(audio, id)                   │    │
 │ signals├─┼──▶  ┌─────┴─────┐                               │    │
 └────────┘ │     │ RETENTION │                               │    │
    ▲       │     └───────────┘                               │    │
    │       └─────────────────────────────────────────────────┼────┘
    │ selections (frame bus)                                  │
    │                                                         ▼
┌───┴────────────┐    status / speaking / pending   ┌──────────────────┐
│  FRAME (bus,   │◀──────────────────────────────── │  TARGET          │
│  witness, nav) │                                  │  (acceptor)      │
└────────────────┘        accept(payload)──▶Receipt │  status strip:   │
                                                    │  busy·queue·STOP │
                                                    └──────────────────┘
```

The input owns composition and submission. The target owns its own
state — including the **stop** control, rendered on the target's status
strip *beside* the input but across the API line (the terminal precedent:
Ctrl-C aims at the process, not the readline buffer).

## Naming

`Emission` = the thing emitted (a draft until submitted; "draft" was
rejected because drafts connote text only, and this noun carries five
kinds of content). `Input` is used as the singleton's name throughout;
in code it likely lands as `InputCore`/`useInput` to dodge DOM-name
collisions. `Feeder` = anything that writes into the emission.
`Target`/`Receipt` as discussed. All names provisional until
implementation locks them.

## Core content types

Mostly today's per-satellite types, unified under one roof:

```ts
type EmissionId = string; // client-generated (ULID); becomes messageId on
                          // chat sends; the retention key for audio

interface ImageAttachment {          // today: AttachmentItem (ChatAttachments.tsx)
  id: string;
  mimeType: string;
  dataBase64: string;                // REVISED 2026-07: downscale-at-add
                                     // was destructive and is dropped —
                                     // originals stage full-res in the
                                     // in-box staging area; downscaling
                                     // for chat moves into ChatTarget
                                     // assembly (see "Capture mode")
  byteLength: number;
  objectUrl: string;                 // preview; revoked on remove/clear
}

interface FileAttachment {           // today: FileAttachmentItem
  id: string;
  path: string;                      // box-relative tmp/ path (already uploaded)
  originalName: string;
  size: number;
  mimetype: string;
}

interface Selection {                // today: SelectionItem (selection-serialize.ts)
  id: string;
  ref: string;                       // card path the selection came from
  text: string;
  position: SelectionPosition;       // today's shape, unchanged
  anchor: string | null;             // voice placement: preceding words
  spokenWords: number | null;
}

interface RetainedAudio {            // today: CachedMessageAudio (last-audio-cache.ts)
  blob: Blob;
  recordedAt: string;                // ISO
  transcript: string;                // what it became
}
```

## Emission

```ts
interface Emission {
  readonly id: EmissionId;
  readonly text: string;
  readonly images: readonly ImageAttachment[];
  readonly pendingImages: number;    // encoding in flight (placeholder tiles)
  readonly files: readonly FileAttachment[];
  readonly selections: readonly Selection[];
  readonly audio: RetainedAudio | null;   // set when voice contributed
  readonly origin: "typed" | "voice" | "mixed";
  readonly startedAt: string;
}
```

The emission is immutable-from-outside; all writes go through the editor
(below). It is **persisted whole** (not just text) and **survives
re-aiming** — switching chats carries images, files, and selections with
the draft. This is a deliberate behavior change: today only typed text
survives a session switch (localStorage per-session key), and
attachments/selections are lost to the remount. It also departs from the
messaging-app convention of per-conversation drafts, on the boxholder's
stated model: *one* input, aimed and re-aimed.

Lifecycle:

```
                    editor mutations (any feeder)
                   ┌───────────────┐
                   ▼               │
   ┌───────┐    ┌──────────────────┴─┐  submit()   ┌─────────────┐
   │ EMPTY ├───▶│     COMPOSING      ├────────────▶│ SUBMITTING  │
   └───────┘    └────────────────────┘             └──────┬──────┘
       ▲            ▲                                     │
       │            │ rejected / transport error          │ receipt:
       │            │ (emission intact, error shown)      │ delivered│queued│deposited
       │            └─────────────────────────────────────┤
       │                                                  ▼
       │      clear() + retain audio by id         ┌─────────────┐
       └───────────────────────────────────────────┤  ACCEPTED   │
                                                   └─────────────┘
```

A **queued** receipt still clears the input — the queue belongs to the
target and is rendered on the target's strip. The input immediately hosts
a fresh emission; it is an instrument, not a mailbox.

## EmissionEditor — the one mutation surface

```ts
interface EmissionEditor {
  setText(text: string): void;
  insertAtCursor(text: string): void;              // [imageN]/[fileN]/[selectionN] tokens
  addImages(blobs: readonly Blob[]): Promise<void>; // downscale+encode; bumps pendingImages
  addFiles(files: readonly File[]): Promise<void>;  // uploads to tmp/, then appends
  addSelection(input: AddSelectionInput): void;     // typed→token; voice→anchored
  attachAudio(audio: RetainedAudio): void;          // voice feeder, at finalize
  remove(kind: "image" | "file" | "selection", id: string): void; // strips token too
  clear(): void;                                    // post-accept; revokes objectUrls
}
```

Feeders call the editor; UI panels (attachment thumbnails, selection
chips, recovered-dictation widget) are pure renderings of emission
slices. Nothing else holds composition state — this replaces the six
root-owned hooks and the 40+-prop bag.

## The native-embodiment constraint (added 2026-07)

A stated future goal: on a mobile port, **the input is the part that goes
native** (mic, camera, pickers, share sheet, keyboard handling) while the
rest of the app stays HTML in a webview. This makes the input's boundary
a bridge, and imposes one hard rule and one design change:

- **Rule: everything crossing the input boundary is serializable
  message-passing.** No React types, no DOM types in any interface here;
  blobs cross by handle/upload, never by reference. Cheap to keep now,
  brutal to retrofit.
- **Change: `assemble()` belongs to the target adapter, not the input.**
  `Target.accept(emission)` takes the serialized emission; assembly
  (wrappers, selection folding, attachment blocks) is the adapter's first
  act. Rationale: it keeps the bridge surface small (native ships one
  noun, not N payload shapes) and co-locates each payload format with the
  target that defines it (the `<speech>` wrapper is ChatTarget's
  business; the capture-card shape is PlaceTarget's). Cross-language
  duplication was NOT the deciding argument — the boxholder's explicit
  position is that duplication is controllable and observable with
  development process; this change stands on locality and bridge-size.
  (The Assembly section below is retained for the payload shapes, but
  read `accept(payload)` throughout as `accept(emission)` with assembly
  inside the adapter.)

## Assembly — one function, two shapes

```ts
interface AssembleContext {
  targetKind: TargetKind;
  localTime: string;
  // Witness-side context (open card, card activity, zoomed view, time
  // passed) is NOT part of the emission — the ChatTarget adapter merges
  // it at accept() time. The composer never sees it.
}

type AssembledPayload =
  | {
      kind: "chat-message";
      messageId: EmissionId;
      body: string;                       // <typed>/<speech> wrapper, selections
                                          // folded, <attachments> block appended
      images: readonly ChatImageAttachment[];
    };
// The "deposit" variant was dropped with PlaceTarget (2026-07). A
// capture delivers a chat-message whose body points at the prepared
// capture document (see "Capture mode").

function assemble(emission: Emission, ctx: AssembleContext): AssembledPayload;
```

This single function replaces today's **two parallel assembly paths**
(`handleSend` in `InteractiveChat-actions.ts` and `buildSpeechMessage` +
`runKeywordSend` in the voice code), which share only `applySelections`
and can drift on every other payload rule. `origin` decides the
`<typed>`/`<speech>` wrapper; selection folding (`applySelections`) is
called from exactly one place.

## Target — the acceptor

```ts
type TargetKind = "chat" | "unaddressed";
// "place" dropped 2026-07: capture became an input mode delivering a
// chat message, not a target (see "Capture mode")

interface Target {
  readonly kind: TargetKind;
  readonly id: string;              // chat: husk path (session id during transition);
                                    // place: box-relative directory
  readonly label: string;           // for the aim indicator
  readonly status: Observable<TargetStatus>;
  readonly pending: Observable<readonly PendingEmission[]>; // the TARGET's queue
  readonly controls: readonly TargetControl[];              // stop, etc. — strip-rendered
  readonly speaking?: Observable<SpeechState>;              // chat targets only (barge-in)
  accept(payload: AssembledPayload): Promise<Receipt>;
}

type TargetStatus =
  | { state: "ready" }
  | { state: "busy"; disposition: "will-queue" | "will-interrupt" }
  | { state: "unavailable"; reason: string };

type Receipt =
  | { disposition: "delivered"; emissionId: EmissionId; at: string }
  | { disposition: "queued";    emissionId: EmissionId; at: string; behind: "turn" }
  | { disposition: "rejected";  emissionId: EmissionId; reason: string };
// "deposited" dropped with PlaceTarget (2026-07).

interface TargetControl {
  id: "stop" | string;
  label: string;
  enabled: boolean;
  invoke(): Promise<void>;
}

interface PendingEmission {
  emissionId: EmissionId;
  summary: string;          // first line, for the strip
  queuedAt: string;
}
```

Notes:

- **Status is pre-submit truth**: the submit affordance renders it
  ("Send" / "Queue" / disabled-with-reason). HTTP's 200-vs-202 split,
  surfaced at compose time.
- **Stop is a `TargetControl`**, rendered on the target's status strip.
  The input never renders target controls.
- **One adapter at first**: `ChatTarget` (wraps the chat machine's SEND
  + turn state + interrupt; merges witness context into the payload).
  `unaddressed` (triage memo,
  [issues/2026-06-28-triage-agent-session-routing.md](../../../issues/2026-06-28-triage-agent-session-routing.md))
  is a declared kind with no adapter yet.

## Input — the singleton

```ts
interface Input {
  readonly emission: Observable<Emission>;
  readonly editor: EmissionEditor;

  readonly target: Observable<Target>;
  aim(target: Target): void;          // re-aim; emission untouched

  submit(): Promise<Receipt>;         // assemble → target.accept →
                                      // on accept: retain audio, clear
  readonly feeders: {
    keyboard: KeyboardFeeder;
    voice: VoiceFeeder;
    attach: AttachFeeder;             // files + images (paste/drop/picker)
    camera: CameraFeeder;             // capture hardware; feeds images/audio
    signals: SignalFeeder;            // frame bus → selections
  };

  readonly retained: RetentionStore;
}

interface Observable<T> {             // minimal contract; impl may be a store,
  get(): T;                           // an XState actor, or an event emitter
  subscribe(fn: (value: T) => void): () => void;
}
```

There is exactly one `Input` per frame (per tab; conceptually per
person). Its state — emission, aim — is **frame state** per the standing
rule: never a card, never in the URL. Persistence: the emission
serializes whole to local storage under a *singleton* key (not
per-session), restoring across reloads; blobs (images, audio) restore
best-effort.

## Feeders

```ts
interface KeyboardFeeder {
  // Thin: binds textarea(s) to editor.setText/insertAtCursor and
  // paste/drop to attach. The mobile keyboard SHELL (open/locked state,
  // auto-close on send) is embodiment chrome, owned by the embodiment,
  // not by this feeder — it was only ever in "composerMachine" for lack
  // of a home.
}

type VoiceState =
  | { state: "idle" }
  | { state: "connecting" }
  | { state: "recording"; interim: string; committed: string }
  | { state: "reconnecting" }        // with backoff; earcons on drop/resume
  | { state: "finalizing" };

type VoiceIntent = "submit" | "cancel" | "mic-off" | "erase";

interface VoiceFeeder {
  readonly profile: "streaming" | "recorded";
    // streaming: realtime WS transcription (chat today)
    // recorded: record-then-upload (capture today) — same feeder, two
    // pipelines; they stay separate machines under one interface
  readonly state: Observable<VoiceState>;
  start(): void;
  stop(): void;                       // finalize → editor.setText/attachAudio
  cancel(): void;
  readonly intents: Observable<VoiceIntent>;
    // keyword detection ("send it", "cancel", …) emits INTENTS; the
    // Input interprets them (submit → input.submit()). The feeder never
    // sends — it only feeds and signals.
  coordinate(speaking: Observable<SpeechState>): () => void;
    // THE sanctioned boundary crossing: target speech pauses/resumes the
    // mic (barge-in / turn-taking). One documented edge, not a blur.
}

interface AttachFeeder {
  fromPaste(data: DataTransfer): Promise<void>;
  fromDrop(data: DataTransfer): Promise<void>;
  fromPicker(files: readonly File[]): Promise<void>;
  // routes images → editor.addImages, others → editor.addFiles
}

interface CameraFeeder {
  readonly devices: Observable<readonly MediaDeviceInfo[]>;
  readonly preview: Observable<MediaStream | null>;
  capturePhoto(): Promise<void>;      // → editor.addImages
  // device prefs persist (today: localStorage in capture-api.ts)
}

interface SignalFeeder {
  // subscribes to the frame bus; a card-selection signal becomes
  // editor.addSelection with typed-vs-voice placement decided by
  // voice.state (recording → anchor capture, else token at caret)
}
```

## Retention

```ts
interface RetentionStore {
  retain(id: EmissionId, audio: RetainedAudio): void;
  fetch(id: EmissionId): RetainedAudio | null;
  latest(): { id: EmissionId; audio: RetainedAudio } | null;
  // Serves the agent's original-audio loopback (bus event
  // chat-last-audio-request → fulfill). Replaces the single mutable
  // "last audio" slot: retention is keyed by emission id, so "get last
  // audio" = latest(), and a specific message's audio is addressable by
  // the messageId the agent already has. Policy (how many, how long,
  // memory vs IndexedDB) becomes a knob instead of an accident of tab
  // lifetime; v1 policy can be "N most recent, in memory" without
  // changing the interface.
}
```

## Message/event inventory

| From → To | Message | Notes |
|---|---|---|
| frame bus → SignalFeeder | `SelectionSignal {ref, text, position}` | today: `onAddSelection` prop-drilled from FileView |
| VoiceFeeder → Input | `VoiceIntent` | today: `onKeywordSend/…` callbacks |
| VoiceFeeder → editor | transcript commit, `attachAudio` | at finalize |
| Target.status → Input UI | `TargetStatus` | submit affordance text/state |
| Target.speaking → VoiceFeeder | `SpeechState` | the barge-in crossing |
| Input → Target | `accept(AssembledPayload)` | the only forward channel |
| Target → Input | `Receipt` | clear-on-accept; error keeps emission |
| Target.pending → strip UI | `PendingEmission[]` | queued sends visible post-submit |
| server bus → RetentionStore | `chat-last-audio-request {requestId}` | unchanged loopback |
| RetentionStore → server | fulfill (multipart / none) | unchanged |
| ChatTarget ← witness | open-card / card-activity / zoomed-view | merged at accept; composer never sees it |

## Sequence diagrams

**Typed send, target mid-turn (queued):**

```
 user      keyboard    editor/emission      input           ChatTarget        chat machine
  │ type text │            │                  │                 │                 │
  │──────────▶│──setText──▶│                  │                 │  (turn running) │
  │           │            │                  │◀──status:busy───│◀───────────────-│
  │           │            │            [affordance: "Queue"]   │                 │
  │ press ⏎   │            │                  │                 │                 │
  │──────────────────────────────────────────▶│ submit()        │                 │
  │           │            │◀───assemble──────│                 │                 │
  │           │            │                  │──accept(msg)───▶│──queue─────────▶│
  │           │            │                  │◀─receipt:queued─│                 │
  │           │            │◀────clear────────│                 │                 │
  │           │      [input empty again]      │           [strip: "1 queued"]     │
  │           │            │                  │                 │──(turn ends)───▶│ sends
  │           │            │                  │           [strip: clears]         │
```

**Voice send by keyword, with retention and later agent fetch:**

```
 user        VoiceFeeder      editor/emission     input        ChatTarget     agent (later)
  │ speak…      │                  │                │              │              │
  │────────────▶│──interim/commit─▶│ (transcript)   │              │              │
  │ "…send it"  │                  │                │              │              │
  │────────────▶│ detect keyword   │                │              │              │
  │             │──finalize:      ─▶ attachAudio    │              │              │
  │             │──intent:submit──────────────────▶ │              │              │
  │             │                  │◀──assemble─────│  (origin:voice → <speech>)  │
  │             │                  │                │──accept()───▶│              │
  │             │                  │                │◀─delivered───│              │
  │             │   retain(audio, emissionId)  ◀────│              │              │
  │             │                  │◀─────clear─────│              │              │
  │             │                  │                │              │  cb chat get-last-audio
  │             │                  │                │◀────bus: last-audio-request─│
  │             │                  │   retained.latest() → fulfill(blob)─────────▶│
```

**Re-aim mid-composition (the singleton earning its keep):**

```
 user            input             chat A            chat B
  │ 2 photos +    │                  │                 │
  │ half a draft  │  aimed at A      │                 │
  │──────────────▶│                  │                 │
  │ switch chat   │                  │                 │
  │──────────────▶│ aim(B)  [emission untouched]       │
  │ submit        │──accept(msg)──────────────────────▶│
  │               │◀─receipt: delivered────────────────│
```

**Stop, on the target strip (not the input):**

```
 user          input          target strip        ChatTarget
  │              │                │                   │
  │              │◀─status:busy──────────────────────-│
  │              │           [STOP visible]           │
  │ click STOP   │                │                   │
  │──────────────────────────────▶│──controls.stop───▶│ interrupt turn
  │              │◀─status:ready─────────────────────-│
  │        [affordance back to "Send"; input never involved]
```

## What today's code maps to

| Today | Becomes |
|---|---|
| `input-store.ts` + `useComposerDraft` + `useDictationDraft` | `Emission` persistence (whole, singleton-keyed) |
| `useChatAttachments` / `useChatSelections` | `EmissionEditor` + emission slices |
| `handleSend` + `buildSpeechMessage`/`runKeywordSend` assembly | `assemble()` (one path) |
| `realtimeTranscriptionMachine` (+ actor, hook) | `VoiceFeeder` profile `streaming` |
| `voiceRecorderMachine` (capture) | `VoiceFeeder` profile `recorded` |
| `composerMachine.voice` region + turn-taking context | `VoiceFeeder.coordinate(target.speaking)` |
| `composerMachine.keyboard` region | embodiment chrome (mobile shell), out of the API |
| `composerMachine.hq` region | inside `VoiceFeeder` finalize (streaming profile) |
| keyword callbacks (`onKeywordSend`…) | `VoiceFeeder.intents` |
| `last-audio-cache.ts` + loopback routes | `RetentionStore` (loopback unchanged) |
| `chat-uploads.ts` / `file-upload.ts` | `AttachFeeder` → `editor.addFiles` (route unchanged) |
| capture pages/api/routes | capture mode: `CameraFeeder` + staging + preparation (see "Capture mode") |
| SEND event's `openCard`/`cardActivity`/`cardState` | `ChatTarget` adapter merges (witness-side) |
| stop/interrupt in composer bar | `TargetControl` on the target strip |

## Deliberate decisions

- **Singleton draft, not per-conversation drafts** — boxholder's stated
  model ("change chat, the input stays"), departing from messaging-app
  convention. The emission survives re-aiming whole.
- **Queued ≠ held**: a queued receipt clears the input; the queue is the
  target's, rendered on its strip. The input is an instrument, not a
  mailbox.
- **Stop is target-side**, full stop. Submit never means interrupt;
  interruption is only the explicit target control. (Voice barge-in is
  the one sanctioned crossing, via `coordinate()`, and it pauses the
  *mic* — it still never interrupts the turn by itself.)
- **Witness context stays out of the emission.** What the user was
  looking at is frame state the ChatTarget snapshots at accept; the
  composer's API surface stays about composition.
- **Two voice pipelines, one interface.** Streaming and recorded
  profiles are genuinely different machines; unifying their *interface*
  is the win, unifying their internals is not attempted.

## Capture mode (added 2026-07 — supersedes PlaceTarget)

**Implemented** — see
[../implemented-plans/capture-mode.md](../implemented-plans/capture-mode.md)
for the shipped design and its since-verified details. This section is
kept as the original design record.

Boxholder decision: capture is not a *target*, it is a **mode of the
input** — a composition stance entered by a button on the composer.
`TargetKind` `"place"` and the `PlaceTarget` adapter are dropped;
a capture flows to the chat the input is aimed at. A
capture-into-a-chosen-landmark chooser (and an instant-triage variant)
are deferred — the default destination is the most recent chat, as chat
aiming works today.

**The stance.** In capture mode the input is camera/mic only — no
typing. Photos (viewfinder or picker) and voice as a recorded clip;
image-only and voice-only captures are both normal. The posture keeps
today's capture-page virtues: full-screen viewfinder, rapid repeat
shots, done-then-fresh-session loop. `/capture` becomes a deep link
that opens the input in this mode.

**Staging.** Media uploads eagerly as it is produced (every photo,
every audio chunk) into an **in-box staging area** — a temp location in
the box, replacing both R2 and today's `os.tmpdir()` capture sessions.
Crash-safety and mobile resilience carry over from the capture
apparatus. Images stage at full resolution; downscaling for chat
payloads happens in ChatTarget assembly, not at add time.

**Preparation.** On "done": concatenate audio chunks, HQ-transcribe
with word timestamps, and deterministically assemble the **capture
document** — the interleaved transcript with `{% image %}` refs and
`{% silence %}` markers — as a capture card + attach scope. No model
calls in preparation (Gemini Flash describe-images is dropped from the
pipeline; annotation moves to the chat agent, below). Preparation runs
in the background: the input frees immediately on done, further
captures can start while earlier ones prepare, and prepared messages
queue behind a running turn like any send.

**Delivery.** The prepared capture auto-submits to the aimed chat as a
message that *points at* the document (the content is too large to
inline): a wrapper element plus a one-line summary, e.g.
`<capture doc="tmp-capture/…"/>`. The document lands near the chat's
context area (a `tmp-capture/` directory or similar). In the
transcript the capture appears immediately as an uploading/processing
*user message* — the same pattern HQ transcription uses today — with an
error state + retry if preparation fails (the media is already safe in
staging either way).

**Agent duties (schema-carried).** The capture document is a card with
a schema; reading the card injects the rules, so the duties live in
schema `instructions`, not the agent guide. Defaults: **annotate** —
OCR where applicable and image descriptions, via subagents — and commit
the annotation. Then either **file** the card out of `tmp-capture/` to
where it belongs, or, if the capture can be fully processed on the
spot, **complete it and delete the card**. `tmp-capture/` must not
become a landfill.

**What this retires.** The `/capture` page as a separate app; inbox
routing of captures and the `process-captures` procedure (captures no
longer flow through inbox — accepted); the capture-processing `cb`
commands (`transcribe-captures`, `describe-images`,
`assemble-timeline`); the dead `VoiceRecorder.tsx` +
`create-voice-memo` endpoint. The capture **card type survives** with a
revised schema. Open: `cb scan-import`/`cb upload` produce
capture-session cards into inbox and depended on the retired pipeline —
they need a follow-up migration onto the new flow or an explicit stay.

## Interaction stances: conversation vs listening (added 2026-07)

Boxholder addition, motivated by real friction (trying to *learn* from a
long spoken generation while the assistant's hot mic keeps hearing
"interruptions," with no way to rewind a missed sentence): the design
above assumes one stance — **conversation** — and there is a second.

- **Conversation** (everything specified above): mic hot, turn-taking
  active, `voice.coordinate(target.speaking)` does barge-in; speech
  output is ephemeral.
- **Listening**: podcast-like. Long generation; **mic cold** — the
  sanctioned crossing is *suspended*, so ambient sound is never an
  interruption. The target's speech output becomes a **Player**:

```ts
type InteractionMode = "conversation" | "listening";

interface Player {            // the target's long-form speech, seekable
  state: Observable<{ status: "playing" | "paused" | "ended";
                      position: number; duration: number | null }>;
  play(): void; pause(): void;
  seek(to: number): void; nudge(seconds: number): void;
  setRate(rate: number): void;
  transcript: Observable<readonly TranscriptSegment[]>; // synced read-along/scrub
}
```

Mode transitions — **pause is just pause; conversation is always
explicit** (boxholder correction 2026-07): in listening posture a pause
is most likely about the room — an external interruption — not a desire
to talk. Paused stays mic-cold. Entering conversation is a deliberate
act from paused (or a combined "pause-and-talk" control from playing);
it never happens automatically.

```
   LISTENING (playing) ──pause──▶ LISTENING (paused) ──"talk" (explicit)──▶ CONVERSATION
     mic cold · seekable            still mic cold                          mic hot · barge-in
     input parked                     │ resume                              player yields;
          ▲                           │                                     playback marker
          └───────────────────────────┘                        ◀─────────── rides the emission
     (optional combined control: pause-and-talk, one gesture from playing)
```

**The playback marker is selection-shaped.** Entering conversation from
listening drops a marker into the emission through the same
`addSelection` path a card selection uses: `ref` = the retained
utterance, `text` = the last words before the pause, `position` = the
playback timestamp. The question you then ask automatically carries
"asked at 12:34, after '…'," which is what the agent needs to answer a
"wait, what did you mean there?" without re-explanation.

This also completes a symmetry the design half-built: the emission's
audio gets identity + retention — listening mode wants the same for
**received** speech (utterance retained with transcript), so rewind is a
fetch, not a regret, and playback markers have something real to point
at. Implementation-wise the Player hangs off the target (it is the
target's output surface, like the status strip), and `InteractionMode`
is frame state.

## Open questions

- **Blob persistence** for emission images / retained audio across
  reloads (IndexedDB?) — v1 can accept best-effort loss, matching today.
- **Multi-tab**: the singleton is per-tab today (retention answers
  "none" tentatively across tabs). Conceptually one input per person;
  practically per-tab instances. Leave as-is until it hurts.
- **The `unaddressed` target** (triage memo) — declared in the type,
  designed elsewhere
  ([issues/2026-06-28-triage-agent-session-routing.md](../../../issues/2026-06-28-triage-agent-session-routing.md)).
- **Where the aim indicator lives** in the UI (the input shows *what*
  it's aimed at; the target strip shows the target's state) — an
  embodiment question, not an API one.

## Implementation staging (when picked up)

1. `Emission` + `assemble()` — pure refactor, doctest-able, kills the
   dual assembly path; no UI change.
2. `EmissionEditor` + emission-slice panels — dissolves the prop bag.
3. `Target` interface: `ChatTarget` adapter, status/receipts, stop moves
   to the strip.
4. Singleton persistence (the behavior change) + re-aim.
5. Capture mode: staging area, `CameraFeeder`, recorded voice profile,
   preparation + pointer message; retires the capture page and
   pipeline. (Steps 1–4 largely shipped as `input-extraction`; this
   step is the `unify-capture-input` worktree's work.)
