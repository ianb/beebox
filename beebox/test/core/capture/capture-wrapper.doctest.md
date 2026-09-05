# Capture message wrapper

`buildCaptureWrapper` renders the `<capture>` chat message — a first-class user
message pointing at the committed capture document. The exact string is a
chat-vocabulary lock-in. `summarizeCapture` picks the one-line summary.

```ts setup
import { buildCaptureWrapper, summarizeCapture } from "../../../src/core/capture/deliver.js";
```

## The wrapper: doc, image count, audio duration (M:SS), one-line summary

```ts
JSON.stringify(buildCaptureWrapper({
  docPath: "tmp-capture/capture-20260709T1432-ab3f.capture-session.card",
  imageCount: 3,
  audioSeconds: 250,
  summary: "Walked through the kitchen.",
}))
=> "<capture doc=\"tmp-capture/capture-20260709T1432-ab3f.capture-session.card\" images=\"3\" audio=\"4:10\">\nWalked through the kitchen.\n</capture>"
```

Seconds pad to two digits; sub-minute clips read `0:SS`:

```ts
buildCaptureWrapper({ docPath: "tmp-capture/x.capture-session.card", imageCount: 0, audioSeconds: 5, summary: "hi" }).split("\n")[0]
=> <capture doc="tmp-capture/x.capture-session.card" images="0" audio="0:05">
```

`partial` and `transcription-failed` add their flags, in that order:

```ts
buildCaptureWrapper({
  docPath: "tmp-capture/x.capture-session.card",
  imageCount: 0,
  audioSeconds: 5,
  summary: "hi",
  partial: true,
  transcriptionFailed: true,
}).split("\n")[0]
=> <capture doc="tmp-capture/x.capture-session.card" images="0" audio="0:05" partial="1" transcription-failed="1">
```

## The summary: first sentence, else N photos, else filename

```ts
summarizeCapture({ firstTranscript: "Hello there. More words follow.", imageCount: 2 })
=> Hello there.

summarizeCapture({ imageCount: 3 })
=> 3 photos

summarizeCapture({ imageCount: 1 })
=> 1 photo

summarizeCapture({ imageCount: 0, firstFileName: "report.pdf" })
=> report.pdf

summarizeCapture({ imageCount: 0 })
=> capture
```

A transcript with no sentence boundary is used whole:

```ts
summarizeCapture({ firstTranscript: "just a fragment", imageCount: 0 })
=> just a fragment
```
