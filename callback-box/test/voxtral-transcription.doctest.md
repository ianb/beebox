# Voxtral transcription helpers

The Voxtral non-streaming API returns both a top-level `text` field
(the joined transcript) and a `segments` array with per-chunk text.
The `text` field occasionally concatenates sentence-end + next
sentence without a space ("have gone.Generic tools"). Primary fix is
to rebuild the transcript from segments, joined with a single space —
that's the source level. `repairMissingSentenceSpaces` is a fallback
for responses where segments is empty.

```ts setup
import {
  joinSegmentTexts,
  repairMissingSentenceSpaces,
  findLastSpeakerLetter,
  nextSpeakerLetter,
  relabelDiarizedSpeakers,
} from "../src/core/transcription-voxtral.js";
```

## joinSegmentTexts — rebuild from segments

Two segments where the second starts with a new sentence: spaced
correctly even if Voxtral's own `text` had no space.

```ts
joinSegmentTexts([
  { text: "It went the way a lot of these things have gone." },
  { text: "Generic tools were better." },
])
=> It went the way a lot of these things have gone. Generic tools were better.
```

Empty / whitespace-only segments are dropped; the rest still join.

```ts
joinSegmentTexts([
  { text: "First sentence." },
  { text: "   " },
  { text: "Second sentence." },
])
=> First sentence. Second sentence.

joinSegmentTexts([])
=> null

joinSegmentTexts(undefined)
=> null

joinSegmentTexts([{ text: "" }, { text: "  " }])
=> null
```

## The bug case — sentence-end followed by a letter

```ts
repairMissingSentenceSpaces("It went the way a lot of these things have gone.Generic tools were better.")
=> It went the way a lot of these things have gone. Generic tools were better.

repairMissingSentenceSpaces("Where I said elements, it's actually LLMs.see how that goes.")
=> Where I said elements, it's actually LLMs. see how that goes.

repairMissingSentenceSpaces("Yes!What?Maybe.Now go.")
=> Yes! What? Maybe. Now go.
```

## Don't break decimals or ellipses

```ts
repairMissingSentenceSpaces("Version 1.2 released")
=> Version 1.2 released

repairMissingSentenceSpaces("Wait... what?")
=> Wait... what?

repairMissingSentenceSpaces("The price is $9.99")
=> The price is $9.99
```

## Already-spaced text is untouched

```ts
repairMissingSentenceSpaces("One sentence. Another sentence.")
=> One sentence. Another sentence.
```

## Per-recording speaker letter

Diarized recordings get a session-letter so the agent can tell that
identical speaker numbers from different recordings are different
people. `findLastSpeakerLetter` scans prior session text;
`nextSpeakerLetter` advances; `relabelDiarizedSpeakers` rewrites the
raw `Speaker N` prefix to `Speaker (N+1)<letter>`.

```ts
findLastSpeakerLetter("")
=> null

findLastSpeakerLetter("no labels here")
=> null

findLastSpeakerLetter("earlier: Speaker 1A: hi\nlater: Speaker 2C: bye")
=> C

findLastSpeakerLetter("Speaker 10F: ok")
=> F
```

```ts
nextSpeakerLetter(null)
=> A

nextSpeakerLetter("A")
=> B

nextSpeakerLetter("Y")
=> Z

nextSpeakerLetter("Z")
=> A
```

```ts
relabelDiarizedSpeakers("Speaker 0: hi\nSpeaker 1: bye", "B")
=> Speaker 1B: hi
Speaker 2B: bye

relabelDiarizedSpeakers("Speaker 0: solo", "A")
=> Speaker 1A: solo
```
