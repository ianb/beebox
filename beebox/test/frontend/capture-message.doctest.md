# Capture message chip parser

`parseCaptureWrapper` is the single-wrapper compatibility helper used by the
capture dev harness. Production transcript rendering uses the shared ordered-
parts parser so text can surround the chip. `captureChipLabel` builds the
one-line "Capture — N photos, M:SS audio" label. Both are pure — the wrapper
string is a chat-vocabulary lock-in, so these are asserted against the exact
output of `buildCaptureWrapper`.

```ts setup
import { parseCaptureWrapper, captureChipLabel } from "../../src/frontend/src/components/chat/capture-message.js";
import { buildCaptureWrapper } from "../../src/core/capture/deliver.js";
```

## The exact wrapper from `buildCaptureWrapper` round-trips into the chip model

```ts
const wrapper = buildCaptureWrapper({
  docPath: "tmp-capture/capture-20260709T1432-ab3f.capture-session.card",
  imageCount: 3,
  audioSeconds: 250,
  summary: "Walked through the kitchen.",
});
JSON.stringify(parseCaptureWrapper(wrapper))
=> {"doc":"tmp-capture/capture-20260709T1432-ab3f.capture-session.card","images":3,"audio":"4:10","summary":"Walked through the kitchen.","partial":false,"transcriptionFailed":false}
```

The chip label reads the counts:

```ts continue
captureChipLabel(parseCaptureWrapper(wrapper))
=> Capture — 3 photos, 4:10 audio
```

## `partial` and `transcription-failed` flags parse to booleans

```ts
const wrapper = buildCaptureWrapper({
  docPath: "tmp-capture/x.capture-session.card",
  imageCount: 1,
  audioSeconds: 5,
  summary: "hi",
  partial: true,
  transcriptionFailed: true,
});
const model = parseCaptureWrapper(wrapper);
JSON.stringify([model.partial, model.transcriptionFailed, model.images, model.audio])
=> [true,true,1,"0:05"]

captureChipLabel(model)
=> Capture — 1 photo, 0:05 audio
```

## A photos-only capture drops the audio segment (0:00 → no audio label)

```ts
const wrapper = buildCaptureWrapper({
  docPath: "tmp-capture/x.capture-session.card",
  imageCount: 2,
  audioSeconds: 0,
  summary: "2 photos",
});
const model = parseCaptureWrapper(wrapper);
JSON.stringify([model.audio, captureChipLabel(model)])
=> ["0:00","Capture — 2 photos"]
```

## Non-capture text is not a capture

```ts
parseCaptureWrapper("just a normal message")
=> null

parseCaptureWrapper("<capture images=\"1\">no doc attr</capture>")
=> null
```

## The compatibility helper accepts exactly one wrapper

The compatibility helper returns one model or `null`, so surrounding whitespace
is tolerated but surrounding visible text is rejected. The production
transcript parser does not have this restriction: it returns ordered text and
capture parts without swallowing either.

```ts
const wrapper = buildCaptureWrapper({
  docPath: "tmp-capture/x.capture-session.card",
  imageCount: 1,
  audioSeconds: 5,
  summary: "hi",
});

// The bare wrapper (optionally whitespace-padded) still parses.
parseCaptureWrapper(wrapper) !== null
=> true

parseCaptureWrapper("\n\n" + wrapper + "\n") !== null
=> true

// Leading prose cannot reduce to one compatibility model.
parseCaptureWrapper("see this: " + wrapper)
=> null

// Neither can trailing prose.
parseCaptureWrapper(wrapper + " what do you think?")
=> null
```
