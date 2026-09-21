# Voice chip face

`VoiceChipFace` (`components/chat/VoiceChip.tsx`) is the presentational half of
the app bar's voice chip — renderable standalone, without the `Dropdown` or
router context the full `VoiceChip` needs.

Two marks carry two **orthogonal** facts:

- **Who holds the floor** (the arrows) — taking turns, or you narrating while
  the box listens. Podcast, the box holding the floor, is the third value of the
  same axis and is not built.
- **How the box answers** (the speaker mark) — aloud, or in writing. The
  speaker body is drawn either way; only what leaves it changes.

Both are shown because neither implies the other: in narration the box is silent
by default but may still speak by exception — when asked, or when the boxholder
is hands-busy (`NARRATION_OVERLAY`) — and answering in text removes that
exception, so a genuine question arrives as a callout instead.

This replaced a microphone dimmed to 40% when narration was off. A mic cannot
carry the distinction (voice input uses the mic in both modes), and the deeper
reason is that narration is a *relationship*: it changes what the box does as
much as what you do, and no single-participant picture shows a relationship
(`issues/closed/bugs/2026-08-06-narration-mode-icon-ambiguous-with-mic.md`).

The drawing that replaced the mic also drew the participants — a person, a bot,
and the bot's output, strung with the arrow across a 50×16 strip. At phone size
each of those four marks was about 8px under a 1.3px stroke, and the boxholder
read them as three unrelated glyphs
(`issues/bugs/2026-09-15-mobile-app-bar-crowds-place-label.md`). The
participants went and the two facts stayed: fewer marks is the only thing that
makes each mark bigger. The relationship survives in the arrow, which has two
ends of its own — an exchange points both ways, a held floor points one — and
in the accessible name, which says it in words either way.

Speaker labels (diarization) no longer have a mark. They used to be a second
head on the person; with no person drawn they live in the accessible name and
the menu's service row. `data-voice-diarization` still reports the state.

```ts setup
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { VoiceChipFace, voiceChipDiarizationEnabled } from "../../src/frontend/src/components/chat/VoiceChip.js";
import { voiceChipLabel } from "../../src/frontend/src/components/chat/voice-chip-label.js";

globalThis.React = React;

function renderFace(state) {
  return renderToStaticMarkup(React.createElement(VoiceChipFace, state));
}

/** The floor mark: opposed arrows for an exchange, one arrow for a held floor. */
const TURNS = "M.5 5h6.5m-2-2 2 2-2 2M9 11H2.5m2-2-2 2 2 2";
const YOU_HOLD_FLOOR = "M.5 8h8.5m-2.5-2.5L9 8 6.5 10.5";
/** The answer mark: one speaker body in both states, and what leaves it. */
const SPEAKER_BODY = "M11 6h1.5L14.5 4v8l-2-2H11z";
const ALOUD = "M16 6.4a2.4 2.4 0 0 1 0 3.2";
const IN_TEXT = "M16 5h3.5M16 8h2.5M16 11h3.5";
```

## Taking turns, answering aloud

```ts
const face = renderFace({ muted: false, narrationEnabled: false, hqInFlight: false, diarizationEnabled: false });
JSON.stringify([face.includes(TURNS), face.includes(YOU_HOLD_FLOOR), face.includes(ALOUD), face.includes(IN_TEXT)])
=> [true,false,true,false]
```

Nothing is conveyed by dimming any more — the old face wrapped the mic in an
`opacity-40` span to mean "narration off", which is a brightness difference with
nothing to compare it against.

```ts continue
face.includes("opacity-40")
=> false
```

```ts continue
JSON.stringify([face.includes('data-voice-muted="false"'), face.includes('data-voice-narration="false"'), face.includes("transcribing…")])
=> [true,true,false]
```

## The box answers in writing

Written lines leaving the speaker, not a slashed speaker: a slash says
*suppressed*, and that is not what happens — the box still answers, in text. The
body stays for the same reason, and because lines on their own read as a list.

```ts
const face = renderFace({ muted: true, narrationEnabled: false, hqInFlight: false, diarizationEnabled: false });
JSON.stringify([face.includes(IN_TEXT), face.includes(ALOUD), face.includes(SPEAKER_BODY), face.includes('data-voice-muted="true"')])
=> [true,false,true,true]
```

