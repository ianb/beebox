# Voice chip face

`VoiceChipFace` (`components/chat/VoiceChip.tsx`) is the presentational half
of the header's voice chip — renderable standalone, without the `Dropdown` or
router context the full `VoiceChip` needs. It's a split pill: a mic icon for
narration (input, dimmed when off) and a speaker icon for mute (output,
slashed when muted), divided by a thin vertical rule, plus a transient
"transcribing…" text label for HQ transcription (the readable text
`NarrationStatusBadge` used to show, preserved by design — see
docs/implemented-plans/chat-header-chips.md). `voiceChipLabel`
(`components/chat/voice-chip-label.ts`) builds the chip's accessible name from
the same three-flag state, independent of React.

```ts setup
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { VoiceChipFace } from "../../src/frontend/src/components/chat/VoiceChip.js";
import { voiceChipLabel } from "../../src/frontend/src/components/chat/voice-chip-label.js";

globalThis.React = React;

function renderFace(state) {
  return renderToStaticMarkup(React.createElement(VoiceChipFace, state));
}
```

## Default state: unmuted, narration off, nothing transcribing

```ts
const face = renderFace({ muted: false, narrationEnabled: false, hqInFlight: false });
face.includes('data-voice-muted="false"')
=> true

face.includes('data-voice-narration="false"')
=> true

// Narration off dims the mic segment — the dimming wrapper directly
// contains the mic SVG (its path starts with the mic-capsule arc), so this
// pins the structure, not just the presence of an opacity class somewhere.
face.includes('<span class="opacity-40"><svg')
=> true

face.includes("M12 15a3 3 0 0 0 3-3V6")
=> true

// The two segments are separated by a thin vertical rule element.
face.includes('<span aria-hidden="true" class="w-px h-4 bg-white/20">')
=> true

// The speaker segment renders the unmuted shape (sound waves), not the
// muted slash.
face.includes("M15.54 8.46a5 5 0 0 1 0 7.07")
=> true

face.includes("transcribing…")
=> false

voiceChipLabel({ muted: false, narrationEnabled: false, hqInFlight: false })
=> Voice
```

## Muted

```ts
const face = renderFace({ muted: true, narrationEnabled: false, hqInFlight: false });
face.includes('data-voice-muted="true"')
=> true

// Muted renders the slashed speaker shape instead of the sound waves.
face.includes("M17 9l4 6m0-6-4 6")
=> true

face.includes("M15.54 8.46a5 5 0 0 1 0 7.07")
=> false

voiceChipLabel({ muted: true, narrationEnabled: false, hqInFlight: false })
=> Voice — muted
```

## Narration on brightens the mic segment (no dimming)

```ts
const face = renderFace({ muted: false, narrationEnabled: true, hqInFlight: false });
face.includes('data-voice-narration="true"')
=> true

// Narration on means the mic is at full brightness, not dimmed — the mic
// SVG is still there, but no longer inside a dimming wrapper.
face.includes("opacity-40")
=> false

face.includes("M12 15a3 3 0 0 0 3-3V6")
=> true

voiceChipLabel({ muted: false, narrationEnabled: true, hqInFlight: false })
=> Voice — narration on
```

## Muted and narration on combine in the accessible name

```ts
voiceChipLabel({ muted: true, narrationEnabled: true, hqInFlight: false })
=> Voice — muted, narration on
```

## HQ transcription in flight shows the readable "transcribing…" label

```ts
const face = renderFace({ muted: false, narrationEnabled: false, hqInFlight: true });
face.includes("transcribing…")
=> true

voiceChipLabel({ muted: false, narrationEnabled: false, hqInFlight: true })
=> Voice — transcribing
```

## Every flag on at once

```ts
const face = renderFace({ muted: true, narrationEnabled: true, hqInFlight: true });
face.includes('data-voice-muted="true"')
=> true

face.includes('data-voice-narration="true"')
=> true

face.includes("transcribing…")
=> true

voiceChipLabel({ muted: true, narrationEnabled: true, hqInFlight: true })
=> Voice — muted, narration on, transcribing
```
