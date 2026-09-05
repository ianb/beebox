# Multipart form builder

`buildMultipartForm` is the shared multipart/form-data body builder
extracted from the Whisper and Voxtral transcription clients — both had
hand-rolled byte-identical boundary/part framing. Pure: given an ordered
list of parts, it returns the body bytes and the boundary to put in the
request's `Content-Type` header.

```ts setup
import { buildMultipartForm } from "../../src/lib/multipart.js";
```

## File part + field part, in order

```ts
const { body, boundary } = buildMultipartForm([
  {
    kind: "file",
    file: { name: "file", filename: "clip.webm", contentType: "audio/webm", data: Buffer.from("AUDIO") },
  },
  { kind: "field", field: { name: "model", value: "whisper-1" } },
]);
const expected =
  `--${boundary}\r\n` +
  `Content-Disposition: form-data; name="file"; filename="clip.webm"\r\n` +
  `Content-Type: audio/webm\r\n\r\n` +
  `AUDIO\r\n` +
  `--${boundary}\r\n` +
  `Content-Disposition: form-data; name="model"\r\n\r\n` +
  `whisper-1\r\n` +
  `--${boundary}--\r\n`;
body.toString("utf-8") === expected
=> true
```

Boundary is a fresh random token each call, prefixed `----FormBoundary`:

```ts continue
/^----FormBoundary[0-9a-z]+$/.test(boundary)
=> true

const second = buildMultipartForm([]);
second.boundary === boundary
=> false
```

## No parts — just the closing boundary

```ts
const empty = buildMultipartForm([]);
empty.body.toString("utf-8") === `--${empty.boundary}--\r\n`
=> true
```

## Field-only parts (no file) preserve given order

```ts
const { body: fieldsBody, boundary: fieldsBoundary } = buildMultipartForm([
  { kind: "field", field: { name: "a", value: "1" } },
  { kind: "field", field: { name: "b", value: "2" } },
]);
const fieldsExpected =
  `--${fieldsBoundary}\r\n` +
  `Content-Disposition: form-data; name="a"\r\n\r\n` +
  `1\r\n` +
  `--${fieldsBoundary}\r\n` +
  `Content-Disposition: form-data; name="b"\r\n\r\n` +
  `2\r\n` +
  `--${fieldsBoundary}--\r\n`;
fieldsBody.toString("utf-8") === fieldsExpected
=> true
```
