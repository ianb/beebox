# A typed send keeps its captured conversation through upload waits

The real typed-submit coordinator captures before awaiting uploads and clears
only after a durable dispatch. The injected dispatcher represents the pinned
controller handle; its destination is chosen at capture, not at receipt time.

```ts setup
import { submitTypedDraft } from "../../../src/frontend/src/components/chat/conversation/typed-submit.js";
import { createEmissionStore } from "../../../src/frontend/src/input/emission-store.js";
import { boundTurnFields } from "../../../src/frontend/src/machines/chat-bound-turn.js";
```

## Navigate while uploading, then type a new draft before the late receipt

```ts
const store = createEmissionStore();
store.editor.setText("Compare this quote");
let selected = "kitchen";
let releaseUpload = () => {};
const uploads = new Promise<void>((resolve) => { releaseUpload = resolve; });
let destination = "";
let committedText = "";
let releaseReceipt = () => {};
const receipt = new Promise((resolve) => { releaseReceipt = () => resolve({ disposition: "sent", emissionId: "m", deduplicated: false }); });
const work = submitTypedDraft({
  emissionStore: store,
  capture: () => {
    const captured = selected;
    return Object.assign((emission) => {
      destination = captured;
      committedText = emission.text;
      return receipt;
    }, { stage() {}, release() {} });
  },
  awaitUploads: () => uploads,
  onCommitted: () => store.editor.setText(""),
  onReceipt() {},
});
selected = "garden";
store.editor.setText("Compare this quote and its warranty");
releaseUpload();
await work;
store.editor.setText("A new garden question");
releaseReceipt();
await receipt;
JSON.stringify({ destination, committedText, draft: store.get().text })
=> {"destination":"kitchen","committedText":"Compare this quote and its warranty","draft":"A new garden question"}
```

## Storage refusal preserves the whole draft and releases the pinned controller

```ts
const store = createEmissionStore();
store.editor.setText("Keep this text");
let released = false;
let cleared = false;
const reason = await submitTypedDraft({
    emissionStore: store,
    capture: () => Object.assign(() => { throw new DOMException("Full", "QuotaExceededError"); }, {
      stage() {}, release() { released = true; },
    }),
    awaitUploads: async () => {},
    onCommitted() { cleared = true; },
    onReceipt() {},
  }).then(() => "", (error) => error.name);
JSON.stringify({ draft: store.get().text, released, cleared, reason })
=> {"draft":"Keep this text","released":true,"cleared":false,"reason":"QuotaExceededError"}
```

## Both HTTP paths use the immutable destination and independent attention

The same projection is applied last by the streaming and queued POST sites.
Existing targets request exact delivery; fresh Codex targets retain their
engine and directory without pretending they have a reserved ID.

```ts
const attention = { surface: "card", transcript: "hidden", focusedRef: "/house/report.memo.card" };
JSON.stringify(boundTurnFields({ boxSlug: "test1", target: { kind: "session", sessionId: "kitchen", contextDir: "kitchen" }, attention }))
=> {"session":"kitchen","exactSession":true,"viewContext":{"surface":"card","transcript":"hidden","focusedRef":"/house/report.memo.card"}}

JSON.stringify(boundTurnFields({ boxSlug: "test1", target: { kind: "start", clientConversationId: "client-start", contextDir: "garden", engine: "codex", model: "model-test" }, attention }))
=> {"session":"new","exactSession":false,"contextDir":"garden","engine":"codex","model":"model-test","viewContext":{"surface":"card","transcript":"hidden","focusedRef":"/house/report.memo.card"}}
```

## Voice capture refusal preserves the utterance and settles the mic path

```ts setup
import { captureVoiceSend } from "../../../src/frontend/src/components/chat/conversation/capture-voice-send.js";
```

```ts
const store = createEmissionStore();
store.editor.setText("Earlier draft");
let micSettled = false;
const captured = await captureVoiceSend({
  capture: () => { throw new DOMException("Conversation is resolving", "InvalidStateError"); },
  awaitUploads: async () => {}, readDraft: store.get,
  preserve: () => store.editor.setText(`${store.get().text} spoken utterance`),
  refused() { micSettled = true; },
});
JSON.stringify({ captured, text: store.get().text, micSettled })
=> {"captured":null,"text":"Earlier draft spoken utterance","micSettled":true}
```

## An upload failure releases the voice capture before keeping its text

```ts
const store = createEmissionStore();
let released = false;
let refused = false;
const captured = await captureVoiceSend({
  capture: () => Object.assign(async () => ({ disposition: "sent", emissionId: "m", deduplicated: false }), {
    stage() {}, release() { released = true; },
  }),
  awaitUploads: async () => { throw new DOMException("Upload failed", "NetworkError"); },
  readDraft: store.get,
  preserve: () => store.editor.setText("Spoken text"),
  refused() { refused = true; },
});
JSON.stringify({ captured, text: store.get().text, released, refused })
=> {"captured":null,"text":"Spoken text","released":true,"refused":true}
```
