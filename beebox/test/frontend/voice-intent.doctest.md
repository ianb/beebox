# VoiceIntent — the pure submit-to-emission mapping

`buildVoiceSubmitEmission` (docs/plans/input-extraction.md, chunk 5) is the
pure piece of `runKeywordSend`'s submit logic: given the composer context
frozen at keyword-fire time (`priorInput`, `selectionsSnapshot`, and the
pending image/file attachment snapshots) and the final committed text
(after any HQ pass rewrites it), it builds the voice `Emission`. The
freeze boundary means composer state added after the snapshot was taken
never appears here — it belongs to the next message instead.

```ts setup
import { routeComposerSend } from "../../src/frontend/src/components/chat/InteractiveChat-helpers.js";
import { buildVoiceSubmitEmission, prepareVoiceSubmitEmission, sendKeywordOf } from "../../src/frontend/src/input/voice-intent.js";
```

## A live manual send always finalizes audio

The desktop and mobile Send buttons share this decision. A live voice segment
must enter `submitSegment` whether HQ dictation is enabled or not: finalization
is what hands the segment's staged recording to the send, which seals it; HQ
is a later, independent decision about what that seal asks the box for. The
settled fallback exists only for the narrow race where the segment became idle
before the click handler ran.

```ts
const calls: string[] = [];
routeComposerSend({
  isTranscribing: true,
  submitSegment: () => { calls.push("finalize"); return true; },
  sendTyped: () => calls.push("typed"),
  sendSettledVoice: () => calls.push("settled"),
})
=> finalizing

calls.join(",")
=> finalize

const settledCalls: string[] = [];
routeComposerSend({
  isTranscribing: true,
  submitSegment: () => false,
  sendTyped: () => settledCalls.push("typed"),
  sendSettledVoice: () => settledCalls.push("settled"),
})
=> settled

settledCalls.join(",")
=> settled

const typedCalls: string[] = [];
routeComposerSend({
  isTranscribing: false,
  submitSegment: () => { typedCalls.push("finalize"); return true; },
  sendTyped: () => typedCalls.push("typed"),
  sendSettledVoice: () => typedCalls.push("settled"),
})
=> typed

typedCalls.join(",")
=> typed
```

## Prior composer text folds in ahead of the new utterance

```ts
const e = buildVoiceSubmitEmission({
  priorInput: "note to self,",
  finalText: "buy more flour",
  selectionsSnapshot: [],
  imagesSnapshot: [],
  filesSnapshot: [],
  diarized: false,
});
e.text
=> note to self, buy more flour

e.origin
=> voice

e.diarized
=> false
```

## No prior text: the utterance stands alone

```ts
buildVoiceSubmitEmission({ priorInput: "", finalText: "send message", selectionsSnapshot: [], imagesSnapshot: [], filesSnapshot: [], diarized: false }).text
=> send message
```

## The frozen selections snapshot rides the emission, diarized carries through

```ts
const sel = [{ id: 1, ref: "/_content/recipes/Bread.recipe.card", text: "300g flour", position: "body" }];
const e2 = buildVoiceSubmitEmission({ priorInput: "", finalText: "add that", selectionsSnapshot: sel, imagesSnapshot: [], filesSnapshot: [], diarized: true });
e2.selections.length
=> 1

e2.selections[0]?.ref
=> /_content/recipes/Bread.recipe.card

e2.diarized
=> true
```

## Frozen attachment snapshots ride the emission (a file attached mid-dictation)

A file attached while dictating used to be silently dropped from keyword
sends; the frozen snapshots now carry pending images and files the same
way selections ride.

```ts
const e3 = buildVoiceSubmitEmission({
  priorInput: "",
  finalText: "please summarize the attached report",
  selectionsSnapshot: [],
  imagesSnapshot: [{ id: 1, mimeType: "image/png", dataBase64: "aGk=" }],
  filesSnapshot: [{ id: 1, path: "_tmp/2026-07-19T10-00-00_report.pdf" }],
  diarized: false,
});
e3.files[0]?.path
=> _tmp/2026-07-19T10-00-00_report.pdf

e3.images.length
=> 1
```

## Each call mints a distinct emission id (the dedup key)

```ts
const a = buildVoiceSubmitEmission({ priorInput: "", finalText: "x", selectionsSnapshot: [], imagesSnapshot: [], filesSnapshot: [], diarized: false });
const b = buildVoiceSubmitEmission({ priorInput: "", finalText: "x", selectionsSnapshot: [], imagesSnapshot: [], filesSnapshot: [], diarized: false });
a.id !== b.id
=> true
```

## `words: null` (Voxtral/OpenAI-style — Fix A) never reaches the emission as data

A service that never captures confidence (or a segment nothing was
finalized for) reports `null`, not an empty array — `buildVoiceSubmitEmission`
collapses that onto `undefined` via `resolveEmissionWords`, so the assembler
never stamps a false `stt="deepgram"`.

```ts
buildVoiceSubmitEmission({
  priorInput: "", finalText: "voxtral said this", selectionsSnapshot: [], imagesSnapshot: [], filesSnapshot: [], diarized: false,
  words: null,
}).words
=> undefined
```

Belt-and-braces: an array is present but no entry carries a numeric
`confidence` — equally uninformative, equally `undefined`.

```ts
buildVoiceSubmitEmission({
  priorInput: "", finalText: "no scores here", selectionsSnapshot: [], imagesSnapshot: [], filesSnapshot: [], diarized: false,
  words: [{ word: "no" }, { word: "scores" }],
}).words
=> undefined
```

