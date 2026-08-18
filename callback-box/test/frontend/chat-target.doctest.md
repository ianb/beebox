# ChatTarget — status mapping + restore planning

`chatTargetStatus` (docs/plans/input-extraction.md, chunk 3) maps the chat
machine's busy signals onto the target's status vocabulary; `planRestore`
is the pure half of what happens when a dispatched emission comes back
`rejected` — putting it back into the composer rather than losing it to
the error banner. Both are framework-free (no React/DOM), so they're
doctestable headlessly; `applyRestorePlan` runs against a real (also
framework-free) emission store below; `acceptEmission` threads a `send`
function and is covered by typecheck + manual verification instead.

```ts setup
import { chatTargetStatus, planRestore, applyRestorePlan } from "../../src/frontend/src/input/targets/chat-target.js";
import { createTypedEmission, createVoiceEmission } from "../../src/frontend/src/input/emission.js";
import { createEmissionStore } from "../../src/frontend/src/input/emission-store.js";

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

## planRestore: keyword control tags never reach the composer

A rejected voice-keyword send carries its control tag in the emission text
(`<send-message phrase="..." />` and friends). The tag is a marker for the
persisted message record, not composer content, so the restore strips it —
every action's tag, which is also what keeps this pattern in sync with
`ACTION_TAG_NAMES` in `speech-keywords.ts`.

```ts continue
const tagged = createVoiceEmission({
  text: 'remember the milk <send-message phrase="Send message" />',
  selections: [],
  diarized: false,
});
planRestore(emptyDraft, tagged).text
=> remember the milk

const allTags = [
  '<send-message phrase="Send message" />',
  '<send-close-message phrase="Send and close" />',
  '<cancel-message phrase="Cancel message" />',
  '<mic-off phrase="Microphone off" />',
  '<erase-message phrase="Clear &quot;this&quot; message" />',
].join(" ");
const swept = createVoiceEmission({ text: `keep this ${allTags}`, selections: [], diarized: false });
planRestore(emptyDraft, swept).text
=> keep this
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

## applyRestorePlan: restored ids are reserved, so new items can't collide

The send that got rejected already `reset()` the store, dropping the id
counters back to 1. The restored items keep their original ids (the text
still carries the matching tokens), so the counters must advance past
them — otherwise the next pasted image would mint a duplicate `[image1]`.

```ts
const store = createEmissionStore();
store.editor.setText("was typing"); // simulates typing after the failed send
const failed = createTypedEmission({
  text: "see [image1] and [image2]",
  images: [
    { id: 1, mimeType: "image/png", dataBase64: "aGk=" },
    { id: 2, mimeType: "image/png", dataBase64: "aG8=" },
  ],
  files: [{ id: 1, path: "tmp/report.pdf" }],
  selections: [{ id: 3, ref: "/x.card", text: "t", position: "body", anchor: null, spokenWords: null }],
});
applyRestorePlan(store.editor, planRestore(store.get(), failed));
store.get().text
=> was typing
see [image1] and [image2]

store.get().images.map((i) => i.id).join(",")
=> 1,2

// Fresh ids start past the restored ones — no [image1]/[file1]/[selection3] duplicates.
[store.editor.nextImageId(), store.editor.nextFileId(), store.editor.nextSelectionId()].join(",")
=> 3,2,4
```
