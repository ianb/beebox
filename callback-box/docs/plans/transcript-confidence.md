---
title: "Mark low-confidence transcript words, agent-first"
status: draft
workstream: transcript-confidence
issues:
  - ../../../issues/features/2026-08-15-mark-low-confidence-words-in-transcripts.md
  # Shared metadata design only; its display work stays open:
  - ../../../issues/features/2026-08-12-show-retranscription-in-chat.md
---

# Mark low-confidence transcript words, agent-first

Deepgram reports a per-word confidence score that callback-box currently
discards. This plan carries that score through the realtime dictation path and
embeds low-confidence word marks in the persisted chat message, so the **agent**
sees which words the transcriber was unsure about (a low-confidence "not" can
invert the meaning of an instruction), and the **human** sees the same marks
rendered in the sent-message bubble. Storage is data-plus-markup in the existing
`<speech>` wrapper; no card prose is altered.

The primary consumer is the agent (boxholder direction, 2026-08-15): the agent
should act on uncertainty — ask, or run `cb chat retranscribe` — rather than
silently trusting a guessed word. Human display is derived from the same marks.

## Job stories

- When I dictate an instruction while walking and the transcriber hears "can"
  where I said "can't", I want the agent to see that "can" was a low-confidence
  guess, so it double-checks (retranscribes or asks) instead of doing the
  opposite of what I asked.
- When I read back a memo I dictated an hour ago, I want the words the
  transcriber guessed at to be visibly marked, so my eye stops on "cloud code"
  and I fix it to "Claude Code" before the wrong words become what the box
  believes.

## Measurement basis (2026-08-15)

Ran the production batch call (nova-3, params identical to
`src/core/transcription/deepgram.ts:99-105`) over the 11 dictation recordings in
the test1 clone — 642 words, ~5 minutes of one speaker. Raw data preserved in
the session scratchpad; summary:

- Distribution: 74% of words ≥0.99, median 0.999. Tail: 10.7% <0.9, 5.9% <0.8,
  2.6% <0.7.
- **Proper nouns score high**, contrary to the issue's worry: Minneapolis
  0.999, Powderhorn 0.977, TikTok 0.995, Bicking 0.926, "symmetric tensor
  decomposition" ≈0.98. Nova-3 is not spooked by rare-but-correct words.
- **Function words dominate the low tail**: of the 38 words <0.8, ~26 are
  of/the/that/is/a-class words.
- **Real errors score low**: "cloud" (for *Claude*) 0.288 and 0.763; "worked"
  (mishearing) 0.478; "Anthropix" (for *Anthropic's*) 0.818; "can" (plausible
  "can't") 0.515. A 0.85 threshold catches all of these.
- Confident substitutions still pass unmarked (a dropped "know" scored clean):
  **an unmarked word is not a verified word**, and the agent guidance must say
  so.

Threshold consequence: embed marks for words **< 0.85**. On the sample that is
~4/message-minute including function words — acceptable for an agent, and the
function words are not noise for the agent (a low-confidence "not"/"can" is the
highest-value mark). Human-display suppression is deliberately NOT added in the
first pass — see Open design questions.

## Stated preferences this plan trades against

- `docs/engineering-principles.md` — #1 (types are structure: confidence rides
  typed fields, not parallel arrays), #3 (validate at boundaries: Deepgram
  response is the boundary; missing confidence must not crash), #4 (resilient
  and never silent: word/text misalignment degrades to unmarked WITH a
  `console.warn`), #6 (right-sized defensiveness), #8 (one way: one marker
  vocabulary for agent and human, derived from one data source), #12 (the
  maintainer is usually an agent).
- `callback-box/CLAUDE.md`: "Read before writing"; "don't add features beyond
  what the task requires"; keep source generic.
- Monorepo memory `feedback_minimal_concepts_prefer_primitives`: reuse the
  existing embedded-XML-in-message-text convention (`<typed>`/`<speech>`
  attributes, `<send-message>`, `<user-selection>`) instead of inventing a new
  metadata channel; avoid two-tier threshold schemes.
- Precedent: the `<speech diarized="1">` attribute
  (`src/frontend/src/input/targets/chat-assemble.ts:87-88`) — transcription
  provenance already rides the `<speech>` wrapper.

