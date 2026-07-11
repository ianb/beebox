---
title: "hume ai prosody"
area: callback-box
---

[Hume.ai](https://hume.ai) offers prosody/expression models that go beyond
words — pitch, pacing, emphasis, emotional contour. Two directions worth
prototyping:

- **Listen** — run incoming voice memos through a prosody pass alongside the
  existing transcription. Annotate the resulting transcript card with the
  prosody signal (excited / tentative / rushed / reading-aloud) so downstream
  agents have non-textual context to work with. E.g. "user sounds frustrated"
  could shift how the agent triages the request.
- **Live overlay on the chat input** — while the user is dictating in the
  chat box, render the prosody read live above the input (a small badge
  strip: "tentative", "rushed", color-shifted). Two purposes: (a) helps the
  user see what the system is actually picking up about their delivery
  before they hit send, which is a closed-loop calibration signal that
  doesn't exist today; (b) makes it obvious when the prosody signal would
  shift downstream behavior, so the user can decide whether to redo the
  utterance with a different tone. Lightweight prototype: a small React
  component subscribed to the Hume realtime stream, painted above the
  textarea.
- **Speak** — use Hume's TTS for outbound speech where prosody markup matters
  (briefings, longer narration). Compare against OpenAI TTS on naturalness for
  the kinds of content this system actually produces.

Cheap to try because it's a connector + a couple of card-field additions; no
deep architectural changes. Worth doing as a focused experiment to see whether
the prosody annotations actually steer agent behavior in useful ways, or just
add noise.
