# Capture mode — unifying capture into the input

Implements the "Capture mode" section of
[input-widget.md](input-widget.md): capture stops being a separate app
that deposits into inbox and becomes a mode of the chat composer. Media
stages eagerly into the box, a background preparation step assembles a
capture document (audio concat, HQ transcription, deterministic
timeline), and the result auto-submits to the current chat as a message
pointing at the document. The chat agent — not a background procedure —
annotates and files (or completes and deletes) the capture. The
`/capture` page, the `process-captures` pipeline, its `cb` commands,
and the dead voice-memo path retire.

**Status:** planned 2026-07 (this worktree: `unify-capture-input`).
Parent design: [input-widget.md](input-widget.md). Related parked doc:
[../unimplemented-plans/capture-pipeline-redesign.md](../unimplemented-plans/capture-pipeline-redesign.md)
(this plan supersedes its motivation for UI captures — the pipeline it
wanted to fix is retired instead).

## Stated preferences this plan trades against

- `docs/engineering-principles.md` — findings trace mostly to: **#3**
  (validate at boundaries — upload endpoints, wrapper parsing), **#4**
  (resilient AND never silent — the crash/partial track exists because
  of this), **#5** (failure paths visible where callers branch —
  receipts, preparation outcomes), **#8** (one way to do each thing —
  this plan deletes the second and third voice paths and the second
  upload story), **#10** (testability is architectural — preparation is
  a pure-ish pipeline over a staged session precisely so it doctests),
  **#12** (the maintainer is usually an agent — schema instructions and
  knowledge audits are first-class deliverables).
- `callback-box/CLAUDE.md` — Phase-2 card conventions; "HTTP endpoints
  go in tRPC by default … Raw Fastify routes … only for things that
  don't fit the tRPC request/response shape: file upload/download"
  (Behavioral Notes); time discipline (`getBoxTime`,
  `startAwakeTimeout`); `withCardLock` for same-file RMW.
- `callback-box/code-style.md` — no `any`, named-params objects, custom
  error classes, `Promise.allSettled` default, logging levels.
- Precedents (denser than docs): the `input-extraction` refactor
  (`docs/implemented-plans/input-extraction.md`) for how composer work
  lands; `<self-note>` (`src/webapp/routes/chat-send-routes.ts:300-339`)
  for server-injected messages; the `{% quote %}` knowledge-audit set
  for agent-facing-concept rollout.

## What already exists

Reused (cited) vs rebuilt, per sub-problem:

- **Chunked recording** — `ChunkedRecorder`
  (`src/frontend/src/lib/audio/recorder.ts`), used by the capture page
  via `useCaptureUploads.ts:92` (`handleChunk` uploads each chunk as
  `audio-{NNN}.webm`). **Reuse**, extended with a segment id per
  recording start (see Track 2).
- **Eager upload with retry** — `uploadCaptureFile`
  (`src/frontend/src/pages/capture/capture-api.ts:82-137`): multipart +
  `X-Capture-*` headers, `AbortSignal.timeout(30_000)`, exponential
  backoff, 4xx non-retryable. **Reuse the client shape**; the endpoints
  move to the staging store and gain `withMobileAuth()` (which
  `capture-api.ts` fetches lack today, unlike
  `src/frontend/src/lib/file-upload.ts:26`).
- **Session store** — `src/webapp/routes/capture-session-store.ts`
  (session.json + in-process `withSessionLock`, `:57-68`). **Rebuild**
  relocated into the box (today it lives in `os.tmpdir()`,
  `capture-session-store.ts:28`, which is invisible to the box and dies
  with the machine — the crash-resilience track needs it durable and
  inspectable). The lock idiom carries over.