A real Deepgram capture — even one where every word cleared the
threshold — rides straight through, so the assembler still stamps `stt`:

```ts
buildVoiceSubmitEmission({
  priorInput: "", finalText: "all clear", selectionsSnapshot: [], imagesSnapshot: [], filesSnapshot: [], diarized: false,
  words: [{ word: "all", confidence: 0.99 }, { word: "clear", confidence: 0.98 }],
}).words?.length
=> 2
```

## The HQ outcome replaces the spoken part of the frozen message

`prepareVoiceSubmitEmission` builds the dispatched emission from the realtime
emission staged when the segment ended and the HQ wait's outcome
(`docs/plans/resilient-voice-recording.md`, Track 4). The id and the frozen
composer context never change: text typed into the composer during the wait
belongs to the next message.

```ts
const hqIntent = {
  kind: "submit" as const,
  text: "rough words <send-message phrase=\"clean up and send\" />",
  matchedPhrase: "clean up and send",
  recording: { recordingId: "rec-hq", seal: () => {}, discard: () => {} },
  closeMic: false,
  hq: true,
  words: [{ word: "rough", confidence: 0.4 }],
};
const realtime = buildVoiceSubmitEmission({ priorInput: "frozen draft", finalText: hqIntent.text,
  selectionsSnapshot: [], imagesSnapshot: [], filesSnapshot: [], diarized: false, words: hqIntent.words });
const hq = prepareVoiceSubmitEmission({
  realtime,
  outcome: { kind: "hq", result: { text: "clean words", diarized: true, service: "voxtral", pieces: 1 } },
  keyword: sendKeywordOf(hqIntent),
});
hq.text
=> frozen draft clean words <send-message phrase="clean up and send" />

hq.id === realtime.id
=> true

JSON.stringify({ diarized: hq.diarized, words: hq.words ?? null, hqText: hq.hqText, hqService: hq.hqService, hqFallback: hq.hqFallback ?? null })
=> {"diarized":true,"words":null,"hqText":true,"hqService":"voxtral","hqFallback":null}
```

The HQ text replaced the realtime words, so Track 3's HQ-drop rule applies:
no `words` (and no `stt="deepgram"`/`<unsure>` marks at assemble time).

## A fallback sends the realtime message, marked

The budget ran out (or the user chose the live text, or HQ failed outright):
the realtime text goes out marked `hq="failed"`, and its realtime words ride
along.

```ts continue
const late = prepareVoiceSubmitEmission({ realtime, outcome: { kind: "fallback", reason: "budget", service: null }, keyword: null });
late.text
=> frozen draft rough words <send-message phrase="clean up and send" />

JSON.stringify({ hqFallback: late.hqFallback, words: late.words?.length, hqText: late.hqText ?? null })
=> {"hqFallback":true,"words":1,"hqText":null}

prepareVoiceSubmitEmission({
  realtime,
  outcome: { kind: "fallback", reason: { kind: "permanent", code: "missing_key", message: "No OpenRouter key" }, service: "mai" },
  keyword: null,
}).hqFallback
=> true
```

## A segment with no live text still becomes a message

Recorded wholly while live text was paused, a segment has no realtime text;
when HQ does not arrive, a placeholder body keeps the message (and its
`message-id`, which the kept recording answers to):

```ts
const silent = buildVoiceSubmitEmission({ priorInput: "typed first", finalText: "", selectionsSnapshot: [], imagesSnapshot: [], filesSnapshot: [], diarized: false });
const placeholder = prepareVoiceSubmitEmission({ realtime: silent, outcome: { kind: "fallback", reason: "budget", service: null }, keyword: null });
JSON.stringify({ text: placeholder.text, hqFallback: placeholder.hqFallback })
=> {"text":"typed first [recording not transcribed]","hqFallback":true}
```

## Manual stop-and-send HQ routing (empty `matchedPhrase`)

A manual stop-and-send (docs/implemented-plans/hq-dictation-switch.md, chunk 2 — the
desktop/mobile Send button with the always-HQ switch on) synthesizes a
"submit" intent with `matchedPhrase: ""`: nothing was spoken to match, unlike
a real keyword-fire. When the HQ pass finds no keyword in its own result
either, the fallback-tag restoration must NOT fire — there's no trigger
phrase to restore, and an empty `<send-message phrase="" />` would be
meaningless control markup with no narration-mode guidance to explain it.

```ts
const manualIntent = {
  kind: "submit" as const,
  text: "quick thought before I go",
  matchedPhrase: "",
  recording: { recordingId: "rec-manual", seal: () => {}, discard: () => {} },
  closeMic: true,
  hq: false,
  words: null,
};
sendKeywordOf(manualIntent)
=> null

const manualRealtime = buildVoiceSubmitEmission({ priorInput: "", finalText: manualIntent.text,
  selectionsSnapshot: [], imagesSnapshot: [], filesSnapshot: [], diarized: false });
const manualPrepared = prepareVoiceSubmitEmission({
  realtime: manualRealtime,
  outcome: { kind: "hq", result: { text: "quick thought before I go, corrected", diarized: false, service: "whisper-llm", pieces: 1 } },
  keyword: sendKeywordOf(manualIntent),
});
manualPrepared.text
=> quick thought before I go, corrected

JSON.stringify({ hqText: manualPrepared.hqText, hqService: manualPrepared.hqService })
=> {"hqText":true,"hqService":"whisper-llm"}
```
