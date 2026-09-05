# Native companion emissions

The iOS companion sends native composer input into the embedded web chat via a
browser event. The web app must convert that payload into the same `Emission`
shape used by the web composer, so the visible chat session owns the send.

```ts setup
import { nativeEmissionFromDetail, parseNativeEmissionDetail } from "../../src/frontend/src/components/chat/native-emission.js";
```

```ts
const typed = nativeEmissionFromDetail({
  id: "ios-typed-1",
  text: " hello ",
  origin: "typed",
  diarized: false,
  images: [{ id: 1, mimeType: "image/png", dataBase64: "abc" }],
});
JSON.stringify({
  id: typed?.id,
  origin: typed?.origin,
  text: typed?.text,
  imageCount: typed?.images.length,
  files: typed?.files.length,
})
=> {"id":"ios-typed-1","origin":"typed","text":"hello","imageCount":1,"files":0}
```

```ts continue
const voice = nativeEmissionFromDetail({
  id: "ios-voice-1",
  text: " dictated ",
  origin: "voice",
  diarized: true,
  images: [],
});
JSON.stringify({
  id: voice?.id,
  origin: voice?.origin,
  text: voice?.text,
  diarized: voice?.diarized,
})
=> {"id":"ios-voice-1","origin":"voice","text":"dictated","diarized":true}
```

```ts continue
nativeEmissionFromDetail({ text: "   ", images: [] })
=> null
```

V2 carries the complete emission. Unlike legacy payloads, every field and item
is strict so files or selections cannot disappear silently:

```ts continue
const complete = nativeEmissionFromDetail({
  version: 2,
  id: "ios-v2-1",
  origin: "typed",
  text: "See [file2] and [selection3]",
  diarized: false,
  images: [],
  files: [{ id: 2, path: "_tmp/report.pdf", originalName: "report.pdf", size: 42, mimetype: "application/pdf" }],
  selections: [{ id: 3, ref: "/notes/plan.md", text: "the plan", position: "paragraph 2", anchor: null, spokenWords: null }],
});
JSON.stringify({ files: complete?.files, selections: complete?.selections })
=> {"files":[{"id":2,"path":"_tmp/report.pdf","originalName":"report.pdf","size":42,"mimetype":"application/pdf"}],"selections":[{"id":3,"ref":"/notes/plan.md","text":"the plan","position":"paragraph 2","anchor":null,"spokenWords":null}]}
```

HQ provenance from native survives the bridge so chat history can render the
same persistent marker as a web-composer HQ send:

```ts continue
const hqVoice = nativeEmissionFromDetail({
  version: 2,
  id: "ios-hq-1",
  origin: "voice",
  text: "clean transcript",
  diarized: false,
  hqText: true,
  hqService: "whisper",
  images: [],
  files: [],
  selections: [],
});
JSON.stringify({ hqText: hqVoice?.hqText, hqService: hqVoice?.hqService })
=> {"hqText":true,"hqService":"whisper"}
```

Unknown versions and malformed V2 items reject with a receipt-ready reason:

```ts continue
const unknown = parseNativeEmissionDetail({ version: 9, id: "future-1" });
JSON.stringify(unknown.ok ? null : { id: unknown.emissionId, reason: unknown.reason })
=> {"id":"future-1","reason":"Unsupported native emission version: 9"}
```
