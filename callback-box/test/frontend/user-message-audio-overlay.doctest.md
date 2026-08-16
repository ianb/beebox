# User message display: audio-review overlay badges

`UserMessage` (`components/chat/user-message.tsx`) overlays a retranscription
or audio-consult report onto a user's bubble
(docs/plans/retranscription-in-chat.md Track 3): the swapped text reaches
`UserMessageText`, the original stays recoverable in the badge's popover
content, and the popover never opens by default — so these tests render the
badge cluster's pure spec-building seam (`buildAudioBadgeSpecs`) directly for
label/popover-content checks, alongside a full `UserMessage` static render
for badge presence and the text swap.

```ts setup
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { UserMessage } from "../../src/frontend/src/components/chat/user-message.js";
import { buildAudioBadgeSpecs } from "../../src/frontend/src/components/chat/audio-overlay-badge.js";
import { createAudioOverlayStore } from "../../src/frontend/src/components/chat/audio-overlay-store.js";
import type { SessionEntry } from "../../src/frontend/src/api.js";

globalThis.React = React;

function voiceEntry(messageId: string, text: string): SessionEntry {
  return {
    uuid: "sdk-uuid-1",
    type: "user",
    timestamp: "2026-01-01T00:00:00Z",
    content: [{ type: "text", text: `<speech stt="deepgram" message-id="${messageId}">${text}</speech>` }],
  };
}

function render(entries: SessionEntry[], audioOverlayStore?: ReturnType<typeof createAudioOverlayStore>): string {
  return renderToStaticMarkup(React.createElement(UserMessage, { entries, audioOverlayStore }));
}
```

## Retranscription: label includes the resolved service

```ts
const specs = buildAudioBadgeSpecs(
  { retranscription: { newText: "two large eggs", service: "deepgram-hq", diarized: false } },
  "two large legs",
);
specs.map((s) => s.label).join(", ")
=> Retranscribed — deepgram-hq
```

## Retranscription popover content: the ORIGINAL bubble text, never the overlay

Chained (`continue`) onto the previous block so `specs` is still in scope.

```ts continue
const popover = renderToStaticMarkup(specs[0].detail);
popover.includes("two large legs")
=> true

popover.includes("two large eggs")
=> false

popover.includes("realtime transcript")
=> true
```

## Retranscription: no service known → label omits the placeholder

```ts
const noServiceSpecs = buildAudioBadgeSpecs(
  { retranscription: { newText: "two large eggs", diarized: false } },
  "two large legs",
);
noServiceSpecs.map((s) => s.label).join(", ")
=> Retranscribed
```

## Consulted: fixed label, no detail body

```ts
const consultedSpecs = buildAudioBadgeSpecs({ consulted: true }, "irrelevant");
consultedSpecs.map((s) => s.label).join(", ")
=> The agent analyzed this recording

consultedSpecs[0].detail
=> null
```

## Both present: retranscription badge first, consulted appended after

```ts
const bothSpecs = buildAudioBadgeSpecs(
  { retranscription: { newText: "x", diarized: false }, consulted: true },
  "y",
);
bothSpecs.map((s) => s.kind).join(", ")
=> retranscribed, consulted
```

## Full render: no overlay store → no badge, original text shown

```ts
const plainOut = render([voiceEntry("msg-1", "two large legs")]);
plainOut.includes("two large legs")
=> true

plainOut.includes("aria-haspopup")
=> false
```

## Full render: a matching retranscription swaps the displayed text and shows a badge

```ts
const store = createAudioOverlayStore();
store.applyRetranscription("msg-2", { newText: "two large eggs", service: "deepgram-hq", diarized: false });
const swappedOut = render([voiceEntry("msg-2", "two large legs")], store);
swappedOut.includes("two large eggs")
=> true

swappedOut.includes('aria-label="Retranscribed — deepgram-hq"')
=> true
```

## Full render: no matching overlay entry for this message → original text, no badge

An overlay for a DIFFERENT message id sitting in the same store must not
leak onto an unrelated bubble.

```ts
const otherStore = createAudioOverlayStore();
otherStore.applyRetranscription("msg-other", { newText: "not this bubble", diarized: false });
const untouchedOut = render([voiceEntry("msg-3", "two large legs")], otherStore);
untouchedOut.includes("two large legs")
=> true

untouchedOut.includes("not this bubble")
=> false

untouchedOut.includes("aria-haspopup")
=> false
```

## Full render: consulted-only overlay → badge present, text unchanged

```ts
const consultedStore = createAudioOverlayStore();
consultedStore.applyConsulted("msg-4");
const consultedOut = render([voiceEntry("msg-4", "two large legs")], consultedStore);
consultedOut.includes("two large legs")
=> true

consultedOut.includes('aria-label="The agent analyzed this recording"')
=> true
```
