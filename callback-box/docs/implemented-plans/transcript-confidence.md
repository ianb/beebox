---
title: "Mark low-confidence transcript words, agent-first"
status: implemented
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

One new inline marker inside the `<speech>` body, plus one new `<speech>`
attribute (boxholder decision, 2026-08-15, after reviewing rendered examples
from the measurement data):

- `<unsure>word</unsure>` — wraps, in place, each word the transcriber had low
  acoustic confidence in: `<unsure>In</unsure> fact, you are an agent…`. **No
  score is carried** — a numeric confidence is false precision for the
  consumer; the threshold is applied once, internally. The tag name is the
  self-documentation: session logs, retranscribe printouts, and quoted
  messages all read sensibly with no key at hand. Markers are placed by
  matching the Deepgram words stream against the sent body (sequential,
  normalized, fail-open per word — a word that cannot be confidently located
  is left unmarked; a marker on the wrong word is worse than none).
- `<speech stt="deepgram" …>` — stamped **only when confidence data was
  captured and applied**. Its absence means no per-word confidence backs this
  message (Voxtral, OpenAI realtime, iOS native dictation, HQ-replaced text,
  or a capture/alignment failure): unmarked-because-blind, distinct from
  unmarked-because-confident. This is the honest answer to Voxtral parity, and
  it keeps every degradation collapsed onto one truthful state.
- Threshold: **0.85**, a named constant with a comment citing this plan's
  measurement. Not user-configurable. *(Post-ship corrections, 2026-08-15,
  both from the boxholder's real-world dictation: (1) lowered to **0.7** —
  the 0.85 mark rate was much noisier than the measurement sample
  predicted; (2) marks became **phrase spans** — word-level marks felt
  falsely exact, with the actually-wrong word often scoring fine inside a
  low-confidence region, so a mark now seeds at <0.7 and spreads across
  adjacent <0.9 words (hysteresis), bridges one confident word between low
  regions, and stops at sentence-final punctuation. `unsure-words.ts`
  records both.)*
- **Leakage-by-copy is the accepted cost** of inline (the cross-model review
  argued for a separate element on this ground): an agent reusing dictated
  text into a card could carry markers along. Mitigation is Track 5's prompt
  key — strip `<unsure>` markers when reusing the text — plus the display
  never rendering raw tags. A separate `<unsure-words>` element with context
  snippets was fully designed and implemented first, then rejected for
  indirection: the agent had to join entries back to occurrences, which
  in-place marking gives for free.

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

### Track 3 — emission carries words; assemble marks the body inline

- **What**: at keyword-fire / stop time, snapshot the captured words stream
  onto the emission (`words: FinalWord[]`, undefined = no data captured). At
  assemble time, place `<unsure>` markers into the body by **sequential
  normalized matching** of the words stream against the body text. The body is
  `keyword.processedTranscript` (keyword-stripped, sometimes interim-derived,
  `useRealtimeTranscription.ts:119-145`), joined with prior composer input
  (`runKeywordSend`, `InteractiveChat-voice.ts:94-134`), so matching must be
  **fail-open per word** (cross-model review findings 1–2): tokens the words
  stream cannot be confidently aligned to (typed prior input, interim tails,
  stripped keyword remnants) simply carry no markers. `stt="deepgram"` is
  stamped when words were captured and applied.
- **Send-site rules**:
  - Keyword fast path and slow path (`runKeywordSend`): words snapshotted from
    the hook at fire time, passed on the emission.
  - **HQ/narration replaces the text** (`prepareVoiceSubmitEmission` with
    `usedHq`, `InteractiveChat-voice.ts:132-151`): realtime words describe
    text that was discarded — **drop the words and the `stt` attr** (review
    finding 5). When the HQ pass falls back to realtime text (`!usedHq`),
    marks attach.
  - Recovered dictation (`sendVoiceSegment`) and manual stop-and-send: pass
    words when the hook still holds them for the sent text; otherwise none.
- **Why**: this is the persistence step — the `<speech>` content in the SDK
  JSONL is what the agent reads and what the display re-parses after reload.
- **First chunk**: pure marking function (words stream × body text →
  marked body) with doctests (extend `emission-assemble.doctest.md`: clean
  match, prior-typed-input prefix, keyword-stripped tail, repeated words,
  no-match fail-open, none-unsure → `stt` only, HQ-drop case), then the
  wiring.

### Track 4 — display styling of marked words

- **What**: the user-message rendering path parses `<unsure>word</unsure>`
  spans in the displayed text and renders the word with a subtle style
  (italic, a muted color, or a dotted underline — pick one during
  implementation with a `bin/browse` look). Nothing more: no tooltip, no
  legend chrome (boxholder decision, 2026-08-15). Raw tags must never show.
- **Verify during implementation**: whether the message parser strips unknown
  embedded tags is **unverified** (review finding 8 —
  `user-message.tsx` delegates to imported parsers). First step is reading
  `DeliveredMessageParts`/`UserMessageText`'s actual parser and handling
  `<unsure>` explicitly there.
- **Why**: the read-back moment; same data, second consumer.
- **First chunk**: the whole track, with a frontend doctest for the parse and
  a `bin/browse` visual check.

