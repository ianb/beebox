# VoiceIntent — the pure submit-to-emission mapping

`buildVoiceSubmitEmission` (docs/plans/input-extraction.md, chunk 5) is the
pure piece of `runKeywordSend`'s submit logic: given the composer context
frozen at keyword-fire time (`priorInput`, `selectionsSnapshot`, and the
pending image/file attachment snapshots) and the final committed text
(after any HQ pass rewrites it), it builds the voice `Emission`. The
freeze boundary means composer state added after the snapshot was taken
never appears here — it belongs to the next message instead.

```ts setup
import { buildVoiceSubmitEmission, prepareVoiceSubmitEmission } from "../../src/frontend/src/input/voice-intent.js";
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
const sel = [{ id: 1, ref: "/store/recipes/Bread.recipe.card", text: "300g flour", position: "body" }];
const e2 = buildVoiceSubmitEmission({ priorInput: "", finalText: "add that", selectionsSnapshot: sel, imagesSnapshot: [], filesSnapshot: [], diarized: true });
e2.selections.length
=> 1

e2.selections[0]?.ref
=> /store/recipes/Bread.recipe.card

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
  filesSnapshot: [{ id: 1, path: "tmp/2026-07-19T10-00-00_report.pdf" }],
  diarized: false,
});
e3.files[0]?.path
=> tmp/2026-07-19T10-00-00_report.pdf

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

## Cleanup-send holds this frozen message for HQ

The async HQ result is applied to the composer context captured when the
keyword fired. Text that appears in the live composer while HQ is pending is
not part of this emission.

```ts
const hqIntent = {
  kind: "submit" as const,
  text: "rough words <send-message phrase=\"clean up and send\" />",
  matchedPhrase: "clean up and send",
  audioBlob: new Blob(["audio"], { type: "audio/wav" }),
  closeMic: false,
  hq: true,
  words: [{ word: "rough", confidence: 0.4 }],
};
let finishHq: () => void = () => {};
const hqGate = new Promise<void>((resolve) => { finishHq = resolve; });
const pending = prepareVoiceSubmitEmission({
  intent: hqIntent,
  priorInput: "frozen draft",
  selectionsSnapshot: [],
  imagesSnapshot: [],
  filesSnapshot: [],
  runHq: true,
  transcribe: async () => {
    await hqGate;
    return { text: "clean words", diarized: true };
  },
});
const nextComposerText = "belongs to the next message";
finishHq();
const prepared = await pending;
prepared.emission.text
=> frozen draft clean words <send-message phrase="clean up and send" />

prepared.emission.text.includes(nextComposerText)
=> false

prepared.emission.diarized
=> true

prepared.emission.words
=> undefined

prepared.emission.hqText
=> true
```

The HQ pass used `hqIntent`'s words to describe text that got replaced —
`usedHq` is true, so Track 3's HQ-drop rule applies: no `words` (and no
`stt`/`<unsure>` marks at assemble time) regardless of what the realtime
pass captured.

## Cleanup-send falls back to the realtime message on HQ failure

```ts continue
const fallback = await prepareVoiceSubmitEmission({
  intent: hqIntent,
  priorInput: "frozen draft",
  selectionsSnapshot: [],
  imagesSnapshot: [],
  filesSnapshot: [],
  runHq: true,
  transcribe: async () => { throw new Error("offline"); },
});
fallback.usedHq
=> false

fallback.emission.text
=> frozen draft rough words <send-message phrase="clean up and send" />
```

The fallback used the realtime text, so `hqIntent.words` rides straight
through onto the emission unchanged — `usedHq` is false, so the HQ-drop
rule doesn't apply:

```ts continue
fallback.emission.words?.length
=> 1

fallback.emission.words?.[0]?.word
=> rough
```

No `hqText` bit either — the fallback never touched the HQ pass:

```ts continue
fallback.emission.hqText
=> undefined
```

## Manual stop-and-send HQ routing (empty `matchedPhrase`)

A manual stop-and-send (docs/plans/hq-dictation-switch.md, chunk 2 — the
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
  audioBlob: new Blob(["audio"], { type: "audio/wav" }),
  closeMic: true,
  hq: false,
  words: null,
};
const manualPrepared = await prepareVoiceSubmitEmission({
  intent: manualIntent,
  priorInput: "",
  selectionsSnapshot: [],
  imagesSnapshot: [],
  filesSnapshot: [],
  runHq: true,
  transcribe: async () => ({ text: "quick thought before I go, corrected", diarized: false }),
});
manualPrepared.usedHq
=> true

manualPrepared.emission.text
=> quick thought before I go, corrected

manualPrepared.emission.hqText
=> true
```
