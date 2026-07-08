# Native companion emissions

The iOS companion sends native composer input into the embedded web chat via a
browser event. The web app must convert that payload into the same `Emission`
shape used by the web composer, so the visible chat session owns the send.

```ts setup
import { nativeEmissionFromDetail } from "../../src/frontend/src/components/chat/native-emission.js";
```

```ts
const typed = nativeEmissionFromDetail({
  text: " hello ",
  origin: "typed",
  diarized: false,
  images: [{ id: 1, mimeType: "image/png", dataBase64: "abc" }],
});
JSON.stringify({
  origin: typed?.origin,
  text: typed?.text,
  imageCount: typed?.images.length,
  files: typed?.files.length,
})
=> {"origin":"typed","text":"hello","imageCount":1,"files":0}
```

```ts continue
const voice = nativeEmissionFromDetail({
  text: " dictated ",
  origin: "voice",
  diarized: true,
  images: [],
});
JSON.stringify({
  origin: voice?.origin,
  text: voice?.text,
  diarized: voice?.diarized,
})
=> {"origin":"voice","text":"dictated","diarized":true}
```

```ts continue
nativeEmissionFromDetail({ text: "   ", images: [] })
=> null
```
