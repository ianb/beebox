# Voice chip face

`VoiceChipFace` (`components/chat/VoiceChip.tsx`) is the presentational half of
the app bar's voice chip — renderable standalone, without the `Dropdown` or
router context the full `VoiceChip` needs.

One drawing shares a single bot between two **orthogonal** facts:

- **Who holds the floor** (the arrows) — taking turns, or you narrating while
  the box listens. Podcast, the box holding the floor, is the third value of the
  same axis and is not built.
- **How the box answers** (marks beside the bot) — aloud, or in writing.

Both are shown because neither implies the other: in narration the box is silent
by default but may still speak by exception — when asked, or when the boxholder
is hands-busy (`NARRATION_OVERLAY`) — and answering in text removes that
exception, so a genuine question arrives as a callout instead.

The four marks sat in a 50×16 box at 1:1 until 2026-09-20, which gave each one
about 8px under a 1.3px stroke — legible on a desktop, three unrelated glyphs on
a phone (`issues/bugs/2026-09-15-mobile-app-bar-crowds-place-label.md`). Most of
that width was the space between the marks, not the marks, so closing it and
rendering the 41-unit box at 51px made every mark a quarter bigger and handed
the app bar 7px back. A reduced two-mark face was tried first and rejected:
shrink the spacing before the vocabulary.

This replaced a microphone dimmed to 40% when narration was off. A mic cannot
carry the distinction (voice input uses the mic in both modes), and the deeper
reason is that narration is a *relationship*: it changes what the box does as
much as what you do, and no single-participant picture shows a relationship
(`issues/closed/bugs/2026-08-06-narration-mode-icon-ambiguous-with-mic.md`).

```ts setup
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { VoiceChipFace, voiceChipDiarizationEnabled } from "../../src/frontend/src/components/chat/VoiceChip.js";
import { voiceChipLabel } from "../../src/frontend/src/components/chat/voice-chip-label.js";

globalThis.React = React;

function renderFace(state) {
  return renderToStaticMarkup(React.createElement(VoiceChipFace, state));
}

/** The floor glyph's flow path — the arrow between the two marks. */
const TURNS = "M10 5h6l-2-2M16 11h-6l2 2";
const YOU_HOLD_FLOOR = "M10 8h6m-2.5-2.5 2.5 2.5-2.5 2.5";
/** The speaker segment: sound waves when aloud, written lines when in text. */
const ALOUD = "M31.5 6a3 3 0 0 1 0 4";
const IN_TEXT = "M30 4h10M30 8h7M30 12h10";
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

Written lines, not a slashed speaker: a slash says *suppressed*, and that is not
what happens — the box still answers, in text.

```ts
const face = renderFace({ muted: true, narrationEnabled: false, hqInFlight: false, diarizationEnabled: false });
JSON.stringify([face.includes(IN_TEXT), face.includes(ALOUD), face.includes('data-voice-muted="true"')])
=> [true,false,true]
```

## You hold the floor

```ts
const face = renderFace({ muted: false, narrationEnabled: true, hqInFlight: false, diarizationEnabled: false });
JSON.stringify([face.includes(YOU_HOLD_FLOOR), face.includes(TURNS), face.includes('data-voice-narration="true"')])
=> [true,false,true]
```

## The two axes combine, and the name says both in words

The glyphs carry it with participants, arrows, and output marks; the accessible name says it outright,
because a relationship and a channel do not survive being read as a list of
toggle names.

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

The word is worth about 70px, which at phone width is most of the place label,
so it appears only from `sm:` up. Below that the same fact is a pulse, and the
accessible name says it at every width.

```ts
const face = renderFace({ muted: false, narrationEnabled: false, hqInFlight: true, diarizationEnabled: false });
JSON.stringify([face.includes("transcribing…"), face.includes("hidden sm:inline"), face.includes("sm:hidden")])
=> [true,true,true]
```

Nothing of it survives when no transcription is in flight — neither the word nor
the pulse.

```ts continue
const idle = renderFace({ muted: false, narrationEnabled: false, hqInFlight: false, diarizationEnabled: false });
JSON.stringify([idle.includes("transcribing…"), idle.includes("animate-pulse")])
=> [false,false]
```

```ts continue
voiceChipLabel({ muted: false, narrationEnabled: false, hqInFlight: true, diarizationEnabled: false })
=> Voice — taking turns, answers aloud, transcribing
```

## Diarization changes people, not the floor or answer channel

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

The group works with both arrow states and both channels. Each face still has
exactly one bot and one SVG; only the human head count changes.

```ts
const combinations = [false, true].flatMap(diarizationEnabled => [false, true].flatMap(narrationEnabled => [false, true].map(muted => {
  const face = renderFace({ muted, narrationEnabled, diarizationEnabled, hqInFlight: false });
  return [
    (face.match(/<svg /g) ?? []).length,
    (face.match(/<rect /g) ?? []).length,
    (face.match(/r="2.2"/g) ?? []).length,
    face.includes(narrationEnabled ? YOU_HOLD_FLOOR : TURNS),
    face.includes(muted ? IN_TEXT : ALOUD),
  ];
})));
JSON.stringify(combinations)
=> [[1,1,1,true,true],[1,1,1,true,true],[1,1,1,true,true],[1,1,1,true,true],[1,1,2,true,true],[1,1,2,true,true],[1,1,2,true,true],[1,1,2,true,true]]

voiceChipLabel({ muted: true, narrationEnabled: false, hqInFlight: false, diarizationEnabled: true })
=> Voice — taking turns, answers in text, speaker labels on
```
