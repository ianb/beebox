# User message display: audio-review overlay badges

`UserMessage` (`components/chat/user-message.tsx`) overlays a retranscription
or audio-consult report onto a user's bubble
(docs/implemented-plans/retranscription-in-chat.md Track 3): the swapped text reaches
`UserMessageText`, the original stays recoverable in the badge's popover
content, and the popover never opens by default — so these tests render the
badge cluster's pure spec-building seam (`buildAudioBadgeSpecs`) directly for
label/popover-content checks, alongside a full `UserMessage` static render
for badge presence and the text swap.

```ts setup
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { UserMessage } from "../../src/frontend/src/components/chat/user-message.js";
import { originalDisplayText } from "../../src/frontend/src/components/chat/user-entry-content.js";
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

function otherUserVoiceEntry(messageId: string, text: string): SessionEntry {
  return {
    uuid: "sdk-uuid-bob",
    type: "user",
    timestamp: "2026-01-01T00:00:00Z",
    user: "Bob",
    userEmail: "bob@example.com",
    content: [{ type: "text", text: `<speech stt="deepgram" message-id="${messageId}">${text}</speech>` }],
  };
}

/** Renders as viewed by a DIFFERENT user (Alice) than the message's sender (Bob). */
function renderAsOtherViewer(entries: SessionEntry[], audioOverlayStore?: ReturnType<typeof createAudioOverlayStore>): string {
  return renderToStaticMarkup(React.createElement(UserMessage, {
    entries, audioOverlayStore, currentUserEmail: "alice@example.com", currentUserName: "Alice",
  }));
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

## Consulted: fixed label; detail carries the question(s) asked

```ts
const consultedSpecs = buildAudioBadgeSpecs({ consulted: { questions: ["did I sound annoyed?"] } }, "irrelevant");
consultedSpecs.map((s) => s.label).join(", ")
=> The agent analyzed this recording

const detailHtml = renderToStaticMarkup(consultedSpecs[0].detail);
print(`heading: ${detailHtml.includes("question asked")}`);
print(`question: ${detailHtml.includes("did I sound annoyed?")}`);
=>
heading: true
question: true

const multi = buildAudioBadgeSpecs({ consulted: { questions: ["q one?", "q two?"] } }, "x");
renderToStaticMarkup(multi[0].detail).includes("questions asked")
=> true
```

## Both present: retranscription badge first, consulted appended after

```ts
const bothSpecs = buildAudioBadgeSpecs(
  { retranscription: { newText: "x", diarized: false }, consulted: { questions: ["did I sound annoyed?"] } },
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
consultedStore.applyConsulted("msg-4", "did I sound annoyed?");
const consultedOut = render([voiceEntry("msg-4", "two large legs")], consultedStore);
consultedOut.includes("two large legs")
=> true

consultedOut.includes('aria-label="The agent analyzed this recording"')
=> true
```

## Fix (cross-model review): another user's bubble ALSO overlays — not just the sender's own

In a shared session, Bob's retranscribed message must update on a different
viewer's (Alice's) screen too — the overlay isn't scoped to who's looking.

```ts
const otherStore = createAudioOverlayStore();
otherStore.applyRetranscription("msg-bob-1", { newText: "corrected bob text", service: "deepgram-hq", diarized: false });
const otherOut = renderAsOtherViewer([otherUserVoiceEntry("msg-bob-1", "original bob text")], otherStore);
otherOut.includes("corrected bob text")
=> true

otherOut.includes("original bob text")
=> false

otherOut.includes('aria-label="Retranscribed — deepgram-hq"')
=> true
```

## Fix (cross-model review): another user's bubble also shows the consulted badge

```ts
const otherConsultedStore = createAudioOverlayStore();
otherConsultedStore.applyConsulted("msg-bob-2", "was that sarcasm?");
const otherConsultedOut = renderAsOtherViewer([otherUserVoiceEntry("msg-bob-2", "bob asked something")], otherConsultedStore);
otherConsultedOut.includes("bob asked something")
=> true

otherConsultedOut.includes('aria-label="The agent analyzed this recording"')
=> true
```

## Fix (P4): `originalDisplayText` unwraps `<unsure>` marks to plain words

`originalDisplayText` (`user-entry-content.tsx`) feeds the popover's
"realtime transcript" body — it must read as clean text, not leak the
agent-facing `<unsure>` tag the normal bubble path styles instead (same
unwrap `stripSpeechWrappers` does backend-side).

```ts
const unsureEntry: SessionEntry = {
  uuid: "sdk-uuid-unsure",
  type: "user",
  timestamp: "2026-01-01T00:00:00Z",
  content: [{ type: "text", text: '<speech stt="deepgram" message-id="msg-5">they\'re all <unsure>cloud</unsure> code in different ways</speech>' }],
};
originalDisplayText(unsureEntry)
=> they're all cloud code in different ways
```

The popover content itself renders the clean, unwrapped text — never the raw tag:

```ts continue
const unsureSpecs = buildAudioBadgeSpecs(
  { retranscription: { newText: "two large eggs", service: "deepgram-hq", diarized: false } },
  originalDisplayText(unsureEntry),
);
const unsurePopover = renderToStaticMarkup(unsureSpecs[0].detail);
// React-escapes the apostrophe in static markup, so match the unwrapped
// word's surroundings rather than the raw contraction.
unsurePopover.includes("all cloud code in different ways")
=> true

unsurePopover.includes("<unsure")
=> false

unsurePopover.includes("</unsure>")
=> false
```
