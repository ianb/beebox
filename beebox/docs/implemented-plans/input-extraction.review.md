# Plan Engineering Review — input-extraction (codex cross-model pass)

Reviewer: OpenAI codex (gpt-5.5, high reasoning, read-only over the repo),
2026-07-04. Prompted adversarially per `.claude/skills/codex`. Findings
below verbatim-condensed, each with the planner's verification and
disposition. Plan amendments landed in the same commit as this file.

## Findings and dispositions

### 1. HIGH — synchronous `accept()` receipts are wrong
Codex: a pre-submit status snapshot cannot truthfully decide sent-vs-queued
— an idle-path POST can still resolve `{queued:true}`, `{deduplicated:true}`,
or fail after the machine entered streaming (`chat-actors.ts:294-307`,
`chat-send-routes.ts:246-254`).
**Verified: correct** (matches the backend survey's STREAM_QUEUED race).
**Disposition: adopted.** Chunk 3 now returns `Promise<Receipt>` settled
from the actual outcome; input clears optimistically (today's UX) but holds
the submitted emission and restores it on `rejected` — strictly better than
today, which loses failed text.

### 2. HIGH — the plan missed three send call sites
Codex: desktop stop-and-send (`InteractiveChat-composer.tsx:99-106`) and
mobile stop-and-send (`InteractiveChat-mobile-row.tsx:88-96`) hand-build
raw `<speech>` and bypass `buildSpeechMessage` AND selection folding;
recovered dictation (`InteractiveChat.tsx:169-176`) is a third voice site.
**Verified: correct** (read all three; the stop-send paths also never
reset pending selections — an additional latent wart).
**Disposition: adopted.** Chunk 1 enumerates all five sites with per-site
exact-string doctests, reproducing the no-fold behavior explicitly;
aligning stop-send folding is a named decision deferred to chunk 5.

### 3. HIGH — persisted file attachments dangle after tmp/ sweep
Codex: `tmp/…` upload paths are swept after 7 days
(`housekeeping.ts:23`); whole-emission restore would silently resurrect
dead references.
**Verified: correct.**
**Disposition: adopted.** Chunk 4 adds restore-time existence validation;
dead attachments drop with a visible "attachment expired" note. New
failure-mode row.

### 4. MEDIUM — voice/HQ freeze boundary oversimplified
Codex: keyword send freezes `priorInput` + `selectionsSnapshot` before the
async HQ pass; selections added during the HQ window deliberately belong
to the next message (`InteractiveChat-voice.ts:92-118, 126-149`). A
mutable editor path could let content jump messages.
**Verified: correct** (matches the frontend survey).
**Disposition: adopted.** Chunk 5: submit consumes a point-in-time
emission snapshot; live emission clears immediately; HQ-window additions
accumulate in the fresh emission.

### 5. MEDIUM — stop-TTS relocation is not a pure button move
Codex: `STOP_SPEECH` in `pausedForSpeech` must also `resumeMic`
(`composerMachine.ts:194-199`, wired via `handleStopSpeech`).
**Verified: correct in mechanism** (the voice region owns speech↔mic
coordination).
**Disposition: adopted.** Chunk 3: the strip's stop-TTS control invokes
the existing voice-coordination handler (the design's sanctioned
crossing); only rendering moves.

### 6. MEDIUM — localStorage handling asserted, not present
Codex: draft hooks call `setItem` unguarded (`useComposerDraft.ts:80,105`);
the repo's safe pattern exists at `lib/location-share.ts:102-113`.
**Verified: correct.**
**Disposition: adopted.** Chunk 4 requires the guarded helper for all
reads/writes/migration/cleanup; failure-mode row updated.

### 7. SCOPE OPINION — defer ChatTarget/VoiceIntent/RetentionStore
Codex's minimal version: assembly for all send surfaces, then the
singleton lift; defer the target/intent/retention abstractions.
**Disposition: not adopted.** The target/stop separation and retention are
boxholder-directed scope (the stop-conflation and single-slot audio were
explicit complaints, not architecture for its own sake). The
implementation order already runs assembly-first; if chunks 1-2 surface
trouble, this is the pre-agreed fallback cut line.

## Things codex checked and found clean (implicitly)
Citations in "What already exists" other than the send-site enumeration
were not contradicted; the queue/interrupt/dedup semantics summary stood.

## Net effect on the plan
Five findings adopted (receipts async + restore-on-reject; five send
sites; tmp validation; freeze boundary; stop-TTS seam; guarded storage),
one scope opinion recorded with the fallback cut line. No chunk
reordering needed — the findings deepen chunks 1, 3, 4, 5 without
changing dependencies.
