# Voice chip face

`VoiceChipFace` (`components/chat/VoiceChip.tsx`) is the presentational half
of the header's voice chip — renderable standalone, without the `Dropdown` or
router context the full `VoiceChip` needs. It shows mute state via the
speaker icon, narration via a corner indicator dot, and HQ transcription via a
transient "transcribing…" text label (the readable text
`NarrationStatusBadge` used to show, preserved by design — see
docs/plans/chat-header-chips.md). `voiceChipLabel`
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

voiceChipLabel({ muted: true, narrationEnabled: false, hqInFlight: false })
=> Voice — muted
```

## Narration on shows a corner indicator dot

```ts
const face = renderFace({ muted: false, narrationEnabled: true, hqInFlight: false });
face.includes('data-voice-narration="true"')
=> true

// The corner dot is a small rounded span rendered only when narration is on.
face.includes("rounded-full")
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
