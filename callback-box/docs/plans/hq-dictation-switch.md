---
title: "An always-HQ dictation switch, separate from narration mode"
status: draft
workstream: transcript-confidence
issues:
  - ../../../issues/features/2026-08-22-hq-dictation-switch-separate-from-narration.md
---

# An always-HQ dictation switch, separate from narration mode

Persistent high-quality dictation currently requires narration mode, which
also changes how the agent responds — two concerns on one switch
(`InteractiveChat-voice.ts`: `runHq = narrationEnabledRef.current ||
intent.hq`). This plan adds an `hq-dictation` chat feature that sets the HQ
pass persistently, and stamps per-message transcription provenance into the
existing `stt=` attribute so the agent knows retranscription has nothing to
add. Shape confirmed with the boxholder 2026-08-23.

## Job story

When I dictate a lot and care about the words, I want every send transcribed
by the better model without turning on narration mode, so my transcripts are
right by default and the agent never wastes a turn "upgrading" text that is
already the best pass.

## Stated preferences this plan trades against

- `feedback_minimal_concepts_prefer_primitives` (memory) and
  `docs/engineering-principles.md` #8: no new attribute, no new registry —
  the feature registry (`core/chat/features.ts`) and the existing `stt=`
  wrapper attribute carry everything.
- Boxholder constraint (issue): the agent-facing signal is **one clause**, not
  a third prompt paragraph.
- Precedents: the `narration` feature entry (`features.ts:31-37`); the
  `stt="deepgram"` stamp (`chat-assemble.ts`, transcript-confidence plan).

## What already exists

- **Feature registry** — `core/chat/features.ts`: `FeatureDescriptor`
  (`allowedValues`/`default`/`uiKind`/`label`), server-authoritative via
  `ChatSession.setFeature`, rendered into `<chat-app …>` per message.
  Verified 2026-08-23 — with a correction from cross-model review: the
  registry covers persistence, validation, and the snapshot attribute, but
  the **toggle UI is hand-wired per feature** (narration goes through
  `useChatModelFeatures` → `handleToggleNarration` → `VoiceChip`,
  `InteractiveChat-hooks.ts:155`, `VoiceChip.tsx:127`); no frontend consumer
  derives controls from `uiKind`. The new toggle mirrors narration's wiring.
- **Per-send HQ path** — `prepareVoiceSubmitEmission` with `runHq`
  (`InteractiveChat-voice.ts`), including the pending-draft UI and the
  realtime fallback (`!usedHq`). Reused unchanged; only the `runHq`
  predicate widens.
- **`stt=` attribute** — stamped by `chat-assemble.ts` when Deepgram words
  were captured and applied. Reused with generalized semantics (below).
  The chat prompt no longer references `stt=` (retuned on main since the
  unsure work), so the semantic change has no prompt coupling to unwind.
- **`words`/unsure pipeline** — HQ-replaced text already drops the realtime
  words (`usedHq → words: undefined`), so no-marks-on-HQ behavior already
  exists; this plan changes nothing there.

## Prior art (external)

None searched: purely internal wiring of an existing transcription path to an
existing preference mechanism; no third-party surface is involved beyond APIs
already integrated. (The one external fact this plan leans on — which
backends report word confidence — was researched in the transcript-confidence
plan.)

## Vocabulary lock-ins

- **Feature `hq-dictation`**: `["on", "off"]`, default `"off"`, `uiKind:
  "toggle"`, label "HQ dictation". Renders as `<chat-app hq-dictation="on">`
  for free; the agent is NOT taught to reason from it (the per-message stamp
  is the signal).
