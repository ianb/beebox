# SDK content-block conversion (`toSdkUserContent`)

`ChatBackendRun.send()` accepts a loose `ChatContentBlock` whose image `source`
fields are all optional. The Anthropic SDK's `ContentBlockParam` requires a
*complete* image source. `toSdkUserContent` is the single honest narrowing: it
validates every block and throws on an incomplete or unsupported one, so a
malformed image can never reach the SDK subprocess through a silent cast.

```ts setup
import {
  toSdkUserContent,
  isSupportedImageMediaType,
} from "../../src/services/claude-chat-content.js";
import type { ChatContentBlock } from "../../src/services/claude-chat-types.js";
```

## Valid blocks convert 1:1 to SDK shape

A text block passes straight through.

```ts
JSON.stringify(toSdkUserContent([{ type: "text", text: "hello" }]))
=> [{"type":"text","text":"hello"}]
```

A complete base64 image block becomes a strict SDK `Base64ImageSource`.

```ts
const png: ChatContentBlock = {
  type: "image",
  source: { type: "base64", media_type: "image/png", data: "AAAA" },
};
JSON.stringify(toSdkUserContent([png]))
=> [{"type":"image","source":{"type":"base64","media_type":"image/png","data":"AAAA"}}]
```

A URL image block becomes a `URLImageSource`.

```ts
const url: ChatContentBlock = { type: "image", source: { type: "url", url: "https://example.com/a.png" } };
JSON.stringify(toSdkUserContent([url]))
=> [{"type":"image","source":{"type":"url","url":"https://example.com/a.png"}}]
```

## Incomplete or unsupported blocks fail loudly

A base64 source missing `data`:

```ts
toSdkUserContent([{ type: "image", source: { type: "base64", media_type: "image/png" } }])
=> throws ImageBlockMissingBase64DataError
```

A base64 source missing `media_type`:

```ts
toSdkUserContent([{ type: "image", source: { type: "base64", data: "AAAA" } }])
=> throws ImageBlockMissingMediaTypeError
```

A `media_type` the Anthropic API doesn't accept — e.g. AVIF, which the browser
image encoder used to produce for pasted photos (the live bug this boundary now
catches instead of casting through):

```ts
toSdkUserContent([{ type: "image", source: { type: "base64", media_type: "image/avif", data: "AAAA" } }])
=> throws UnsupportedImageMediaTypeError
```

A URL source missing `url`:

```ts
toSdkUserContent([{ type: "image", source: { type: "url" } }])
=> throws ImageBlockMissingUrlError
```

Empty strings are as malformed as missing fields — a `data: ""` or `url: ""`
must not ride a presence-only check through to the SDK:

```ts
toSdkUserContent([{ type: "image", source: { type: "base64", media_type: "image/png", data: "" } }])
=> throws ImageBlockMissingBase64DataError

toSdkUserContent([{ type: "image", source: { type: "url", url: "" } }])
=> throws ImageBlockMissingUrlError
```

## The supported set matches the SDK's `Base64ImageSource.media_type`

```ts
[
  isSupportedImageMediaType("image/jpeg"),
  isSupportedImageMediaType("image/png"),
  isSupportedImageMediaType("image/gif"),
  isSupportedImageMediaType("image/webp"),
  isSupportedImageMediaType("image/avif"),
  isSupportedImageMediaType("image/svg+xml"),
].join(",")
=> true,true,true,true,false,false
```
