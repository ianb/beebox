# Emission assembly — the pinned wire format for every send site

`assembleChatMessage` is the one place an Emission becomes a chat payload
(docs/plans/input-extraction.md, chunk 1). These examples pin the exact
historical output of each of the five send sites it replaces — the
refactor's zero-behavior-change guarantee is these strings.

```ts setup
import { assembleChatMessage } from "../../src/frontend/src/input/targets/chat-assemble.js";
import { createTypedEmission, createVoiceEmission } from "../../src/frontend/src/input/emission.js";
import { buildSpeechMessage } from "../../src/frontend/src/components/chat/InteractiveChat-helpers.js";

const W = { localTime: "14:23", zoomedView: null, timePassed: null };
```

## Site 1 — typed send: plain text

Historical builder: `handleSend` (`InteractiveChat-actions.ts`).

```ts
const e = createTypedEmission({ text: "hello there", images: [], files: [], selections: [] });
const out = assembleChatMessage(e, W);
out.message
=> <typed local-time="14:23">hello there</typed>

out.messageId === e.id
=> true

out.images.length
=> 0
```

## Site 1 — typed send: selections fold, files block, images ride

```ts
const e = createTypedEmission({
  text: "compare [selection1] with the doc",
  images: [{ id: 1, mimeType: "image/png", dataBase64: "aGk=" }],
  files: [{ id: 1, path: "tmp/2026-07-04T01-00-00_report.pdf" }, { id: 2, path: "tmp/2026-07-04T01-00-01_notes.txt" }],
  selections: [{ id: 1, ref: "/store/notes/Bread.doc.card", text: "let it rise", position: "body; heading: Proofing (#proofing)" }],
});
const out = assembleChatMessage(e, W);
JSON.stringify(out.message)
=> "<typed local-time=\"14:23\">compare <user-selection ref=\"/store/notes/Bread.doc.card\" pos=\"body; heading: Proofing (#proofing)\">let it rise</user-selection> with the doc</typed>\n<attachments>\n[file1]: tmp/2026-07-04T01-00-00_report.pdf\n[file2]: tmp/2026-07-04T01-00-01_notes.txt\n</attachments>"

out.images[0]?.mimeType
=> image/png
```

## Witness attributes: order is local-time, zoomed-view, time-passed

Historical order from `handleSend`'s template
(`<typed local-time=…${zoomedViewAttr()}${timePassedAttr()}>`).

```ts
const e = createTypedEmission({ text: "hi", images: [], files: [], selections: [] });
assembleChatMessage(e, { localTime: "09:05", zoomedView: "view:store/notes/Foo.md?view=markdown", timePassed: "2d4h" }).message
=> <typed local-time="09:05" zoomed-view="view:store/notes/Foo.md?view=markdown" time-passed="2d4h">hi</typed>
```

## Site 2 — keyword voice send: diarized attr leads, selections append

Historical builder: `runKeywordSend` → `buildSpeechMessage`
(`InteractiveChat-voice.ts` / `InteractiveChat-helpers.ts`). The diarized
attribute comes BEFORE local-time — pinned. Spoken text carries no
tokens, so selections append.

```ts
const sel = [{ id: 2, ref: "/store/recipes/Bread.recipe.card", text: "300g flour", position: "body" }];
const e = createVoiceEmission({ text: "add that to the list", selections: sel, diarized: true });
const out = assembleChatMessage(e, W);
JSON.stringify(out.message)
=> "<speech diarized=\"1\" local-time=\"14:23\">add that to the list\n<user-selection ref=\"/store/recipes/Bread.recipe.card\" pos=\"body\">300g flour</user-selection></speech>"
```

Equivalence with the historical helper (same inputs → same bytes), while
it still exists:

```ts continue
const legacy = buildSpeechMessage({ text: "add that to the list", diarized: true, selections: sel, attrs: " local-time=\"14:23\"" });
out.message === legacy
=> true
```

## Sites 3+4 — desktop/mobile stop-and-send: raw speech, no folding

Historical builders hand-built
`<speech local-time="…"…>${text}</speech>` with NO selection folding
(`InteractiveChat-composer.tsx`, `InteractiveChat-mobile-row.tsx`) —
reproduced by an emission with empty selections (identity fold). Aligning
these paths to fold selections is a named chunk-5 decision, not part of
this refactor.

```ts
const e = createVoiceEmission({ text: "quick thought before I go", selections: [], diarized: false });
assembleChatMessage(e, { localTime: "23:59", zoomedView: null, timePassed: "8h" }).message
=> <speech local-time="23:59" time-passed="8h">quick thought before I go</speech>
```

## Site 5 — recovered dictation: same shape as stop-and-send

Historical builder: `handleRecoverSend`
(`InteractiveChat.tsx`) — `buildSpeechMessage` with `selections: []`,
`diarized: false`.

```ts
const e = createVoiceEmission({ text: "the text that survived the drop", selections: [], diarized: false });
assembleChatMessage(e, W).message
=> <speech local-time="14:23">the text that survived the drop</speech>
```

## Emission ids are distinct per creation (the dedup key)

```ts
const a = createTypedEmission({ text: "x", images: [], files: [], selections: [] });
const b = createTypedEmission({ text: "x", images: [], files: [], selections: [] });
a.id !== b.id && a.id.startsWith("msg-")
=> true
```