- **`stt="hq"`** — the one new value, stamped when the committed text came
  from the HQ pass (the new switch, narration mode, or the per-send "send
  HQ" keyword — the latter two are already-HQ today with no signal, a
  pre-existing gap this closes). Its meaning is FUNCTIONAL, per the
  boxholder (2026-08-23): "retranscribe is unlikely to do anything" — the
  text already came from the better model. Deliberately NOT the resolved
  service name: a name would make the agent need a roster of which services
  are HQ, and nothing else reads the attribute (the retranscription
  event/badge already carries the service where it's shown). This also
  deletes plumbing — `usedHq` is a boolean the send path already has.
  - `stt="deepgram"` keeps today's meaning (realtime with per-word
    confidence; `<unsure>` marks possible). Absent stays "unknown / no
    data" (old messages, iOS native dictation, HQ fallback to realtime).
  - Marks and provenance stay orthogonal: our current HQ integrations carry
    no per-word confidence so HQ messages have no `<unsure>` marks — a fact
    about the integrations, not the design (boxholder, 2026-08-23); if an
    HQ backend ever grows confidence, marks can return without vocabulary
    change.
- **One prompt clause**, inside the existing retranscribe sentence, to the
  effect of: *(skip it when the message's wrapper says `stt="hq"` — that
  text already came from the better model)*. No new paragraph.

## Tracks / scope

One track, in commit-sized chunks (revised after cross-model review):

1. **Feature entry + toggle UI + live threading**: `hq-dictation` in
   `features.ts`; frontend derives `hqDictationEnabled` and hand-wires a
   toggle mirroring narration's path (`useChatModelFeatures` →
   `handleToggle…` → the voice/settings chrome beside the narration
   control), with the optimistic-set/rejection behavior narration's toggle
   already has. Threading into the keyword path uses an
   `hqDictationEnabledRef` read at keyword-fire, exactly like
   `narrationEnabledRef` (`InteractiveChat-voice.ts:72,132` — the intent
   fires through the transcription hook's ref pattern, so a derived boolean
   alone would be stale); `runHq` becomes
   `hqDictationEnabledRef.current || narrationEnabledRef.current ||
   intent.hq`.
2. **Stop-and-send honors the switch** (review finding: tap-send builds its
   emission straight from realtime text and never runs HQ — with the switch
   on, the most common non-keyword send would silently stay realtime,
   making "always" a lie). When `hq-dictation` is on, the desktop/mobile
   stop-and-send path routes through the same finalize→blob→HQ slow path
   keyword sends use (`prepareVoiceSubmitEmission` + the existing
   pending-draft UI), falling back to realtime text on HQ failure exactly
   as keyword sends do. Out of scope and stated so: recovered dictation
   (no live segment, no audio) and native iOS sends (no web recording) stay
   realtime and unstamped.
3. **Provenance stamp**: the emission carries one new bit — `hqText: true`
   (or equivalent minimal typed shape) set when `usedHq`;
   `chat-assemble.ts` stamps `stt="hq"` for it, keeping `stt="deepgram"`
   for the captured-words case (mutually exclusive: HQ replacement drops
   the words). Fallback-to-realtime keeps today's behavior exactly. No
   route changes. The bit is a frontend fact (`usedHq`,
   `voice-intent.ts:95,129`) — no server-side name involved.
4. **Comment/audit sweep for the widened `stt` vocabulary** (review
   finding): comments equating `stt` with Deepgram confidence
   (`emission.ts:51`, `unsure-words.ts:58`,
   `realtimeTranscriptionMachine.ts:55`, `chat-assemble.ts` stamp comment)
   get the second value; `knowledge-audits.yaml`'s "messages without stt=
   carry no confidence data" wording updates to stay true.
5. **Prompt clause + docs-gen touch**: the one clause, attached to the
   RETRANSCRIBE half of the sentence only — `ask-about-audio` remains fully
   applicable to HQ messages (can/can't, tone, background are about the
   sound, not the transcript). Check the generated command guide's
   retranscribe copy for a one-line alignment.
6. **Tests**: registry entry round-trip; pinned assemble serialization for
   the `stt="hq"` stamp (extend `emission-assemble.doctest.md`, incl.
   mutual exclusion with `stt="deepgram"`); voice-intent doctest for the
   widened `runHq`, the `hqText` bit, and the stop-and-send HQ routing;
   fallback case pins no-stamp. Re-run the two chat audits after the prompt
   edit.

