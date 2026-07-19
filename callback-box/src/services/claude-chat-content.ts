/**
 * SDK send-boundary conversion for chat content blocks.
 *
 * `ChatContentBlock` (the type `ChatBackendRun.send()` accepts) is intentionally
 * looser than the Anthropic SDK's `ContentBlockParam`: an image block's `source`
 * fields (`media_type`, `data`, `url`) are all optional, because the same shape
 * doubles as the frontend compose / wire type where a block can be half-built.
 * The SDK, by contrast, requires a *complete* image source — base64 `data` plus
 * one of exactly four `media_type`s, or a `url`.
 *
 * This module is the single honest narrowing from the loose type to the strict
 * one. It validates every block and throws a {@link MalformedChatContentBlockError}
 * subclass on an incomplete or unsupported one, so a malformed image can never
 * reach the SDK subprocess through a silent cast — the boundary fails loudly.
 */

import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { assertNever } from "../lib/invariant.js";
import type { ChatContentBlock } from "./claude-chat-types.js";

/** The `ContentBlockParam[]` the SDK's `SDKUserMessage.message.content` accepts. */
type SdkUserContent = Exclude<SDKUserMessage["message"]["content"], string>;
type SdkContentBlock = SdkUserContent[number];

/**
 * The image `media_type`s the Anthropic Messages API accepts (its
 * `Base64ImageSource.media_type` literal union). Anything else — `image/svg+xml`,
 * `image/avif`, `image/bmp`, `image/heic` — is rejected by the API, so we reject
 * it at this boundary rather than shipping it and getting an opaque failure.
 */
export const SUPPORTED_IMAGE_MEDIA_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
] as const;
export type SupportedImageMediaType = (typeof SUPPORTED_IMAGE_MEDIA_TYPES)[number];

const SUPPORTED_IMAGE_MEDIA_TYPE_SET: ReadonlySet<string> = new Set(SUPPORTED_IMAGE_MEDIA_TYPES);

export function isSupportedImageMediaType(value: string): value is SupportedImageMediaType {
  return SUPPORTED_IMAGE_MEDIA_TYPE_SET.has(value);
}

/** Base type for every send-boundary conversion failure; catch this to handle any. */
export class MalformedChatContentBlockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MalformedChatContentBlockError";
  }
}

export class ImageBlockMissingBase64DataError extends MalformedChatContentBlockError {
  override readonly name = "ImageBlockMissingBase64DataError";
  constructor() {
    super("image block with a base64 source is missing or has empty `data`");
  }
}

export class ImageBlockMissingMediaTypeError extends MalformedChatContentBlockError {
  override readonly name = "ImageBlockMissingMediaTypeError";
  constructor() {
    super("image block with a base64 source is missing `media_type`");
  }
}

export class ImageBlockMissingUrlError extends MalformedChatContentBlockError {
  override readonly name = "ImageBlockMissingUrlError";
  constructor() {
    super("image block with a url source is missing or has empty `url`");
  }
}

export class UnsupportedImageMediaTypeError extends MalformedChatContentBlockError {
  override readonly name = "UnsupportedImageMediaTypeError";
  constructor(readonly mediaType: string) {
    super(
      `image block has unsupported media_type ${JSON.stringify(mediaType)}; ` +
        `the Anthropic API accepts only ${SUPPORTED_IMAGE_MEDIA_TYPES.join(", ")}`,
    );
  }
}

/** Narrow one loose image `source` into a complete SDK image block. */
function toSdkImageBlock(
  source: Extract<ChatContentBlock, { type: "image" }>["source"],
): SdkContentBlock {
  switch (source.type) {
    case "base64": {
      if (source.data === undefined || source.data === "") {
        throw new ImageBlockMissingBase64DataError();
      }
      if (source.media_type === undefined) throw new ImageBlockMissingMediaTypeError();
      if (!isSupportedImageMediaType(source.media_type)) {
        throw new UnsupportedImageMediaTypeError(source.media_type);
      }
      return {
        type: "image",
        source: { type: "base64", media_type: source.media_type, data: source.data },
      };
    }
    case "url": {
      if (source.url === undefined || source.url === "") throw new ImageBlockMissingUrlError();
      return { type: "image", source: { type: "url", url: source.url } };
    }
    default:
      return assertNever(source.type);
  }
}

/**
 * Convert the chat backend's `ChatContentBlock[]` into the SDK's
 * `ContentBlockParam[]`, validating every block. Throws a
 * {@link MalformedChatContentBlockError} subclass on the first malformed block so
 * the caller (`send()`) never hands the SDK an incomplete image.
 */
export function toSdkUserContent(blocks: ChatContentBlock[]): SdkContentBlock[] {
  return blocks.map((block): SdkContentBlock => {
    switch (block.type) {
      case "text":
        return { type: "text", text: block.text };
      case "image":
        return toSdkImageBlock(block.source);
      default:
        return assertNever(block);
    }
  });
}