### Track 5 — agent guidance

- **What**: a short addition to the chat prompt
  (`src/core/chat/session/prompts.ts`, beside the existing retranscribe
  guidance): `<unsure>word</unsure>` wraps words the transcriber had low
  acoustic confidence in; treat a marked meaning-critical word
  (not/can't/numbers/names) as unverified — ask or `cb chat retranscribe`;
  **absence of marks is not verification** (messages without `stt=` carry no
  confidence data at all, and confident substitutions never get flagged);
  **strip the markers when reusing the text** (writing it into a card, quoting
  it); never fabricate the marker in your own output.
- **Why**: the marks are only as good as the agent's understanding of their
  semantics (principle #12).
- **First chunk**: the prompt text + one knowledge-audit entry (see below).

## Could this be simpler?

Simplest plausible version: a bare trailing list —
`<unsure-words>"cloud"; "can"</unsure-words>` — no body changes, no matching.

Why the plan marks inline instead: the bare list is **ambiguous for repeated
words**, and the low tail is dominated by repeatable function words
(measurement: "that" ×3 under 0.8 in one message). For the agent's
inverted-meaning case, *which* "not" is uncertain is the entire signal;
in-place marking answers it with zero indirection, and display styling falls
out of the same parse. (Principle #3: the boundary annotation must be
unambiguous to its consumer.)

The design went around the loop deliberately (all on 2026-08-15): inline tags
with scores → separate `<unsure-words>` element with context snippets (after
cross-model review flagged that keyword-stripping, interim commits,
prior-input joins, and HQ replacement all transform the body,
`InteractiveChat-voice.ts:94-163`, `useRealtimeTranscription.ts:119-145`, and
that machine markup muddies the user's words) → **inline `<unsure>` without
scores** (boxholder decision, after reviewing rendered examples: the
element's entry-to-occurrence indirection was the worse cost, and a numeric
score is false precision). What survived the loop: the alignment concern
(marking is fail-open per word), the leakage concern (Track 5's strip-on-reuse
instruction), and the `stt=` no-data discriminator. Scores were dropped.

What the plan deliberately keeps from the simple version: no new metadata
channel, no per-message JSON field, no sidecar for chat — the existing
embedded-markup convention carries everything.

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
| Interim-triggered keyword send commits interim text with no final words for the tail | planned (Track 3 doctest) | marks cover only finalized segments; stated coverage limit | silent, bounded (marks that can be placed still are) |
| Reconnect merges text (`committedPrefix`) but words drift | planned (Track 2 reconnect doctest) | words committed in the same actor transitions as text; on any unmergeable case, discard words → message sends without `stt=` | clear (`stt` absent = no data claim) |
| HQ pass replaces realtime text; realtime words describe discarded text | planned (Track 3 HQ-drop doctest) | drop words + `stt` when `usedHq` | clear (`stt` absent) |
| Words-stream token can't be confidently located in the transformed body (prior typed input, keyword remnants, repeated words) | planned (Track 3 doctests) | fail-open per word: no marker placed | silent per word, by design (wrong mark is worse) |
| Display shows raw `<unsure>` tags (unknown-tag stripping unverified — review finding 8) | planned (Track 4 doctest) | Track 4 explicitly handles the marker in the message parser | clear (visible if it regresses) |
| Agent copies `<unsure>` markers into cards / its own output | no (prompt-level) | prompt: strip on reuse, never fabricate | silent gap, low harm — visible cruft if it happens |
| iOS native dictation / Voxtral / OpenAI paths send no words | planned (Track 3: absence case) | no `stt` attr, no marks; prompt explains the distinction | clear (attribute absent) |

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

- **Display styling** — decided (boxholder, 2026-08-15): just a subtle style
  on the marked words (italic / muted color / dotted underline — pick one in
  Track 4 with a `bin/browse` look); no tooltip, no legend chrome.
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
  drove the fail-open alignment + reconnect/HQ handling above; finding 7
  added the runtime guards; finding 9 (citations the reviewer could not
  reach) was verified separately during planning. A second adversarial Codex
  pass on the implementation diff found four real defects, all fixed in the
  same branch (commit `932961d5`): false `stt=` stamping for non-Deepgram
  services (words context is now `FinalWord[] | null`, and an array with no
  confidence-bearing entries collapses to no-data), the aligner wrapping text
  inside generated `<send-message>` markup (tokenizer treats `<...>` spans as
  opaque), typed-prefix words taking a spoken word's mark (`spokenStart`
  offset), and ASCII-only word splitting corrupting accented words (Unicode
  classes). It also wired the tap-send path to carry words, and surfaced the
  pre-existing husk-title raw-markup bug (filed:
  `issues/bugs/2026-08-15-chat-husk-title-contains-raw-message-markup.md`).
  Accepted, not fixed: selection anchor matching can degrade to estimated
  placement when an anchor phrase contains a marked word (documented in
  `chat-assemble.ts`).
- **No migration**: additive markup in new messages only; old messages and
  non-Deepgram messages read as "no data" everywhere.
- **Ships as one unit** from this worktree when the boxholder says so; the
  manual-testing gate (implementation order #6) stays open until they dictate
  against it for real.
