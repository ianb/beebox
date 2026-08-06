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
```

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