## What already exists

- **Batch Deepgram mapping drops confidence** —
  `src/core/transcription/deepgram.ts:57-62` (`DeepgramWord` lacks
  `confidence`), `:127-131` (mapping). Reused: the plan adds the field to the
  existing interface and mapping; no new client.
- **Realtime Deepgram messages already carry `words[]` with confidence into the
  browser** — `src/frontend/src/machines/transcription-connections.ts:143-153`
  reads only `alternatives[0].transcript` from each `Results` message. Reused:
  the same `onmessage` handler accumulates words.
- **The `<speech>` wrapper and its attribute convention** —
  `chat-assemble.ts:74-88` builds `<speech diarized="1" ...>body</speech>`; the
  persisted SDK JSONL stores this flat text, which is exactly what the agent
  reads (`src/cli/lib/session-entry.ts:114-159`). Reused as the durable,
  agent-visible carrier. There is no structured per-message metadata field to
  use instead (verified: `ChatSendInput`, `src/core/chat/session/messages.ts:79-108`,
  folds everything into wire text).
- **Display-side embedded-tag parsing** —
  `src/frontend/src/components/chat/user-message.tsx` delegates to imported
  parsers/renderers that handle embedded tags (`<send-message>`,
  `<user-selection>`). Reused as the pattern to follow — but whether unknown
  tags are stripped generically is **unverified** (cross-model review finding
  8); Track 4 starts by reading the actual parser.
- **Word-timestamp plumbing and sidecars** — `WordTimestamp` /
  `DetailedTranscriptionResult` (`src/core/transcription/index.ts:86-92`);
  capture clips write `words` to `<basename>.timing.json`
  (`src/core/capture/transcribe-clips.ts:138-143`); `cb chat retranscribe
  --timestamps` writes `<audioPath>.words.json`
  (`src/cli/commands/chat-audio.ts:334-337`). Reused: adding `confidence?` to
  `WordTimestamp` enriches both sidecars with no format change.
- **Agent guidance surface** — `src/core/chat/session/prompts.ts` already tells
  the agent to use `cb chat retranscribe` for homophones and dropped negatives.
  Reused: the new mark semantics slot into that same section and finally give
  the agent a trigger for *when*.
- **Fake transcription service** — `src/core/transcription/fake.ts:81-86`
  scripts `words`; doctests use it. Reused for tests (add `confidence` to
  scripted words).

## Prior art (external)

Searched 2026-08-15 (see session research report):

