# Speech message assembly (voice selection fold-in)

`buildSpeechMessage` wraps voice-transcribed text in a `<speech>` tag and
folds any attached selections into the body through the shared serializer.
Spoken bodies carry no `[selectionN]` tokens, so every selection is appended
— this is the regression guard that the voice send paths don't silently drop
selections. `attrs` is the caller-built attribute string (the dynamic
local-time / zoomed-view / time-passed bits).

```ts setup
import { buildSpeechMessage } from "../src/frontend/src/components/chat/InteractiveChat-helpers.js";
```

## Plain speech, no selections

```ts
buildSpeechMessage({ text: "found three items", diarized: false, selections: [], attrs: " local-time=\"14:23\"" })
=>
<speech local-time="14:23">found three items</speech>
```

## Diarized HQ transcription

```ts
buildSpeechMessage({ text: "speaker A and speaker B", diarized: true, selections: [], attrs: " local-time=\"14:23\"" })
=>
<speech diarized="1" local-time="14:23">speaker A and speaker B</speech>
```

## A pending selection is appended after the spoken text

```ts
JSON.stringify(buildSpeechMessage({
  text: "look at this part",
  diarized: false,
  selections: [{ id: 1, ref: "/store/notes/Bread.doc.card", text: "let it rise", position: "body; heading: Proofing (#proofing)" }],
  attrs: " local-time=\"14:23\"",
}))
=>
"<speech local-time=\"14:23\">look at this part\n<user-selection ref=\"/store/notes/Bread.doc.card\" pos=\"body; heading: Proofing (#proofing)\">let it rise</user-selection></speech>"
```
