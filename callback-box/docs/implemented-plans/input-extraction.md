# Input extraction — isolating the composer behind the Emission/Input/Target API

Implementation plan for extracting the chat composer and its satellites into
a distinct input component with the firm, serializable API designed in
`docs/plans/input-widget.md`. Scope: the chat target only — Emission +
adapter assembly, the emission editor consolidating today's scattered hooks,
a ChatTarget formalizing send/status/receipts with the stop control
relocated out of the composer, singleton persistence (the emission survives
session switches), voice intents, and emission-keyed audio retention.

## Stated preferences this plan trades against

- `callback-box/CLAUDE.md:100`: *"Read before writing. Don't guess file
  formats, XML structures, or API shapes."* — every seam below is cited to
  current line numbers (re-verified 2026-07-04, post boxes-as-packages-v2).
- `callback-box/CODE-STYLE.md`: no `any`; max 2 positional params; custom
  errors; `as` banned in `.tsx`; files ≤300 lines, functions ≤150.
- `callback-box/CLAUDE.md` (frontend bullets): UI primitives + semantic
  palette; `restrict-component-classes`.
- `docs/plans/input-widget.md` (the design this implements), especially:
  the serializable-boundary rule ("no React types, no DOM types in any
  interface here; blobs cross by handle"), assembly-in-the-adapter (stands
  on locality and bridge-size — explicitly NOT on drift-fear, per the
  boxholder's recorded position), "queued clears the input," "stop is
  target-side," and the singleton-draft decision.
- Boxholder positions recorded in that doc/discussion: duplication is
  controllable by process (don't argue from drift); pause/stop semantics
  never conflate with composition; behavior changes must be named, not
  smuggled (the per-session→singleton draft change is the big one here).
- `docs/testing.md` via the cb-plan template: tests first as a design tool;
  cover substantial codepaths, not coverage percentages.

## What already exists

Verified 2026-07-04 (two subagent surveys; line numbers current):

**The two assembly paths + two dispatchers (the thing chunk 1 kills):**
- Typed: `InteractiveChat-actions.ts:80-115` builds
  `<typed local-time…${zoomedViewAttr()}${timePassedAttr()}>` +
  `<attachments>` block (`:87-105`), then dispatches via
  `doSendWithImages` (`:65-78`) which mints `newMessageId()`
  (`InteractiveChat-helpers.ts:54-56`) and captures witness fields
  (`cardSend.capture()`, `InteractiveChat-card-hooks.ts:110-125`).
- Voice: `runKeywordSend`'s submit closure
  (`InteractiveChat-voice.ts:112-125`) + `buildSpeechMessage`
  (`InteractiveChat-helpers.ts:25-35`), dispatching via the *root*
  `doSend` (`InteractiveChat.tsx:123-132`). Shared piece: only
  `applySelections` (`lib/selection-serialize.ts:159`).
- Today-wart the plan fixes structurally: only the root `doSend` clears
  `lastMessageAudio` (`InteractiveChat.tsx:127`); the typed funnel never
  does.

**Composer state, scattered (chunk 2's material):** `input-store.ts` (83
LOC external store; reactive only via `useInputValue`, `:80-83`);
`useChatAttachments` (`InteractiveChat-attachments.ts:51`, images +
pending count + files, `[imageN]`/`[fileN]` tokens via caret-aware
`insertTokensAtCursor` `:20-49`); `useChatSelections`
(`InteractiveChat-selections.ts:16`, typed→token / voice→anchor decision
at `:33-36`, upstream anchor capture at `InteractiveChat-view.tsx:243-252`);
draft persistence per-session (`lib/composer-draft.ts:30-34` key
`cb-composer-draft:<box>:<session>`; dictation twin
`lib/dictation-draft.ts:30-34`). The prop bag: `ChatBodyProps` is **43
props** (`InteractiveChat-view.tsx:31-77`), ~26 composer-related.

**Send/turn semantics (chunk 3 formalizes, does not change):**
- Send-while-busy **queues**: route guard `chat-send-routes.ts:246-254`
  (`{queued:true}`); session queue combines into one turn
  (`chat-session.ts:78, 279-298`), drains on `result` (`:271`); `stop()`
  clears the queue (`:414`).
- Frontend never blocks sends mid-turn: `chatMachine.ts:224-234` queues
  with an optimistic `pending: true` bubble (`chat-actions.ts:41-49`);
  the `STREAM_QUEUED` race is handled (`chatMachine.ts:255-263`).
- Status raw material: machine `idle ⇄ streaming → refreshing`
  (`chatMachine.ts:125-355`), `isStreaming` derived at
  `InteractiveChat.tsx:86`; backend `chat.status` returns
  `{running, busy}` (`chat-control-procedures.ts:26-43`).
- Interrupt is explicit end-to-end and **send never implicitly
  interrupts**: stop button renders in the composer bar when streaming
  (`InteractiveChat-composer.tsx:248-259`) → `INTERRUPT`
  (`chatMachine.ts:278-287`) → `chat.interrupt` tRPC
  (`chat-control-procedures.ts:88-94`) → `ChatSession.interrupt()`
  (`chat-session.ts:347-356`).
- Receipt raw material: POST resolves `{turnId}` / `{queued:true}` /
  `{deduplicated:true}` (`chat-send-routes.ts:216-224, 246-254, 294`);
  `messageId` is the frontend-minted dedup key with disk-persisted TTL map
  (`chat-send-routes.ts:141-181`).

**Remount that loses composition (chunk 4's material):**
`ChatPage.tsx:106` keys `<InteractiveChat key={keyState.epoch}>`; a
session switch remounts everything, recreating the input store
(`InteractiveChat.tsx:95`) — attachments/files/selections are lost; only
typed text survives via the per-session draft restore
(`useComposerDraft.ts:50-62`).

**Voice + retention (chunk 5's material):** keyword callbacks
(`InteractiveChat-voice.ts:214-254`); the single-slot audio cache
(`lib/last-audio-cache.ts:31-37`), fulfilled from the WS event
(`InteractiveChat-ws.ts:63-67`); backend loopback with first-audio-wins +
none-grace multi-tab rendezvous (`src/core/last-audio-pending.ts:59-99`,
routes `chat-last-audio-routes.ts:59-125`); `cb chat get-last-audio`
(`src/cli/commands/chat-audio.ts:143-167`).

**Test infra (reused):** `test/frontend/*.doctest.md` imports frontend
modules by relative path (e.g. `composer-machine.doctest.md:13`,
`speech-message.doctest.md:11`); pure libs and XState machines are
headlessly doctestable; hooks/components and DOM helpers
(`insertTokensAtCursor`, `extractSelection`) are not.

Everything above is **reused as the substrate** — the plan adds a boundary
and a noun; it does not rebuild send, queueing, dedup, transcription, or
the loopback.

## Prior art (external)

No new third-party dependency is in play — the mechanisms used (external
store + `useSyncExternalStore`, XState actors, JSON message shapes) are
already in-repo, so no library-limitation search applies. Two named
patterns the design consciously follows, for the record: **ports and
adapters** (the Target interface is a port; ChatTarget an adapter), and
the **React Native WebView bridge** convention (JSON message-passing,
binary by handle) as the model behind the serializable-boundary rule —
that rule is design-level here; no bridge is built by this plan.

## Tracks / scope

Single track, five chunks (commit boundaries, not ship boundaries; the
plan ships whole).

**Vocabulary lock-ins** (names that will appear across the codebase):
`Emission`, `EmissionId` (adopts today's `messageId` minting and dedup
role — no parallel id), `EmissionEditor`, `Target`, `TargetStatus`
(`ready | busy | unavailable`), `Receipt` (`sent | queued | rejected`),
`VoiceIntent` (`submit | cancel | mic-off | erase`), `RetentionStore`.
New frontend directory: `src/frontend/src/input/` — the boundary made
visible in the tree (types, editor/store, targets/, retention; components
stay under `components/` per the class-rules convention and import from
`input/`).

### Chunk 1 — Emission + one adapter assembly (pure refactor)

**What.** `input/emission.ts`: the `Emission` type (id, text, images,
pendingImages, files, selections, audio-ref, origin) with a serialized
form (no blobs — images carry dataBase64 already; audio by retention
key). `input/targets/chat-assemble.ts`: ONE
`assembleChatMessage(emission, witness)` producing
`{message, messageId, images}` — `origin: "typed"` → the `<typed>`
wrapper + `<attachments>` block; `"voice"` → `<speech diarized?>`;
selection folding via the existing `applySelections`. `witness` is a
serializable value (`{localTime, zoomedView?, timePassed?}` strings), not
functions. **All five send sites** refactor to build an `Emission` and
call the one assembler (codex review finding — the original draft named
only two): typed `handleSend` (`InteractiveChat-actions.ts:80-115`),
keyword voice (`InteractiveChat-voice.ts:112-125`), the desktop
stop-and-send button (`InteractiveChat-composer.tsx:99-106`, hand-built
`<speech>`, no selection folding), the mobile stop-and-send
(`InteractiveChat-mobile-row.tsx:88-96`, same), and recovered dictation
(`InteractiveChat.tsx:169-176`, `selections: []`). The two SEND
dispatchers collapse to one. **Zero behavior change** — the doctest pins
exact output strings for EACH site (wrapper attrs, attachments block,
selection tokens, diarized attr, and the stop-send buttons' current
no-selection-folding behavior, reproduced via explicit empty selections)
before the refactor lands. Aligning the stop-send paths to fold
selections is a NAMED follow-up decision deferred to chunk 5, not
smuggled into the refactor. **Decided in chunk 5: aligned** — every other
send path folds selections, so the stop-send paths' no-fold behavior was
an accident of hand-built payloads, not a design; consistency wins and
they now fold the live selections snapshot too (`InteractiveChat-dispatch.ts`'s
`sendStopSend`).

**Why.** The two assembly paths + two dispatchers are the core of
"implied and spread out"; every payload rule exists twice.

**First implementation chunk, no open questions inside it.** Doctest:
`test/frontend/emission-assemble.doctest.md`.

### Chunk 2 — EmissionEditor: one mutation surface, one store

**What.** `input/emission-store.ts`: an external store (input-store
pattern, generalized) holding the whole emission; `EmissionEditor`
methods (`setText`, `insertAtCursor`, `addImages`, `addFiles`,
`addSelection`, `attachAudio`, `remove`, `clear`) as the only writers.
`useChatAttachments`/`useChatSelections`/input-store collapse into thin
bindings over it; `AttachmentPanel`/`SelectionPanel`/composer textarea
become renderings of emission slices. DOM-bound pieces
(`insertTokensAtCursor` caret handling) stay in the keyboard binding, not
the store. Token/id bookkeeping (insert/strip on remove) moves into the
store where it's headlessly testable.

**Why.** Six root-owned hooks and ~26 composer props exist because there
is no one place composition state lives.

Doctest: `test/frontend/emission-editor.doctest.md` (token bookkeeping,
add/remove/clear, pendingImages accounting; no DOM).

### Chunk 3 — ChatTarget: status, receipts, stop relocation

**What.** `input/targets/chat-target.ts` wrapping today's machinery:
- `status` maps machine + backend state: `idle`→`ready`,
  `streaming|refreshing`→`busy` (disposition `will-queue` — the honest
  value; chat never interrupts on send), no live session→`unavailable`.
- `accept(serializedEmission)`: assembles (chunk 1's function + witness
  snapshot from `cardSend.capture()` — witness context moves INTO the
  adapter, off the composer), dispatches SEND, and returns
  **`Promise<Receipt>` settled from the actual outcome** (codex review
  finding: a pre-submit status snapshot cannot truthfully decide — an
  idle-path POST can still resolve `{queued:true}`, `{deduplicated:true}`,
  or fail: `chat-actors.ts:294-307`, backend busy branch
  `chat-send-routes.ts:246-254`). Receipt mapping: `{turnId}`→`sent`,
  `{queued}`→`queued`, `{deduplicated}`→`sent` (idempotent success),
  transport/machine failure→`rejected`. UX stays today's: the input
  clears optimistically at dispatch, but the submitted emission is HELD
  until settlement and **restored into the editor on `rejected`** —
  strictly better than today, where a failed send loses the text to the
  error banner. The optimistic-pending bubble machinery
  (`chat-actions.ts:41-49, 98-111`) is untouched.
- Stop relocation: the stop-agent and stop-TTS buttons
  (`InteractiveChat-composer.tsx:236-259`) move to a new `TargetStrip`
  component rendered by the chat view adjacent to the composer — the
  target's UI, across the boundary. Submit affordance text derives from
  `status` ("Send"/"Queue"). The composer bar no longer receives
  `onInterrupt`/`onStopSpeech`. Seam caution (codex finding): stop-TTS is
  NOT a pure button move — `STOP_SPEECH` in `pausedForSpeech` must also
  `resumeMic` (`composerMachine.ts:194-199`, wired via `handleStopSpeech`,
  `InteractiveChat-voice.ts:313-317`). The strip's stop-TTS control
  therefore invokes the existing voice-coordination handler (the design's
  sanctioned crossing); only the rendering moves.

**Why.** Status/queueing/interrupt semantics already exist and are
correct; they're just unlabeled and physically conflated with the input.

Doctests: status mapping + receipt disposition
(`test/frontend/chat-target.doctest.md`, driving the machine headlessly).

### Chunk 4 — the singleton: emission survives session switches

**What.** The input instance (store + editor + retention) lifts above the
`key={keyState.epoch}` remount — created in `ChatPage` (frame-level
later, out of scope) and passed into `InteractiveChat`. Persistence
changes from per-session text-only to **whole-emission, singleton-keyed**
(`cb-input-emission:<box>`): text, files, selections persist; image
`dataBase64` and audio blobs are best-effort (dropped on reload if over a
size threshold — quota failure mode below). The per-session draft keys
retire: on first singleton load, adopt the **most-recently-updated**
existing `cb-composer-draft:<box>:*` draft, then remove that box's old
keys (decision: other sessions' stale drafts are discarded, not merged —
merging N drafts is wrong and keeping them contradicts the one-input
model; named as a behavior change, see Failure modes). The dictation
draft (`cb-chat-draft:*`) gets the same treatment.

Two hardening requirements (codex findings): **restore-time validation
of file attachments** — persisted `files` are `tmp/…` paths that
housekeeping sweeps after 7 days (`src/core/housekeeping.ts:23`), so a
restored emission validates each path (cheap existence check) and drops
dead ones with a visible "attachment expired" note, never restoring
silently-broken references; and **all localStorage access goes through a
guarded try/catch helper** — the current draft hooks call `setItem`
unguarded (`useComposerDraft.ts:80,105`) while the repo already has the
safe best-effort pattern at `lib/location-share.ts:102-113`; the new
persistence adopts that pattern for reads, writes, migration, and key
cleanup.

**Why.** "The input stays when you switch chats" is the design's core
promise and is currently false for everything but typed text.

Doctest: serialization round-trip + migration adoption logic
(`test/frontend/lib/emission-persist.doctest.md`).

### Chunk 5 — voice intents + emission-keyed retention

**What.** The keyword callbacks (`onKeywordSend/Cancel/MicOff/Erase`)
re-shape into one `VoiceIntent` stream (`input/voice-intent.ts`,
`kind: submit | cancel | mic-off | erase`) that `useRealtimeTranscription`
emits through a single `onVoiceIntent` handler instead of four separate
callbacks; `InteractiveChat-voice.ts` switches on `kind` and maps each
intent to its action (submit → `runKeywordSend`, unchanged otherwise;
cancel/mic-off/erase → their existing bodies, moved as-is). **Freeze
boundary preserved** (codex finding): today's keyword send snapshots
`priorInput` and `selections` at keyword time and clears them immediately
— selections added during the async HQ window deliberately belong to the
NEXT message (`InteractiveChat-voice.ts:92-118, 126-149`). The intent flow
keeps this exactly: the pure `buildVoiceSubmitEmission` (`input/voice-intent.ts`)
takes the frozen `priorInput`/`selectionsSnapshot` plus the final committed
text (post-HQ, if narration ran) and returns the Emission; the mapper
(still `runKeywordSend`) takes the snapshot and clears the live selections
before the HQ round-trip starts, same as before. **Decided in this chunk**
(named, boxholder-visible): the stop-send buttons ALIGN to fold selections
like every other path (see chunk 1's section above) — consistency wins,
the no-fold behavior was an accident of hand-built payloads. `RetentionStore`
(`input/retention.ts`): audio keyed by emission id, N most recent
in-memory (v1 N=5), `latest()` = most recent entry; `fulfillLastAudioRequest`
(`lib/last-audio.ts`, replacing `lib/last-audio-cache.ts`) reads it. A
voice send with NO recording (stop-and-send, recovered dictation, keyword
send with capture off) retains an explicit `null` tombstone under its
emission id, so `get-last-audio` answers none rather than serving an
older message's recording as if it were the latest (codex chunk-5
finding; matches the old cache's clear-on-voice-send behavior). The
loopback protocol, routes, and `cb chat get-last-audio` are untouched.
Fixes the typed-path clear wart by construction (sends never clear
retention; "latest" is well-defined).

Also added: a `?fakemic=<script>` / `localStorage["fakemic"]` debug seam
(`lib/fake-mic.ts`, wired into `machines/transcription-mic.ts`'s two
`getUserMedia` call sites) scripting mic behaviors a real device can't
reproduce on demand — `delay:<ms>`, `deny`, `end` (track-ended mid-use) —
dev builds only (`import.meta.env.DEV`; production never consults the
flag), dead code with the flag unset.

Doctest: retention keying/eviction/latest
(`test/frontend/lib/retention.doctest.md`); the pure submit-to-emission
mapping (`test/frontend/voice-intent.doctest.md`); updated stop-send pins
in `test/frontend/emission-assemble.doctest.md`.

## Subplans

None. The two candidate sub-questions (PlaceTarget/capture unification;
the actual native bridge) are deferred outright, not sub-planned.

## Failure modes

**Critical gap check:** none unresolved; the riskiest row (assembler
drift) is mitigated by exact-string doctests written BEFORE the refactor.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Assembled payload differs from today's (wrapper attrs, block order, token folding) | chunk-1 doctest pins exact strings for both origins first | refactor lands only when byte-identical | clear (test fails) |
| Draft migration picks the wrong draft / loses one (per-session → singleton) | chunk-4 doctest on adoption logic | most-recent-wins is deterministic; discarded drafts are a NAMED behavior change | clear in plan; silent to the user at runtime — accepted, documented in commit |
| localStorage quota / disabled storage (writes throw) | chunk-4 doctest (guarded-helper path) | ALL storage access via the try/catch helper (pattern: `lib/location-share.ts:102-113`); images/audio dropped from persistence over a size threshold | clear (console warn; emission still lives in memory) |
| Restored file attachment points at swept `tmp/` path (7-day housekeeping) | chunk-4 doctest (validation/drop path) | restore-time existence check; dead attachments dropped with a visible note | clear (user sees "attachment expired") |
| Send fails after optimistic clear (network / machine error) | chunk-3 doctest (rejected → restore) | submitted emission held until receipt settles; restored on `rejected` | clear (better than today, which loses the text) |
| Double submit (Enter twice / keyword + Enter race) | chunk-3 doctest | editor `clear()` is synchronous with dispatch; second submit sees empty emission and no-ops (today's empty-guard behavior, `InteractiveChat-actions.ts:82`) | clear |
| Voice submit races transcription finalize (audio blob not yet attached) | chunk-5 doctest | today's ordering preserved: finalize→attach→intent; intent handler reads the post-finalize emission | clear |
| Selection ids/tokens drift when state moves stores (chunk 2) | editor doctest covers insert/remove/strip round-trips | per-emission id counters travel with the emission | clear |
| Stop button relocation breaks interrupt during streaming | manual + existing machine doctests (INTERRUPT unchanged) | only the button MOVES; the INTERRUPT path is untouched | clear |
| Retention multi-tab: agent fetches from the wrong tab | unchanged behavior (first-audio-wins + none-grace, `last-audio-pending.ts:86-99`) | explicitly out of scope; semantics identical to today | clear (documented) |
| Remount-survival regression: some consumer still assumes per-mount input store | typecheck (store creation moves; old constructor deleted) | deleting `useInputStoreInstance` forces every consumer through the lifted instance | clear (compile error) |

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — N/A in the card sense (no cards); the
  equivalent (malformed payload) is pinned by chunk-1 exact-string tests.
- **Stale ref** — the analogue is a stale *target*: session gone →
  `status: unavailable`, submit disabled with reason (chunk 3). ADDRESSED.
- **Two agents / two tabs on the same state** — retention keeps today's
  first-wins rendezvous (unchanged); the emission singleton stays per-tab
  (design doc: "per-tab instances of a conceptual singleton; leave until
  it hurts"). DEFERRED, explicitly.
- **Hand-edit drift** — N/A (no hand-edited artifacts; localStorage only).
- **Fabricated free-form value** — N/A (no agent-authored fields here).
- **Validation error UX** — submit affordance reflects `TargetStatus`
  pre-submit (chunk 3); rejected receipts keep the emission intact with
  the error shown (design lifecycle). ADDRESSED.
- **Partial migration / transition state** — old per-session draft keys
  exist alongside the singleton exactly once (first load); adoption then
  removal is atomic per box. `cb chat get-last-audio` behavior is
  compatible at every chunk boundary. ADDRESSED.

## NOT in scope

- **PlaceTarget / capture unification, CameraFeeder** — capture's
  apparatus is untouched; the Target interface is designed to admit it
  later. (Design doc stages it "possibly much later.")
- **The native bridge itself** — only the serializability *rule* is
  enforced (types contain no React/DOM references; blobs by
  handle/dataBase64). No Swift/Kotlin, no webview harness.
- **Listening mode / Player** — a second stance, separate feature; this
  plan doesn't regress it because it doesn't exist yet.
- **Tableau / frame integration** — the input lifts to ChatPage level,
  not frame level; re-aiming across targets has one target kind anyway.
- **Async receipt settlement** — pending/reconcile machinery already
  handles it; formalizing settlement events adds surface with no consumer.
- **`composerMachine.keyboard` (mobile shell) relocation** — keeps
  working where it is; moving it is cosmetic and touches mobile UX better
  handled when an embodiment actually changes.
- **Multi-tab singleton unification** — per-tab today, per-tab after.
- **Per-conversation drafts** — explicitly rejected in the design
  (singleton model); revisit only on real regret.

## Open design questions

- **Where `TargetStrip` renders** (above the composer vs beside the send
  button) — an embodiment/layout call inside chunk 3's UI work; decided
  by look, not architecture. Lean: a slim row directly above the composer
  bar, where the streaming banners already appear.
- **Retention N and persistence** (memory-only N=5 vs IndexedDB) — v1
  memory-only N=5 (matches today's durability); the interface admits a
  policy change without callers noticing. Settled enough to build.

## Knowledge audits

None — skip with rationale: this plan is UI/architecture infrastructure
with no new agent-facing concept, tag, or convention. The one
agent-visible surface (`cb chat get-last-audio`) keeps identical CLI
behavior and protocol; its improved internals need no agent recall.

## Implementation order

1. Chunk 1 (Emission + assembler; exact-string doctests FIRST, then the
   refactor) — everything else depends on the noun.
2. Chunk 2 (editor/store consolidation) — depends on 1.
3. Chunk 3 (ChatTarget + strip + stop move) — depends on 1; parallel to 2
   in principle, landed after it to avoid rebasing the prop-bag surgery.
4. Chunk 4 (singleton lift + persistence + draft migration) — depends on 2.
5. Chunk 5 (voice intents + retention) — depends on 2 (editor
   `attachAudio`) and 3 (submit-via-input).

Each chunk: green suite + typecheck/lint before commit; live verification
in the worktree box for 3 (stop/queue affordances), 4 (survive a session
switch with photos+selections), 5 (voice send + `cb chat get-last-audio`).

## Rollout shape

- **Test posture**: the chunk-1 doctest is the design tool — written
  against TODAY's outputs before any refactor, so the assembler lands
  against a pinned spec. New doctests per chunk as listed; existing
  suites (composer-machine, selection-serialize, speech-message,
  composer-draft, reconcile-pending) must stay green untouched —
  behavior-preservation is the done-when for chunks 1-3; chunk 4's
  done-when is the new persistence tests plus the named behavior change
  verified live; chunk 5's is retention tests plus a live
  `get-last-audio` round-trip.
- **Migration**: only browser-local (draft keys); no box data, no cards,
  no server state changes shape. One-shot, per box, on first load of the
  new persistence.
- **Ships whole**: chunks are commits on this worktree branch; merge to
  main only on explicit boxholder ask, per the standing rule.