- Deepgram documents per-word `confidence` (0–1, "larger values indicate higher
  confidence") for batch and streaming; no official threshold guidance exists.
  [Live streaming docs](https://developers.deepgram.com/docs/live-streaming-audio).
  Interim results are documented as less accurate than finals; no documented
  difference in the confidence *field's* semantics — this plan reads words only
  from `is_final` results, sidestepping the question.
- [Evaluating ASR Confidence Scores for Automated Error Detection…
  (arXiv:2503.15124, CHI 2025)](https://arxiv.org/abs/2503.15124): across 9 ASR
  systems, confidence correlates with accuracy in aggregate but
  threshold-flagging is a weak error detector, and flagging did **not** improve
  human correction efficiency in a 36-person study. This is direct support for
  the agent-first framing: the human-display half is secondary and cheap, not
  the load-bearing justification.
- [Gladia's low-confidence-flagging guide](https://www.gladia.io/blog/confidence-scores-and-quality-flags-in-note-taker-transcripts)
  documents the same phenomena our measurement found: function words scoring
  low ("not" at 0.44 in their example) and high-confidence wrong proper nouns.
- Product prior art: Rev highlights low-confidence words in its editor; Dragon
  patent literature describes red/bold styling with a configurable threshold.
  Nothing found on function-word suppression in shipped products; Otter and
  Google Recorder searches came up empty for confidence marking.
- **Voxtral: documented absence** — Mistral's transcription response enumerates
  timestamps/diarization/context-biasing, no confidence field
  ([docs](https://docs.mistral.ai/studio/audio/speech_to_text)). OpenAI
  realtime transcription is documented as returning no confidence
  ([guide](https://developers.openai.com/api/docs/guides/realtime-transcription)).
  So Deepgram is the only backend that can mark, and that is a documented fact,
  not an implementation gap.

## Vocabulary lock-ins

One new machine-authored child element inside `<speech>` (following the
`<user-selection>` child-element precedent, `chat-assemble.ts:74-88`), plus one
new `<speech>` attribute. The user's spoken text is **never** modified or
wrapped — the body stays byte-identical to today (cross-model review finding,
2026-08-15: inline tags muddy user words, system annotation, and display markup
in the one string every downstream consumer reads).

- `<unsure-words>"cloud" (0.29, in "they're all cloud code in"); "can" (0.52,
  in "I think can have some")</unsure-words>` — appended after the body, one
  entry per word below the threshold. Each entry carries the punctuated word,
  the score (2 decimals), and a **context snippet of ±2 neighboring words taken
  from the Deepgram words stream itself** — never from the sent body. Content
  anchoring survives every transform the text goes through before send
  (keyword-phrase removal, prior-composer-text prepend, punctuation drift);
  repeated words ("that" ×3 under 0.8 in one sample message) are disambiguated
  by their snippet.
- `<speech stt="deepgram" …>` — stamped **only when confidence data was
  captured and attached**. Its absence means no per-word confidence backs this
  message (Voxtral, OpenAI realtime, iOS native dictation, HQ-replaced text,
  or a capture failure): unmarked-because-blind, distinct from
  unmarked-because-confident. This is the honest answer to Voxtral parity, and
  it keeps every degradation collapsed onto one truthful state.
- Threshold: **0.85**, a named constant with a comment citing this plan's
  measurement. Not user-configurable.

## Tracks / scope

Ordered by implementation dependency.

### Track 1 — backend confidence plumbing (small, unblocks nothing but is the shared type)

- **What**: add `confidence: number` to `DeepgramWord`
  (`deepgram.ts:57-62`), carry it in the mapping (`:127-131`); add
  `confidence?: number` to `WordTimestamp` (`transcription/index.ts:86-89`);
  let `fake.ts` script it. Voxtral's word-building
  (`voxtral-request.ts:150-167`) sets nothing — the field stays absent.
- **Why**: the batch surfaces (capture `.timing.json`, retranscribe
  `.words.json`) get confidence for free, and the type is the single shared
  definition (principle #1, #8).
- **First chunk**: the whole track — one commit with a doctest asserting the
  mapping carries confidence and tolerates its absence.

### Track 2 — realtime words capture (frontend machine)

- **What**: in `startDeepgramConnection`
  (`transcription-connections.ts:140-166`), read
  `msg.channel.alternatives[0].words[]` from **final** results (with a
  `typeof w.confidence === "number"` runtime guard — the success response is
  not zod-validated, `transcription-connections.ts:141` is a raw
  `JSON.parse`); surface them through `ServiceCallbacks` into the **actor's
  context** (`realtimeTranscriptionMachine` / `transcription-actor.ts`), and
  expose `finalWords: Array<{word, confidence}>` from
  `useRealtimeTranscription` beside `finalTranscript`. Voxtral and OpenAI
  connections never populate it.
- **Why**: confidence exists only inside the WS `onmessage` today; nothing
  downstream can see it.
- **Direction detail — reconnects (cross-model review finding)**: the actor
  merges per-connection text into a `committedPrefix` across reconnect
  (`transcription-actor.ts:147-155, 177-182, 292-297`). The words array must
  be committed/merged **in the same transitions** that commit text, so a
  reconnect that drops or replays a segment's text drops or replays its words
  identically. The doctest covers a scripted reconnect. If a merge case cannot
  keep the two in step, the words array for the segment is discarded (message
  sends without `stt=`) — never allowed to drift.
- **Coverage limit, stated**: interim-triggered keyword sends commit interim
  text (`useRealtimeTranscription.ts:124-145`) whose words never became final;
  that tail carries no confidence entries. Low-confidence entries from
  already-final segments still attach.
- The composer textarea is untouched (it renders a plain string and cannot
  style words — see NOT in scope).
- **First chunk**: connections + actor context + hook, with a doctest at the
  machine level using scripted messages including a reconnect.

### Track 3 — emission carries unsure entries; assemble appends the element

- **What**: at keyword-fire / stop time, compute the low-confidence entries
  **directly from the captured words stream**: for each word < 0.85, take
  `{word, confidence, context}` where context is the ±2 neighboring words from
  the same stream. There is **no alignment against the sent body** — the body
  is `keyword.processedTranscript` (keyword-stripped, sometimes
  interim-derived, `useRealtimeTranscription.ts:119-145`), joined with prior
  composer input (`runKeywordSend`, `InteractiveChat-voice.ts:94-134`), so
  positional alignment against it is structurally unreliable (cross-model
  review findings 1–2). `createVoiceEmission`
  (`src/frontend/src/input/emission.ts:108`) gains optional
  `unsureWords: Array<{word, confidence, context}>`; `chat-assemble.ts`
  serializes them as the `<unsure-words>` child element (XML-escaped) and
  stamps `stt="deepgram"`.
- **Send-site rules**:
  - Keyword fast path and slow path (`runKeywordSend`): entries computed from
    the hook's `finalWords` at fire time, passed on the emission.
  - **HQ/narration replaces the text** (`prepareVoiceSubmitEmission` with
    `usedHq`, `InteractiveChat-voice.ts:132-151`): realtime words describe
    text that was discarded — **drop the entries and the `stt` attr** (review
    finding 5). When the HQ pass falls back to realtime text (`!usedHq`),
    entries attach.
  - Recovered dictation (`sendVoiceSegment`) and manual stop-and-send: pass
    entries when the hook still holds them for the sent text; otherwise none.
- **Why**: this is the persistence step — the `<speech>` content in the SDK
  JSONL is what the agent reads and what the display re-parses after reload.
- **First chunk**: pure entry-computation + serialization functions with
  doctests (extend `emission-assemble.doctest.md`: entries present, entries
  empty, XML-escape case, HQ-drop case), then the wiring.

### Track 4 — display marks in the sent bubble

- **What**: the user-message rendering path parses the `<unsure-words>`
  element out of the message (it must never show raw), then for each entry
  locates the word in the displayed text by **substring-matching its context
  snippet** and styles that word (dotted underline; tooltip "transcriber
  unsure (0.29)"). A word whose context no longer matches the displayed text
  (edited, HQ-shifted, keyword boundary) gets **no visual mark** — fail-open
  per word, never a mark on the wrong word (principle #4: a wrong mark is
  worse than no mark).
- **Verify during implementation**: the plan's earlier claim that
  `user-message.tsx` already strips unknown embedded tags is **unverified**
  (review finding 8 — it delegates to imported parsers). First step of this
  track is reading `DeliveredMessageParts`/`UserMessageText`'s actual parser
  and slotting `<unsure-words>` into the same mechanism `<user-selection>`
  uses; if unknown-tag stripping does not exist, add explicit handling for
  this element.
- **Why**: the read-back moment; same data, second consumer.
- **First chunk**: the whole track, with a frontend doctest for the parse and
  a `bin/browse` visual check.

### Track 5 — agent guidance

- **What**: a short addition to the chat prompt
  (`src/core/chat/session/prompts.ts`, beside the existing retranscribe
  guidance): an `<unsure-words>` element lists words the transcriber had low
  acoustic confidence in, with context and score; treat a listed
  meaning-critical word (not/can't/numbers/names) as unverified — ask or
  `cb chat retranscribe`; **absence of the element is not verification**
  (messages without `stt=` carry no confidence data at all, and confident
  substitutions never get flagged); never fabricate the element in your own
  output.
- **Why**: the marks are only as good as the agent's understanding of their
  semantics (principle #12).
- **First chunk**: the prompt text + one knowledge-audit entry (see below).

## Could this be simpler?

Simplest plausible version: a bare trailing list —
`<unsure-words>"cloud" (0.29); "can" (0.52)</unsure-words>` — no context
snippets, no display work.

What the fuller plan buys, concretely:

- The bare list is **ambiguous for repeated words**, and the low tail is
  dominated by repeatable function words (measurement: "that" ×3 under 0.8 in
  one message). For the agent's inverted-meaning case, *which* "not" is
  uncertain is the entire signal. The context snippet disambiguates at the
  cost of a few words per entry. (Principle #3: the boundary annotation must
  be unambiguous to its consumer.)
- Display marking reuses the same snippets for locating words; without them
  the display would guess among duplicates.

A **fancier** version was drafted and cut after cross-model review: inline
`<unsure c="…">word</unsure>` tags woven into the `<speech>` body. It gave
exact positions but (a) required aligning the words stream against a body that
keyword-stripping, interim commits, prior-input joins, and HQ replacement all
transform (`InteractiveChat-voice.ts:94-163`,
`useRealtimeTranscription.ts:119-145`) — structurally unreliable; and (b) put
machine-authored markup inside the user's own words, the one string every
downstream consumer (agent quoting, transcript rendering, retranscribe
comparison) reads. The child element keeps the body byte-identical to today.

What the plan deliberately keeps from the simple version: no new metadata
channel, no per-message JSON field, no sidecar for chat — the existing
embedded-XML child-element convention carries everything.

A second simplification considered and taken: **no display-side stopword
suppression and no second threshold**. The measurement showed suppression helps
a human, but two filters over one data source is a two-tier smell
(`feedback_minimal_concepts_prefer_primitives`), and the agent must see
function words. Start with one embed threshold and subtle styling; add display
suppression only if manual testing shows mark fatigue.

## Subplans

None. The retranscription-display issue
(`issues/features/2026-08-12-show-retranscription-in-chat.md`) shares the
vocabulary this plan locks in (`stt=` provenance on `<speech>`; the principle
that transcript-quality metadata rides the message) but its UI remains its own
future work — this plan does not build it.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Deepgram omits/mistypes `confidence` on a word (success responses are not zod-validated: `deepgram.ts:107-118` typed `.json<…>`, realtime raw `JSON.parse`) | planned (Track 1/2 doctests) | runtime `typeof` guard at read; word treated as no-data | silent by design (no data → no entry) |
| Interim-triggered keyword send commits interim text with no final words for the tail | planned (Track 3 doctest) | entries cover only finalized segments; stated coverage limit | silent, bounded (entries that exist still attach) |
| Reconnect merges text (`committedPrefix`) but words drift | planned (Track 2 reconnect doctest) | words committed in the same actor transitions as text; on any unmergeable case, discard words → message sends without `stt=` | clear (`stt` absent = no data claim) |
| HQ pass replaces realtime text; realtime words describe discarded text | planned (Track 3 HQ-drop doctest) | drop entries + `stt` when `usedHq` | clear (`stt` absent) |
| Entry text contains XML-significant characters (`<`, `&`, quotes) | planned (Track 3 doctest) | escape at serialization | clear (test-pinned) |
| Display shows raw `<unsure-words>` element (unknown-tag stripping unverified — review finding 8) | planned (Track 4 doctest) | Track 4 explicitly wires the element into the message parser | clear (visible if it regresses) |
| Display context-match fails (edited/shifted text) | planned (Track 4 doctest) | per-word fail-open: no visual mark; agent-facing element unaffected | silent per word, by design (wrong mark is worse) |
| Agent imitates `<unsure-words>` in its own output | no (prompt-level) | prompt forbids; display only parses it inside user messages | silent gap, low harm |
| iOS native dictation / Voxtral / OpenAI paths send no words | planned (Track 3: absence case) | no `stt` attr, no element; prompt explains the distinction | clear (attribute absent) |

**Critical gap:** none identified. Every degradation collapses onto one
truthful, distinguishable state — `stt=` absent means "no confidence data
backs this message" — rather than overloading "unmarked" with five meanings
(review finding 6).

## Agent-flow / user-flow edge cases

- **Wrong tag** — ADDRESSED: only one new tag; prompt (Track 5) tells the
  agent it is system-written, never agent-written.
- **Stale ref** — not applicable: no refs.
- **Two agents on one card** — not applicable: chat messages are append-only.
- **Hand-edit drift** — not applicable: session JSONL is not hand-edited.
- **Fabricated free-form value** — ADDRESSED: `c` is machine-stamped at
  assemble time; the agent is told not to fabricate marks (Track 5).
- **Validation error UX** — not applicable: no card validation in this path.
- **Partial migration / transition state** — ADDRESSED: old messages simply
  have no marks and no `stt` attribute; every reader treats absence as
  "no data". No backfill.

## NOT in scope

- **Live marking inside the composer textarea** — it is a plain
  `react-textarea-autosize` value (`InteractiveChat-composer.tsx:63`); styling
  words requires an overlay architecture. The read-back moment is post-send;
  marks land in the bubble. Revisit only if manual testing shows the composer
  moment matters.
- **Card-surface rendering** (memo bodies, capture transcripts): Track 1 puts
  confidence in the sidecars, but no card renderer marks words yet. First
  surface is chat (boxholder decision, 2026-08-15).
- **The retranscription indicator UI** — shared vocabulary only; the display
  work stays in its issue.
- **Known-vocabulary suppression** (box contacts suppressing marks): the
  measurement showed proper nouns score high, so the mechanism lacks evidence
  it is needed.
- **Confidence from the HQ pass** (`transcribeAudioHq`): whisper/voxtral HQ
  backends report none; nothing to plumb.
- **A user-facing threshold setting** — one constant, tuned by measurement,
  not preference.

## Open design questions

- **Display mark styling weight** — dotted underline vs. background tint;
  settle in Track 4 via `bin/browse` screenshots, boxholder eyeball. Lean:
  dotted underline, tooltip with score.
- **Display suppression of function words** — deliberately deferred until the
  boxholder has lived with unsuppressed marks (see Could this be simpler?).
  The knob, if needed, is display-only; the embedded data never thins.
- **Should `stt=` also ride `<typed>` messages?** Lean no: typed text has no
  transcriber.

## Knowledge audits

One new agent-facing concept: the `<unsure>` mark and its semantics
(low-confidence ≠ wrong; unmarked ≠ verified; retranscribe on meaning-critical
marks). Add one `knows_directly` entry to
`src/dev/knowledge-audits.yaml` asking the agent what an `<unsure c="0.4">`
mark inside a user message means and what to do about a marked "not". Run it
(`pnpm knowledge-audit run`) before the plan completes. Note: the semantics
arrive via the per-turn chat prompt (not CLAUDE.md recall), so the audit
verifies the prompt text teaches, not memory.

## Implementation order

1. **Track 1** — backend types + mapping + fake + doctest. No dependents
   below break without it, but it defines the shared word shape.
2. **Track 2** — realtime capture (connections → machine → hook) + doctest.
3. **Track 3** — alignment/markup function + doctest, then emission/assemble
   wiring. Depends on 2.
4. **Track 4** — display parse + render + doctest + `bin/browse` check.
   Depends on 3 (parses what 3 writes).
5. **Track 5** — prompt guidance + knowledge audit (run it). Independent of 4.
6. Manual-testing note on the issue (`needs: [manual-testing]`): dictate via
   the web composer against a box with Deepgram realtime enabled; confirm
   marks in the sent bubble and in the session JSONL, and that an agent turn
   references the uncertainty when a marked meaning-critical word appears.

Chunks 1 and 2 could run in parallel by different agents (different
subprojects' files); 3–4 are serialized after 2 (same frontend area —
`project_parallel_subagents_worktree_collide`).

## Rollout shape

- **Tests first, per track**: Track 1 extends a transcription doctest; Track 2
  a machine doctest with scripted WS messages including a reconnect; Track 3
  extends `emission-assemble.doctest.md` (entries present/empty, XML-escape,
  HQ-drop, interim-tail cases); Track 4 a frontend parse + context-match
  doctest. Done-when = those pass plus the knowledge audit runs green.

- **Cross-model review**: the plan was reviewed by Codex (gpt-5.5, high
  effort, 2026-08-15; raw output in the session scratch). Findings 1–6 and 8
  drove the child-element + context-anchoring redesign and the reconnect/HQ
  handling above; finding 7 added the runtime guards; finding 9 (citations the
  reviewer could not reach) was verified separately during planning. A second
  cross-model pass runs on the implementation diff before the work is called
  done.
- **No migration**: additive markup in new messages only; old messages and
  non-Deepgram messages read as "no data" everywhere.
- **Ships as one unit** from this worktree when the boxholder says so; the
  manual-testing gate (implementation order #6) stays open until they dictate
  against it for real.
