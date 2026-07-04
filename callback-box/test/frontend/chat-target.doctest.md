# ChatTarget — status mapping + restore planning

`chatTargetStatus` (docs/plans/input-extraction.md, chunk 3) maps the chat
machine's busy signals onto the target's status vocabulary; `planRestore`
is the pure half of what happens when a dispatched emission comes back
`rejected` — putting it back into the composer rather than losing it to
the error banner. Both are framework-free (no React/DOM), so they're
doctestable headlessly; `acceptEmission`/`applyRestorePlan` thread a `send`
function and a live `EmissionEditor` respectively and are covered by
typecheck + manual verification instead.

```ts setup
import { chatTargetStatus, planRestore } from "../../src/frontend/src/input/targets/chat-target.js";
import { createTypedEmission, createVoiceEmission } from "../../src/frontend/src/input/emission.js";

const emptyDraft = { text: "", images: [], pendingImages: 0, files: [], selections: [] };
```

## chatTargetStatus: idle -> ready, streaming or backend-busy -> busy

```ts
JSON.stringify(chatTargetStatus({ isStreaming: false, processBusy: false }))
=> {"state":"ready"}

JSON.stringify(chatTargetStatus({ isStreaming: true, processBusy: false }))
=> {"state":"busy","disposition":"will-queue"}

JSON.stringify(chatTargetStatus({ isStreaming: false, processBusy: true }))
=> {"state":"busy","disposition":"will-queue"}

JSON.stringify(chatTargetStatus({ isStreaming: true, processBusy: true }))
=> {"state":"busy","disposition":"will-queue"}
```

Note: `unavailable` is part of the wider Target vocabulary but chat has no
session-gone state that produces it today, so `chatTargetStatus` never
returns it — there's no example for it here on purpose.

## planRestore: empty composer gets the rejected emission back verbatim

The emission's text already carries its `[imageN]`/`[fileN]`/`[selectionN]`
tokens, so an empty composer's restore is just "put the text back" — no
re-insertion.

```ts
const e = createTypedEmission({
  text: "look at [image1]",
  images: [{ id: 1, mimeType: "image/png", dataBase64: "aGk=" }],
  files: [],
  selections: [],
});
const plan = planRestore(emptyDraft, e);
plan.text
=> look at [image1]

plan.images.length
=> 1
```

## planRestore: text already typed appends after a newline instead of clobbering it

```ts
const typedOverDraft = { ...emptyDraft, text: "meanwhile" };
const voice = createVoiceEmission({ text: "add milk to the list", selections: [], diarized: false });
const plan2 = planRestore(typedOverDraft, voice);
plan2.text
=> meanwhile
add milk to the list
```

## planRestore: attachments/selections always re-added regardless of composer text

```ts continue
const sel = [{ id: 1, ref: "/store/notes/Bread.doc.card", text: "let it rise", position: "body" }];
const e2 = createTypedEmission({ text: "note: [selection1]", images: [], files: [{ id: 1, path: "tmp/report.pdf" }], selections: sel });
const plan3 = planRestore(typedOverDraft, e2);
plan3.files.length
=> 1

plan3.selections.length
=> 1
```
