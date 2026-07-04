# VoiceIntent — the pure submit-to-emission mapping

`buildVoiceSubmitEmission` (docs/plans/input-extraction.md, chunk 5) is the
pure piece of `runKeywordSend`'s submit logic: given the composer context
frozen at keyword-fire time (`priorInput`, `selectionsSnapshot`) and the
final committed text (after any HQ pass rewrites it), it builds the voice
`Emission`. The freeze boundary means selections added to the live
composer after the snapshot was taken never appear here — they belong to
the next message instead.

```ts setup
import { buildVoiceSubmitEmission } from "../../src/frontend/src/input/voice-intent.js";
```

## Prior composer text folds in ahead of the new utterance

```ts
const e = buildVoiceSubmitEmission({
  priorInput: "note to self,",
  finalText: "buy more flour",
  selectionsSnapshot: [],
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
buildVoiceSubmitEmission({ priorInput: "", finalText: "send message", selectionsSnapshot: [], diarized: false }).text
=> send message
```

## The frozen selections snapshot rides the emission, diarized carries through

```ts
const sel = [{ id: 1, ref: "/store/recipes/Bread.recipe.card", text: "300g flour", position: "body" }];
const e2 = buildVoiceSubmitEmission({ priorInput: "", finalText: "add that", selectionsSnapshot: sel, diarized: true });
e2.selections.length
=> 1

e2.selections[0]?.ref
=> /store/recipes/Bread.recipe.card

e2.diarized
=> true
```

## Each call mints a distinct emission id (the dedup key)

```ts
const a = buildVoiceSubmitEmission({ priorInput: "", finalText: "x", selectionsSnapshot: [], diarized: false });
const b = buildVoiceSubmitEmission({ priorInput: "", finalText: "x", selectionsSnapshot: [], diarized: false });
a.id !== b.id
=> true
```
