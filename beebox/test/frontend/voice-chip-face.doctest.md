# Voice chip face

`VoiceChipFace` (`components/chat/VoiceChip.tsx`) is the presentational half of
the app bar's voice chip — renderable standalone, without the `Dropdown` or
router context the full `VoiceChip` needs.

It is a split pill carrying two **orthogonal** facts:

- **Who holds the floor** (`FloorIcon`) — taking turns, or you narrating while
  the box listens. Podcast, the box holding the floor, is the third value of the
  same axis and is not built.
- **How the box answers** (`SpeakerIcon`) — aloud, or in writing.

Both are shown because neither implies the other: in narration the box is silent
by default but may still speak by exception — when asked, or when the boxholder
is hands-busy (`NARRATION_OVERLAY`) — and answering in text removes that
exception, so a genuine question arrives as a callout instead.

This replaced a microphone dimmed to 40% when narration was off. A mic cannot
carry the distinction (voice input uses the mic in both modes), and the deeper
reason is that narration is a *relationship*: it changes what the box does as
much as what you do, and no single-participant picture shows a relationship
(`issues/bugs/2026-08-06-narration-mode-icon-ambiguous-with-mic.md`).

```ts setup
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { VoiceChipFace } from "../../src/frontend/src/components/chat/VoiceChip.js";
import { voiceChipLabel } from "../../src/frontend/src/components/chat/voice-chip-label.js";

globalThis.React = React;

function renderFace(state) {
  return renderToStaticMarkup(React.createElement(VoiceChipFace, state));
}

/** The floor glyph's flow path — the arrow between the two marks. */
const TURNS = "M9 9.5 7.5 12 9 14.5M15 9.5l1.5 2.5L15 14.5M8 12h8";
const YOU_HOLD_FLOOR = "M8 12h7m-2.5-2.5L15 12l-2.5 2.5";
/** The speaker segment: sound waves when aloud, written lines when in text. */
const ALOUD = "M15.54 8.46a5 5 0 0 1 0 7.07";
const IN_TEXT = "M5 5h14M5 9.5h14M5 14h9M5 18.5h6";
```

## Taking turns, answering aloud

```ts
const face = renderFace({ muted: false, narrationEnabled: false, hqInFlight: false });
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
const face = renderFace({ muted: true, narrationEnabled: false, hqInFlight: false });
JSON.stringify([face.includes(IN_TEXT), face.includes(ALOUD), face.includes('data-voice-muted="true"')])
=> [true,false,true]
```

## You hold the floor

```ts
const face = renderFace({ muted: false, narrationEnabled: true, hqInFlight: false });
JSON.stringify([face.includes(YOU_HOLD_FLOOR), face.includes(TURNS), face.includes('data-voice-narration="true"')])
=> [true,false,true]
```

## The two axes combine, and the name says both in words

The glyphs carry it by weight and shape; the accessible name says it outright,
because a relationship and a channel do not survive being read as a list of
toggle names.

```ts
JSON.stringify([
  voiceChipLabel({ muted: false, narrationEnabled: false, hqInFlight: false }),
  voiceChipLabel({ muted: true, narrationEnabled: false, hqInFlight: false }),
  voiceChipLabel({ muted: false, narrationEnabled: true, hqInFlight: false }),
  voiceChipLabel({ muted: true, narrationEnabled: true, hqInFlight: false }),
])
=> ["Voice — taking turns, answers aloud","Voice — taking turns, answers in text","Voice — you are narrating, it listens, answers aloud","Voice — you are narrating, it listens, answers in text"]
```

## HQ transcription in flight keeps its readable label

```ts
const face = renderFace({ muted: false, narrationEnabled: false, hqInFlight: true });
face.includes("transcribing…")
=> true

voiceChipLabel({ muted: false, narrationEnabled: false, hqInFlight: true })
=> Voice — taking turns, answers aloud, transcribing
```