- **Finalize → cards** — `capture-finalize.ts`: `SessionBuilder`
  (`:29-72`), `writeAudioCard` chunk-concat (`:81-114` — "only the
  first MediaRecorder chunk has the WebM/EBML header"),
  `writeImageCards`/`writeFileCards` (`:116-195`), single-commit
  `commitSession` (`:198-213`). **Reuse the card-writing core**,
  re-hosted in the preparation worker; the inbox destination and the
  `createProcessCapturesTrigger` (`:308-332`) are dropped.
- **Transcription** — `transcribeAudio` with
  `options: { wordTimestamps: true }` returning
  `DetailedTranscriptionResult { words: {word,start,end}[] }`
  (`src/core/transcription/index.ts:66-106,207-220`); `.timing.json`
  sidecar shape `{words, duration, language}` written by
  `transcribe-captures.ts:144-154`. **Reuse as-is** (the CLI command
  retires; the service call moves into preparation).
- **Timeline assembly** — `assembleSession` is deterministic (no model
  calls; algorithm in `src/core/commands/assemble-timeline.ts:7-15`)
  and already takes `inboxDir` as a parameter
  (`src/core/commands/assemble-timeline-helpers.ts:246-299`) — the only
  inbox coupling is the caller passing
  `getBoxDir(ctx.boxRoot, "inbox")` (`assemble-timeline.ts:26`).
  **Reuse the helpers with one required change** (Codex review finding):
  `assembleSession` refuses to assemble until every image card is
  `analyzed` or `invalid` (`allImagesAnalyzed`,
  `assemble-timeline-helpers.ts:109-116`, gate at `:274-283`), and new
  image cards default to `status: new` — since this plan drops the
  describe-images pass, the relocated helper drops that gate (images
  interleave by `filename.captured` regardless of analysis status).
  The CLI command retires.
- **Server-injected chat message** — `POST /api/chat/self-note`
  (`chat-send-routes.ts:300-339`): resolve target
  (`requestedSession ?? getMostActive`), busy-check,
  `enqueue`/`send`. The Telegram pool's `handleScheduleFire`
  (`src/core/chat/session/pool.ts:266-291`) is the fully
  requestless precedent. **Precedent, not reuse** (Codex review
  finding): self-note 404s with no live/most-active session, emits no
  `chat-user-message` event, and fire-and-forgets `send()` failures
  after replying OK — capture delivery is a new core function
  (Track 3) that shares the enqueue/send semantics but creates a
  session when needed, emits the events the pending UI consumes, and
  records delivery failure retryably. And not `<self-note>`
  *semantics* either — those are documented as "not user input … no
  one is waiting on a reply"
  (`src/core/chat/session/prompts.ts:88`); a capture is the opposite.
- **Pending user message UI** — `SessionEntry.pending`
  (`src/frontend/src/api-chat.ts:70-77`), optimistic entries
  (`src/frontend/src/machines/chat-actions.ts:26-49`), history
  reconcile (`src/frontend/src/machines/chat-shared.ts:61-100`),
  opacity-60 + caption rendering (`user-message.tsx:307-354`).
  **Extend** with a capture-preparing variant (Track 4). The other
  pending mechanism — `PendingHqMessage`
  (`InteractiveChat-message-items.tsx:46-71`), resolved by a
  synchronous pre-send fetch (`InteractiveChat-voice.ts:124-147`) —
  is the visual precedent but the wrong lifecycle (it never survives a
  send).
- **Completion notification** — event bus `EventMap`
  (`src/core/event-bus.ts:44-76`, e.g. `card-created`,
  `chat-user-message`) over `events.subscribe`
  (`src/frontend/src/hooks/useBusSubscription.ts:46`). **Reuse.**
- **Chat placement** — `getDirectoryForSession`
  (`src/core/chat/session/history.ts:177-185`), `getMostActive`
  (`:293-305`, the pointer bare `/chat` resolves to),
  `nearestLandmarkDir` (`src/core/landmark/nearest.ts:56-67`).
  **Reuse** to resolve where `tmp-capture/` lives.
- **Schema instructions delivery** — schemas with `instructions` get
  `docs/generated/card-<type>.md` (`src/core/docs-gen/index.ts:412-444`)
  and the agent guide says "read it before working with a card of that
  type" (`src/core/agent-guide/cards.ts:156`). **Reuse**; the
  capture-session schema's `instructions`
  (`src/schemas/capture-session.tsx:53-67`) are rewritten.
- **Awake-time discipline** — `startAwakeTimeout`
  (`src/lib/awake-timeout.ts`) for the abandonment sweep, per
  CLAUDE.md's time-discipline note.

## Prior art (external)

- **MediaRecorder timeslice chunks are not self-contained** — only the
  first chunk carries the WebM/EBML header; later chunks fail
  standalone decode ("EBML header parsing failed"). Confirms the
  existing concat approach and this plan's per-segment concat rule.
  <https://github.com/chrisguttandin/extendable-media-recorder/issues/638>
- **Eager chunked upload with server-side tracking is the established
  resilience pattern** (client retries only missing pieces; server
  reassembles) — e.g. Resumable.js / the TUS protocol.
  <https://www.resumablejs.com/>. We deliberately do **not** adopt TUS:
  single server, same-origin, chunk sizes are seconds of audio — the
  existing bespoke multipart-with-retry client
  (`capture-api.ts:82-137`) already covers the need. Adopting a
  protocol library would violate right-sized defensiveness (#6) for
  this scale.
- No external prior art searched for "chat message pointing at a
  document too large to inline" — this is an internal vocabulary
  question (the `<attachments>` block, `chat-assemble.ts:84-88`, is the
  in-house precedent).

## Tracks / scope

Ordered by implementation dependency, then surface size.

### Track 1 — In-box staging store

**What.** Replace the `os.tmpdir()` capture session store with a
staging area inside the box: `tmp/capture-staging/<session-id>/`
holding raw uploads plus `session.json`. Upload/create/cancel endpoints
move onto it; `withMobileAuth()`-compatible auth is required from the
start (today's capture endpoints are cookie-only, a gap the iOS
share-sheet issue already flags).

**Why.** Crash resilience requires the media to be durable and
discoverable: `os.tmpdir()` sessions die silently with the machine and
are invisible to box tooling. In-box staging also collapses the
two-upload-stories split (chat `tmp/` vs capture tmpdir) toward one
mechanism (#8).

**Direction.** Staging lives under the box's gitignored `tmp/` (the
housekeeping sweep skips directories — `housekeeping.ts:53`
`if (!stat.isFile()) continue;` — so staged sessions are exempt from
the 7-day flat-file sweep; Track 5 adds the deliberate staging sweep).
`session.json` gains: `segments` (recording segments, each an ordered
chunk list — see Track 2), `photos`, `files`, `targetSessionId`
(the chat session the capture was started from, captured at session
create), `lastActivityAt`. Same in-process lock idiom as today
(`capture-session-store.ts:57-68` — sessions never span processes).

**Vocabulary lock-ins.** `tmp/capture-staging/` (path), "staging
session" (the pre-preparation unit), "segment" (one recording start).

**First chunk.** The store module + create/upload/cancel routes over
it, with route doctests (`makeTestServer()`); the capture page keeps
working against the new store (front-end untouched beyond the API base
path). No open questions inside.

### Track 2 — Multi-segment audio

**What.** Each recording start mints a new segment; chunks are named
`audio-<segment>-<NNN>.webm`; preparation concatenates *within* a
segment only, yielding one clip card per segment.

**Why.** A resumed or re-entered recording session creates a fresh
MediaRecorder whose stream has its own header — concatenating two
headered streams is invalid (external prior art above; today's code
assumes one MediaRecorder per page visit,
`capture-finalize.ts:81-114`). Segments make crash-resume (Track 5)
representable, and the schema already supports it: `audio-clips` is an
array (`capture-session.tsx:34-46`), and `assembleSession` interleaves
any number of clips by absolute time
(`assemble-timeline-helpers.ts:126-149`).

**Direction.** `ChunkedRecorder` callers pass a segment id (ULID at
`start()`); `session.json.segments[i] = { id, startedAt, chunks }`.
Preparation writes `audio-001`, `audio-002`, … cards with
`filename.recorded` = segment `startedAt` (same field
`assemble-timeline-helpers.ts:130` reads today).

**First chunk.** Segment-aware upload naming + store shape + concat
unit doctest (fixture: two segments, three chunks each → two buffers,
correct headers preserved).

### Track 3 — Preparation worker + delivery

**What.** A server-side `prepareCaptureSession(sessionId)` step: concat
segments → write the capture card + child audio/image/file cards into
`tmp-capture/` under the chat's area → HQ-transcribe each clip with
word timestamps → write `.timing.json` sidecars → run the (relocated,
image-gate-removed) `assembleSession` helpers to build the timeline
body → **validate the written cards** (today's `finalizeSession`
writes and commits with no validation boundary,
`capture-finalize.ts:266-289`; a validation failure here is
`failed:assemble`, loud) → commit → inject the chat message → emit
completion events.

**Why.** This is the boxholder's stated model: "prepare a full capture
document, then submit that to chat as a message pointing to the
document." Preparation is deterministic (no model calls — Gemini
describe-images is dropped; annotation moves to the chat agent, Track
6), which keeps it doctestable end-to-end with the fake transcription
service (#10).

**Direction.**
- **Placement:** `tmp-capture/` inside the chat's context directory —
  `getDirectoryForSession(boxRoot, targetSessionId)`
  (`history.ts:177-185`); empty string/`null` → box root. The capture
  card and attach scope are *tracked and committed* (the agent must
  `cb mv` them; per-card commit message
  `"Capture: <basename>"`, trailer `Created-By: capture`, matching
  `commitSession`'s current trailer, `capture-finalize.ts:198-213`).
- **Delivery:** a new core function `deliverCaptureMessage()` —
  modeled on the self-note route's resolve target → busy? `enqueue` :
  `send` shape (`chat-send-routes.ts:300-339`) but: creates a session
  via `registry.createNew()` when no target resolves (self-note 404s
  there), emits `chat-user-message`/completion events for the pending
  UI, awaits the non-busy `send()` and records failure as
  `failed:deliver` on the staging session (retryable) instead of
  fire-and-forget. The message is a first-class user message with a
  new wrapper:

  ```
  <capture doc="tmp-capture/capture-20260709T1432-ab3f.capture-session.card"
           images="3" audio="4:10" partial?="1">
  one-line summary (first transcript sentence or "3 photos")
  </capture>
  ```

  Target resolution: the staging session's `targetSessionId` if that
  session still exists, else `getMostActive(boxRoot)`
  (`history.ts:293-305`), else `registry.createNew()`
  (`registry.ts:225-247`).
- **Trigger:** finalize ("done" in the UI) starts preparation
  immediately in-process (fire-and-forget from the route, like
  self-note's non-busy branch); the HTTP response returns as soon as
  the staging session is sealed. Preparation state is persisted on
  `session.json` (`preparing`, `delivered`, `failed:<step>`) so a
  server restart can resume it idempotently (each step checks for its
  own output before redoing work).
- **Transcription failure:** retry (the service already does
  `retry: 2, timeout: 120_000`, `transcription/index.ts:305-307`);
  on persistent failure, deliver anyway with
  `transcription-failed="1"` on the wrapper and the audio cards left
  `status: new` — the agent is told (schema instructions) it can run
  the HQ pass later. Never hold the media hostage to a provider outage
  (#4: resilient and never silent).

**Vocabulary lock-ins.** `<capture …>` wrapper (chat message
vocabulary, documented in `CHAT_SYSTEM_PROMPT` alongside and in
contrast to `<self-note>`, `prompts.ts:48,88`); `tmp-capture/`
(directory name); wrapper attributes `doc`, `partial`,
`transcription-failed`.

**First chunk.** `prepareCaptureSession` as a core function with a
filesystem doctest (`makeTmpBox()` + fake transcription service):
staged fixture in → capture card, clips, timeline body, commit out.
Message injection is chunk 2 of the track (route-level doctest
asserting the enqueue/send call and wrapper shape).

### Track 4 — Capture mode UI + pending message

**What.** The composer gains a capture button that switches the input
into capture mode: full-screen viewfinder/mic (today's
`components/capture/` components, dark theme and all), photo/gallery/
file/record controls, no text entry. "Done" seals the session and
returns the composer to normal; a pending user message appears in the
transcript immediately and resolves when delivery lands.

**Why.** This is the design's core move (input-widget.md, "Capture
mode"): one input surface, capture as a stance. The `/capture` page is
nearly unreachable today — no AppNav link; the one live link is the
box-selection tiles (`src/frontend/src/components/BoxSelectionTiles.tsx:40-52`),
which Track 4 re-points at the chat-with-capture-mode deep link.

**Direction.**
- Mode state lives beside the emission store (frame state, not URL);
  `embedded` shells suppress it like they suppress the mic today
  (`InteractiveChat.tsx` `embedded` prop).
- Reuse `useCaptureCamera`/`useCaptureDevices`/`useCaptureInputs`
  hooks and the `components/capture/` presentation nearly as-is; they
  re-point at the Track 1 endpoints. `/capture` becomes a redirect
  that opens chat with capture mode active (deep link preserved for
  home-screen shortcuts).
- **Pending message:** a third pending variant with the
  `SessionEntry.pending` visual language (opacity-60 bubble +
  caption — `user-message.tsx:337-354`) but **server-derived, not
  client-only** (Codex review finding: today's pending entries are
  in-memory only, `chat-actions.ts:26-49` — a reload would silently
  drop the bubble while preparation runs). The staging store exposes a
  query (tRPC) listing sessions in `preparing`/`failed:*` state for a
  chat; the pending bubble renders from that query + live bus events,
  so it survives reload/another tab/server restart. Resolution:
  the delivered user message shows up in history (reuse the
  `reconcilePending` matching idea, `chat-shared.ts:61-100`, matching
  on the wrapper's `doc=` path rather than text). Failure state renders
  a retry affordance that re-POSTs finalize (idempotent).
- Send-while-busy needs no new work: delivery enqueues exactly like
  self-note's busy branch; the pending bubble's caption becomes
  "queued" (status via the same events).

**First chunk.** Mode toggle + viewfinder embedding behind a dev flag,
against the Track 1 store; pending-message variant with a
storybook-style dev harness (the repo precedent:
`pages/dev/components/ComposerStatesHarness.tsx`).

### Track 5 — Resume, partial, and the abandonment sweep

**What.** Crash/disconnect resilience. Client: on entering capture
mode (or app load), an open staging session prompts
resume / submit-now / discard. Server: staging sessions with no
activity for the abandonment window auto-finalize as **partial**
captures (`partial="1"` wrapper attribute + `partial: true`
frontmatter) via the same preparation path.

**Why.** Eager upload means the media survives; without this track it
survives *invisibly* — the current design loses orphaned tmpdir
sessions silently (#4's exact target). The boxholder explicitly asked
for continue-or-submit-partial.

**Direction.** Be honest about the loss window (Codex review finding):
the sweep can only deliver what reached the server — chunks held in
the browser's failed-upload maps (`useCaptureUploads.ts:67-69`) and
the tail since the last `dataavailable` are client-side only. Two
mitigations land with this track: capture mode shortens the recorder
timeslice from today's 20s (`src/frontend/src/lib/audio/recorder.ts:71`)
to ~5s, and every stop path (done, cancel-into-resume, mode exit)
awaits the final `dataavailable` before releasing the recorder
(today's non-Done paths call plain `stop()` without awaiting it,
`useCaptureSession.ts:74-78,155-158`). A partial capture's wrapper
states the bound ("recording may be missing its final seconds").
Resume = reopen the staging session; a new recording is
a new segment (Track 2 makes this sound). The sweep runs on the server
alongside other webapp periodic work using `startAwakeTimeout`
(`src/lib/awake-timeout.ts` — a plain timer would fire instantly after
macOS sleep and mass-finalize sessions that were "abandoned" only by
the laptop lid). Window: 60 minutes of no uploads and no finalize;
sessions created but empty (`files.length === 0`-equivalent) are
discarded, matching today's empty-finalize short-circuit
(`capture-finalize.ts:239-242`).

**First chunk.** Store-level `listOpenSessions` + sweep function with
filesystem doctest (frozen `CB_TIME`); the client resume prompt rides
in Track 4's second chunk.

### Track 6 — Schema, agent duties, and prompt surface

**What.** Rewrite the capture-session schema's `instructions`
(`capture-session.tsx:53-67`) for the new life-cycle; document
`<capture>` in the chat system prompt; add knowledge audits.

**Why.** The maintainer of a capture is now the chat agent (#12). The
old instructions describe the retired status ladder
(`new → transcribing → … → extracted`).

**Direction.**
- Schema: keep `session-id`, `time`, `images`/`audio-clips`/`files`,
  `body`; replace the `status` enum with the new states
  (`delivered → annotated`, plus `partial` and `transcription-failed`
  booleans); instructions cover — (1) what a capture is and that the
  body timeline is generated, not hand-edited; (2) **annotate by
  default**: OCR where applicable and image descriptions, done via
  subagents, committed; (3) then **file it** out of `tmp-capture/`
  with `cb mv`, or if the capture can be fully processed now,
  **complete it and delete the card**; (4) `tmp-capture/` must not
  accumulate.
- Chat prompt (`prompts.ts`): one paragraph in the message-wrappers
  section (`:48`) defining `<capture>` — real user input, reply
  expected (explicitly contrasted with `<self-note>`, `:88`); read the
  `doc` card (whose generated `card-capture-session.md` carries the
  duties) before responding substantively.
- scan-import keeps producing capture-session cards into inbox with
  the same schema (it never calls the retired commands —
  `scan-import.ts` has no references; its sessions are photo/PDF-only,
  `audioRefs: []` at `scan-import.ts:257`) — the instructions must
  therefore not assume chat delivery; write them for "wherever this
  card is found."

**First chunk.** Schema + instructions + prompt paragraph + generated
doc, in one commit with the knowledge-audit entries (run, not just
written).

### Track 7 — Retirement and deployed-box migration

**What.** Delete: the `/capture` page mount (`router.tsx:112-116`) and
old tmpdir store/finalize inbox path; the `process-captures` procedure
template + `cb transcribe-captures`, `cb describe-images`,
`cb assemble-timeline` CLI commands (helpers that Track 3 reuses move
to `src/core/capture/`); `createProcessCapturesTrigger`
(`capture-finalize.ts:308-332`); `VoiceRecorder.tsx` +
`POST /api/actions/create-voice-memo`
(`src/webapp/routes/actions.ts:180-264`) — the component is rendered
nowhere (only its icon exports are imported,
`InteractiveChat-voice-button.tsx:7`).

**Why.** #8 (one way to do each thing): three voice paths become one
recorded profile + one streaming profile; two capture pipelines become
one.

**Direction — the deployed-box problem.** `installProcedures` never
prunes (`src/core/box/defaults.ts:47-75` only adds/updates), so
deleting the template leaves `config/procedures/
process-captures.procedure.card` and any pending
`config/schedules/process-captures.scheduled-script.card` trigger on
every initialized box, now referencing deleted `cb` commands (a
wakeup-time failure). Migration (per `docs/migrations.md` runbook
style): an explicit migration that removes both files when the
procedure card's content hash matches an **enumerated list of shipped
versions** carried in the migration itself — not the
`template-versions.json` ledger, which (Codex review finding, matching
known prod state) is sparse on real boxes and doesn't cover this
pruning case; `installTemplateFile` can overwrite or park, never
prune (`install-template-file.ts:303-390`). Enumerate the field hashes
the same way template rollouts do (`priorStockHashes` style). A
boxholder-modified copy parks instead of deleting. In-flight inbox
capture-session cards (including the prod retry-loop victim,
`issues/2026-07-07-capture-pipeline-retries-broken-capture-forever.md`)
are *not* auto-migrated: they stay in inbox as ordinary cards for the
normal triage/agent flow; the migration note tells the agent they're
legacy. `MicrophoneIcon`/`StopIcon` move to a shared icons module
before `VoiceRecorder.tsx` deletes.

**First chunk.** The migration + template deletion (it must land
*after* Tracks 1–4 exist; see Implementation order).

## Subplans

None. The one candidate — a landmark/destination chooser for
capture-into and the instant-triage variant — is deferred outright
(NOT in scope), not sub-planned; the boxholder deferred it explicitly.

## Failure modes

**Critical gap (accepted, documented):** if the box's git remote and
disk both die between upload and the agent filing the capture, media
is lost — same exposure every box write has; no capture-specific
handling.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Chunk/photo upload fails after retries mid-capture | Track 1 route doctest (5xx fixture) | Failed-payload registry + banner retry (pattern from `useCaptureUploads.ts:67-69`) | Clear (banner) |
| Browser crashes mid-capture | Track 5 sweep doctest | Abandonment sweep → partial capture delivered with `partial="1"` | Clear (marked partial in chat) |
| Crash *mid-recording* truncates the active segment | Concat doctest with truncated tail chunk | Header chunk uploads first; decodable prefix *of uploaded chunks* — tail since last `dataavailable` is lost (bounded by the ~5s timeslice, Track 5); per-clip transcribe errors don't abort the session (pattern: `transcribe-captures.ts:160-176`) | Clear (partial wrapper states the bound) |
| Reload/second tab while preparation runs | Track 4 doctest (query returns preparing session) | Pending bubble is server-derived (staging-state query), not in-memory | Clear (bubble survives) |
| Transcription provider down at preparation | Track 3 doctest (fake service failure) | Deliver with `transcription-failed="1"`, clips left `status: new`, agent instructed it can rerun | Clear |
| Server restarts during preparation | Track 3 idempotency doctest | `session.json` preparation state; resume on startup; steps check own outputs | Clear (resumes) |
| Target chat session no longer exists at delivery | Route doctest | Fall back `targetSessionId → getMostActive → createNew` | Clear (message still lands) |
| WS drop between completion event and client | Covered by existing history-refresh reconcile | Pending bubble reconciles against server history by `doc=` path (à la `chat-shared.ts:61-100`) | Clear (self-heals) |
| Delivery enqueued while agent busy, then session dies before drain | GAP — relies on existing queue semantics (`chat-send-routes.ts:244-254`) | Existing queue behavior; capture card already committed regardless | Silent-ish: message may be lost but the *card* exists on disk |
| `tmp-capture/` accumulates unfiled captures | Knowledge audit (agent duty) + Track 5 stale-check log line | Agent duty in schema instructions; sweep logs (not deletes) stale entries | Clear (logged) |
| Two captures finish preparation simultaneously | Track 3 doctest (two sessions) | Independent sessions; commits serialized by git; both enqueue | Clear |
| Migration hits a boxholder-modified procedure card | Migration doctest | Parked to `config/_template-updates/` (existing `install-template-file.ts:374-389` behavior), not deleted | Clear (parked) |

The one flagged row (queued delivery lost if the live session dies
before drain) is accepted: the capture document is committed before
delivery, so the loss is a missing notification, not missing data, and
the stale-`tmp-capture/` log line surfaces it eventually.

## Agent-flow / user-flow edge cases

- **Wrong tag** (`<capture>` vs `<self-note>` confusion) —
  **ADDRESSED**: prompt paragraph explicitly contrasts them (Track 6);
  knowledge audit checks it.
- **Stale ref** (agent files the doc; user later clicks the old
  `doc=` path in the transcript) — **GAP → ADDRESSED in Track 6**: the
  agent's filing duty includes replying with the new location;
  additionally `cb mv` rewrites refs in cards but not chat history —
  accepted, the reply is the pointer.
- **Two agents touching the capture** — **ADDRESSED**: the
  process-captures reactor path is retired, so only the chat agent
  works captures; `withCardLock` covers RMW if a procedure ever also
  touches one.
- **Hand-edit drift** — **ADDRESSED**: capture cards validate like any
  card (`cb validate`, per-box pre-commit hook); the generated body is
  documented as "don't hand-edit" in instructions (as today,
  `capture-session.tsx:66-67`).
- **Fabricated free-form value** — **ADDRESSED**: annotation duty says
  OCR/describe *from the image cards via subagents*, not from the
  transcript; audit `watch_for` checks the agent names reading the
  image before describing.
- **Validation error UX** — **ADDRESSED**: preparation writes cards via
  the same template/validation path as today's finalize; a validation
  failure fails preparation loudly (`failed:<step>`), surfacing in the
  pending bubble.
- **Partial migration / transition state** — **ADDRESSED** (Track 7):
  old inbox capture-sessions stay as legacy cards for normal triage;
  deployed procedure cards are hash-matched-deleted or parked; the
  retired `cb` commands are deleted only in the same release as the
  migration.

## NOT in scope

- **Destination chooser / capture-into-a-landmark + instant-triage
  shortcut** — boxholder deferred; default is the current chat.
- **PWA `share_target` / iOS share-sheet entry**
  (`issues/2026-05-11-ios-share-sheet-capture.md`) — separate follow-up;
  Track 1's mobile-auth fix removes its main blocker, which is
  contribution enough for now.
- **Migrating `cb scan-import`/`cb upload` off the capture-session
  inbox flow** — they keep working unchanged (verified: no references
  to the retired commands); their sessions simply no longer get a
  procedure pass. Follow-up issue to file at implementation time.
- **Chat-image staging unification** (moving paste/drop images off
  base64-in-payload onto the staging store) — the design doc marks the
  direction (downscale at assembly), but converting chat's existing
  image path is its own change; capture mode doesn't need it.
- **Listening mode / Player** — separate section of input-widget.md.
- **Deleting the `voice-memo` schema/template** — only the dead
  endpoint and component go; the card type may have box-local users.
- **Native embodiment** — the serializability rule is honored
  (`<capture>` and staging cross by paths/ids), but no bridge work.

## Open design questions

- **Does the wrapper carry a transcript excerpt beyond the one-line
  summary?** Lean: no — the agent reads the doc; the message stays a
  pointer (boxholder: "content is too large for a message (maybe)").
  Revisit if agents prove reluctant to open the doc.
- **Sweep window (60 min) and whether the sweep also auto-delivers
  sessions whose *browser* finalized but whose preparation failed
  twice.** Lean: yes, same path; window tunable in one constant.
- **Where capture-mode entry lives on mobile-width layouts** (the "+"
  menu vs a dedicated button) — embodiment detail; decide in Track 4's
  dev-harness review with the boxholder.

## Knowledge audits

New agent-facing concepts → entries in
`src/dev/knowledge-audits.yaml`, modeled on the `{% quote %}` set
(`knowledge-audits.yaml:2294-2329`), run before the plan completes:

- `capture-message-meaning` (`knows_directly`): agent sees
  `<capture doc="…">` — knows it's real user input expecting a reply,
  and that the document must be read.
- `capture-agent-duties` (`knows_directly`): annotate (OCR +
  image descriptions via subagents, committed) → file out of
  `tmp-capture/` or complete-and-delete.
- `capture-partial-marker` (`knows_directly`): `partial="1"` means the
  capture cut off unexpectedly; treat the tail as possibly mid-thought.
- Skip-with-rationale: staging internals, sweep, endpoints — purely
  infrastructural; no agent recalls them.

## Implementation order

1. **Track 1** staging store + routes (capture page re-pointed,
   still functional throughout).
2. **Track 2** segments (store shape + recorder + concat).
3. **Track 3** preparation worker; then delivery + `<capture>`
   wrapper.
4. **Track 6** schema/instructions/prompt/audits (needs the wrapper
   shape from 3; must land before any real capture is delivered).
5. **Track 4** capture mode UI + pending message (needs 1–3; the
   `/capture` page keeps covering capture until this lands).
6. **Track 5** resume + partial + sweep (needs 3's preparation and
   4's UI hooks for the resume prompt).
7. **Track 7** retirement + migration (last — nothing may retire
   until the replacement path is exercised end-to-end).

Each numbered item is one or a few commits; the plan ships as one unit
(worktree → main) when all land.

## Rollout shape

### Test apparatus

The backbone already exists and is reused, not rebuilt:

- **Real capture fixture + record/replay** —
  `test/fixtures/capture-session/` (one webm, three jpgs, cards) and
  `createFixtureReplay` (`test/helpers/fixture-replay.ts`), already
  driving `test/capture-pipeline.test.ts` through transcribe →
  describe → assemble with saved real API responses (re-recordable via
  `CB_REGENERATE_FIXTURES=1`). The `prepareCaptureSession` doctest
  replaces that test's manual step sequence: fixture session staged →
  prepare → assert the capture card, timeline body, commit, and
  message payload. The old test retires with the pipeline it covers.
- **Scripted transcription** — a `fake` service in the
  `loadTranscriptionConfig` dispatch (`transcription/index.ts:207-220`)
  returning caller-scripted `words[]`, following the existing
  services fake pattern (`createFakeOpenAIAudio({transcriptionText})`,
  `src/services/CLAUDE.md`). Scripted word timestamps + fixture image
  `filename.captured` values make **speech-interleaved-with-images
  timelines fully composable in tests**: place words and photos at
  chosen absolute times, assert the exact assembled body
  (exact-string doctests, the input-extraction precedent).
- **Doctests per track** (design tools, written with the code):
  store/route doctests incl. auth + traversal + idempotent finalize
  (Track 1); segment concat incl. truncated-tail chunk (Track 2);
  prepare end-to-end + idempotent-resume-after-kill, delivery
  busy/enqueue/createNew-fallback/failure-recorded (Track 3); sweep
  under frozen `CB_TIME`, empty-session discard (Track 5); migration
  hash-match-delete / modified-park (Track 7).

### Interactive testing

- **Capture harness dev page** (`pages/dev/`, precedent:
  `ComposerStatesHarness.tsx`): the capture-mode UI wired to stub
  feeders — a fake camera that serves the fixture jpgs (or canvas
  frames), a fake recorder that emits pre-built fixture webm chunks on
  an accelerated timer, and the scripted transcription service on the
  dev box. Drives the full flow in a browser with no mic, camera, or
  API keys: pending-message progression, queued-behind-turn, failure +
  retry, resume prompt, partial marker. This is where the boxholder
  reviews the embodiment questions (mode button placement, viewfinder
  takeover) against something clickable.
- **Browser automation** — `bin/browse` against the harness page for
  scripted walkthroughs; for the *real* `getUserMedia` path, Chromium's
  `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`
  flags provide a synthetic camera/mic with no permission prompt —
  wire into agent-browser launch flags if supported (check at
  implementation time; the harness stubs are the fallback).
- **Manual end-to-end** on the worktree box (real mic + camera,
  including a phone via the dev router URL): photo + two-segment voice
  capture → message in chat → agent annotates and files it. Run via
  the verify skill before finishing; this is the done-when gate.
- **Knowledge audits:** the three entries above land with Track 6 and
  are executed (`pnpm knowledge-audit run --filter capture`) with
  status comments recorded.
- **Migration:** scripted, hash-guarded deletion of the deployed
  procedure card + trigger (parked if modified); legacy inbox
  capture-sessions left for normal triage. Runs via the standard
  migration runbook (`docs/migrations.md`) as part of the same
  release; gradual states don't exist — a box either has the old
  pipeline (commands still present) or the new one.
- **Docs:** input-widget.md already updated; `/finish` moves this plan
  to `docs/implemented-plans/` when it ships; the parked
  capture-pipeline-redesign doc gets a superseded-by note.
