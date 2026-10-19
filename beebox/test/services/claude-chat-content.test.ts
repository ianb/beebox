// # SDK content-block conversion (`toSdkUserContent`)
//
// `ChatBackendRun.send()` accepts a loose `ChatContentBlock` whose image `source`
// fields are all optional. The Anthropic SDK's `ContentBlockParam` requires a
// *complete* image source. `toSdkUserContent` is the single honest narrowing: it
// validates every block and throws on an incomplete or unsupported one, so a
// malformed image can never reach the SDK subprocess through a silent cast.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import {
  toSdkUserContent,
  isSupportedImageMediaType,
} from "../../src/services/claude-chat-content.js";
import type { ChatContentBlock } from "../../src/services/claude-chat-types.js";

// ## Valid blocks convert 1:1 to SDK shape
//
// A text block passes straight through.
void test("A text block passes straight through.", async (t) => {
  t.check(toSdkUserContent([{ type: "text", text: "hello" }]), [
    {
      type: "text",
      text: "hello",
    },
  ]);
});

// A complete base64 image block becomes a strict SDK `Base64ImageSource`.
void test("A complete base64 image block becomes a strict SDK Base64ImageSource.", async (t) => {
  const png: ChatContentBlock = {
    type: "image",
    source: { type: "base64", media_type: "image/png", data: "AAAA" },
  };
  t.check(toSdkUserContent([png]), [
    {
      type: "image",
      source: {
        type: "base64",
        media_type: "image/png",
        data: "AAAA",
      },
    },
  ]);
});

// A URL image block becomes a `URLImageSource`.
void test("A URL image block becomes a URLImageSource.", async (t) => {
  const url: ChatContentBlock = { type: "image", source: { type: "url", url: "https://example.com/a.png" } };
  t.check(toSdkUserContent([url]), [
    {
      type: "image",
      source: {
        type: "url",
        url: "https://example.com/a.png",
      },
    },
  ]);
});

// ## Incomplete or unsupported blocks fail loudly
//
// A base64 source missing `data`:
void test("A base64 source missing data:", async (t) => {
  await t.checkThrows(async () => (toSdkUserContent([{ type: "image", source: { type: "base64", media_type: "image/png" } }])), "ImageBlockMissingBase64DataError");
});

// A base64 source missing `media_type`:
void test("A base64 source missing mediatype:", async (t) => {
  await t.checkThrows(async () => (toSdkUserContent([{ type: "image", source: { type: "base64", data: "AAAA" } }])), "ImageBlockMissingMediaTypeError");
});

// A `media_type` the Anthropic API doesn't accept — e.g. AVIF, which the browser
// image encoder used to produce for pasted photos (the live bug this boundary now
// catches instead of casting through):
void test("A mediatype the Anthropic API doesn't accept — e.g.", async (t) => {
  await t.checkThrows(async () => (toSdkUserContent([{ type: "image", source: { type: "base64", media_type: "image/avif", data: "AAAA" } }])), "UnsupportedImageMediaTypeError");
});

// A URL source missing `url`:
void test("A URL source missing url:", async (t) => {
  await t.checkThrows(async () => (toSdkUserContent([{ type: "image", source: { type: "url" } }])), "ImageBlockMissingUrlError");
});

// Empty strings are as malformed as missing fields — a `data: ""` or `url: ""`
// must not ride a presence-only check through to the SDK:
void test("Empty strings are as malformed as missing fields — a data:", async (t) => {
  await t.checkThrows(async () => (toSdkUserContent([{ type: "image", source: { type: "base64", media_type: "image/png", data: "" } }])), "ImageBlockMissingBase64DataError");

  await t.checkThrows(async () => (toSdkUserContent([{ type: "image", source: { type: "url", url: "" } }])), "ImageBlockMissingUrlError");
});

// ## The supported set matches the SDK's `Base64ImageSource.media_type`
void test("The supported set matches the SDK's `Base64ImageSource.media_type`", async (t) => {
  t.check(
    [
      isSupportedImageMediaType("image/jpeg"),
      isSupportedImageMediaType("image/png"),
      isSupportedImageMediaType("image/gif"),
      isSupportedImageMediaType("image/webp"),
      isSupportedImageMediaType("image/avif"),
      isSupportedImageMediaType("image/svg+xml"),
    ].join(","),
    "true,true,true,true,false,false",
  );
});