## Could this be simpler?

Simplest version: the feature entry alone, no provenance stamp — the agent
finds out retranscribe is pointless by running it and getting identical text
back. Rejected: it spends the user's turn to learn what one attribute could
have said, on every HQ chat (`stop-over-engineering` doesn't apply — this is
reachable by ordinary use, not a rare failure). Second-simplest: signal via
the session-level `<chat-app hq-dictation>` attribute the registry already
renders. Rejected for accuracy (boxholder-confirmed): the setting flips
mid-conversation, and narration/"send HQ" messages are already HQ with no
session-level signal at all — only a per-message stamp describes the message
the agent is actually looking at.

## Subplans

None.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| HQ pass fails mid-send (`!usedHq` fallback) | exists + extended | realtime text commits, `stt` reflects reality (deepgram or absent), no HQ claim | clear (existing warn) |
| Agent retranscribes an HQ message anyway | prompt-level | harmless — returns the same text, shows the overlay; the clause exists to make it rare, not impossible | visible, low cost |
| Feature on + Voxtral realtime configured (no Deepgram) | planned | `runHq` is orthogonal to realtime service; HQ pass runs regardless | clear |
| New frontend against old server (the risky deploy direction — review finding) | planned | `setFeature` rejects the unknown name (`chat-control-procedures.ts:181`); the toggle surfaces the rejection instead of pretending, and no client-side HQ runs on a value the server refused | clear |
| Tap-send with the switch on (pre-review gap) | planned (chunk 6) | routed through the HQ slow path; realtime fallback on failure | clear (pending-draft UI shows the wait) |

**Critical gap:** none — every degradation lands on an honest absent-stamp or
today's behavior.

## Agent-flow / user-flow edge cases

- **Wrong tag/field** — ADDRESSED: agents never write `stt=`; the existing
  never-fabricate guidance covers the wrapper attributes generally.
- **Stale ref / two agents / hand-edit** — not applicable.
- **Fabricated value** — ADDRESSED: the stamp derives from the frontend's
  own `usedHq` outcome (`voice-intent.ts:95,129`), never from agent output.
- **Validation UX** — ADDRESSED: feature values validate against
  `allowedValues` in the existing setFeature path.
- **Transition state** — ADDRESSED: absent stamp = unknown, which is every
  pre-existing message; no backfill.

## NOT in scope

- **`stt="device"` for iOS native dictation** — same vocabulary, separate
  change (the bridge doesn't stamp anything today; the prompt's existing
  "failure is about that one recording" guidance covers the runtime error).
- **Per-box persistence / a select with "auto"** — deliberate deferrals
  (boxholder-confirmed): per-chat matches the mechanism; "auto" has no
  existing path to name.
- **Confidence marks from HQ backends** — possible (Whisper logprobs,
  Deepgram batch) but its own effort; the vocabulary already accommodates it.

## Open design questions

None — the shape was settled with the boxholder 2026-08-23.

## Knowledge audits

The `chat-unsure-word-semantics` and `chat-last-audio-when` audits cover the
surrounding guidance; the new clause is an exception *within* the sentence
they already exercise. Add one `chat_mode` audit only if the clause changes
their pass status when re-run — run both after the prompt edit; if green,
skip-with-rationale stands (the clause is a narrow exception, not a new
procedure).

## Implementation order

Chunks 1→2→3→4 as one serialized build (same-subproject rule), then re-run
the two audits, then the closing cross-model review on the diff.

## Rollout shape

- Tests named per chunk above; done-when = suites green + audits green.
- No migration; all additive.
- Lands from this worktree; the issue moves to `needs: [manual-testing]`
  (toggle on, dictate, verify HQ text + `stt=` stamp + no wasted
  retranscribe turns).
