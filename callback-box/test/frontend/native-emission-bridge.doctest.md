# Native companion emissions

The iOS companion sends native composer input into the embedded web chat via a
browser event. The web app must convert that payload into the same `Emission`
shape used by the web composer, so the visible chat session owns the send.

```ts setup
import { nativeEmissionFromDetail } from "../../src/frontend/src/components/chat/native-emission.js";
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