## You hold the floor

```ts
const face = renderFace({ muted: false, narrationEnabled: true, hqInFlight: false, diarizationEnabled: false });
JSON.stringify([face.includes(YOU_HOLD_FLOOR), face.includes(TURNS), face.includes('data-voice-narration="true"')])
=> [true,false,true]
```

## The two axes combine, and the name says both in words

The marks carry it with an arrow and a speaker; the accessible name says it
outright, because a relationship and a channel do not survive being read as a
list of toggle names.

```ts
JSON.stringify([
  voiceChipLabel({ muted: false, narrationEnabled: false, hqInFlight: false, diarizationEnabled: false }),
  voiceChipLabel({ muted: true, narrationEnabled: false, hqInFlight: false, diarizationEnabled: false }),
  voiceChipLabel({ muted: false, narrationEnabled: true, hqInFlight: false, diarizationEnabled: false }),
  voiceChipLabel({ muted: true, narrationEnabled: true, hqInFlight: false, diarizationEnabled: false }),
])
=> ["Voice — taking turns, answers aloud","Voice — taking turns, answers in text","Voice — you are narrating, it listens, answers aloud","Voice — you are narrating, it listens, answers in text"]
```

## HQ transcription in flight keeps its readable label

```ts
const face = renderFace({ muted: false, narrationEnabled: false, hqInFlight: true, diarizationEnabled: false });
face.includes("transcribing…")
=> true

voiceChipLabel({ muted: false, narrationEnabled: false, hqInFlight: true, diarizationEnabled: false })
=> Voice — taking turns, answers aloud, transcribing
```

## Diarization changes neither the floor nor the answer channel

A diarized HQ service only applies when HQ dictation or narration is enabled.
Narration automatically requests HQ; merely selecting a diarized HQ service
while both modes are off does not enable speaker labels.

```ts
JSON.stringify(["voxtral-diarized", "mai-diarized", "voxtral", "mai", "whisper", "whisper-llm", "whisper-llm-mini", null].map(hqService =>
  [
    voiceChipDiarizationEnabled({ hqService, hqDictationEnabled: false, narrationEnabled: false }),
    voiceChipDiarizationEnabled({ hqService, hqDictationEnabled: true, narrationEnabled: false }),
    voiceChipDiarizationEnabled({ hqService, hqDictationEnabled: false, narrationEnabled: true }),
  ]
))
=> [[false,true,true],[false,true,true],[false,false,false],[false,false,false],[false,false,false],[false,false,false],[false,false,false],[false,false,false]]
```

Every combination draws one SVG holding exactly three `<path>` marks — the
floor arrow, the speaker body, and what leaves it — and speaker labels change
none of them: the face for a diarized state is identical to the face without it.

```ts
const combinations = [false, true].flatMap(diarizationEnabled => [false, true].flatMap(narrationEnabled => [false, true].map(muted => {
  const face = renderFace({ muted, narrationEnabled, diarizationEnabled, hqInFlight: false });
  return [
    (face.match(/<svg /g) ?? []).length,
    (face.match(/<path /g) ?? []).length,
    face.includes(narrationEnabled ? YOU_HOLD_FLOOR : TURNS),
    face.includes(muted ? IN_TEXT : ALOUD),
    face.includes(SPEAKER_BODY),
  ];
})));
JSON.stringify(combinations)
=> [[1,3,true,true,true],[1,3,true,true,true],[1,3,true,true,true],[1,3,true,true,true],[1,3,true,true,true],[1,3,true,true,true],[1,3,true,true,true],[1,3,true,true,true]]
```

The participants are gone from the markup, not merely hidden — no bot rectangle
and no person head at any width.

```ts continue
const diarized = renderFace({ muted: false, narrationEnabled: true, hqInFlight: false, diarizationEnabled: true });
JSON.stringify([diarized.includes("<rect"), diarized.includes('r="2.2"'), diarized.includes('data-voice-diarization="true"')])
=> [false,false,true]
```

The accessible name is where speaker labels went, and it still says both axes in
words.

```ts continue
voiceChipLabel({ muted: true, narrationEnabled: false, hqInFlight: false, diarizationEnabled: true })
=> Voice — taking turns, answers in text, speaker labels on
```
