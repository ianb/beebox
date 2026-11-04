/**
 * What `bbx webpage` hands to `standard` and to a box's `webpage.ts`, and what
 * they answer with (docs/plans/webpage-capture-tools.md).
 */

import { z } from "zod";

export const CAPTURED_RESPONSE = z.object({
  /** The address the page came from. */
  url: z.string(),
  /** The address asked for, before any redirect. */
  requestedUrl: z.string(),
  /** Every earlier address, oldest first. */
  redirectedFrom: z.array(z.string()),
  /** Null when the source does not report one (the box browser). */
  status: z.number().int().nullable(),
  headers: z.record(z.string(), z.string()),
  contentType: z.string().nullable(),
  html: z.string(),
  /** Of the bytes as received, before decoding; null when the source gives only text. */
  sha256: z.string().nullable(),
  via: z.enum(["http", "browser", "file"]),
});
export type CapturedResponse = z.infer<typeof CAPTURED_RESPONSE>;

const PAGE_RESULT = z.object({
  title: z.string().min(1),
  markdown: z.string(),
  siteName: z.string().nullish(),
  byline: z.string().nullish(),
  excerpt: z.string().nullish(),
  /** Shown on the card and in stdout. */
  note: z.string().nullish(),
  /** Anything the box wants kept on the card, such as dates the page states. Goes in `capture.meta`. */
  meta: z.record(z.string(), z.unknown()).nullish(),
  /**
   * Ids to put on lines of `markdown` (0-based), so a citation can name a block. The engine writes
   * them after escaping the page text; a box function cannot write the annotation itself.
   */
  anchors: z.array(z.object({ id: z.string(), line: z.number().int().min(0) })).nullish(),
});

const REFUSAL = z.object({ refuse: z.string().min(1) });

export const WEBPAGE_RESULT = z.union([REFUSAL, PAGE_RESULT]);
export type WebpageResult = z.infer<typeof WEBPAGE_RESULT>;
export type PageResult = z.infer<typeof PAGE_RESULT>;

/** A received page's bytes, kept apart from `CapturedResponse`, which goes to box code as text. */
export interface ReceivedPage {
  response: CapturedResponse;
  body: Uint8Array;
}

/** The page's encoding: the header's charset, else the one the page declares, else UTF-8. */
export function pageCharset(body: Uint8Array, contentType: string | null): string {
  const inHeader = /charset=["']?([\w-]+)/i.exec(contentType ?? "")?.[1];
  const inPage = /<meta[^>]+charset=["']?([\w-]+)/i.exec(Buffer.from(body.subarray(0, 1024)).toString("latin1"))?.[1];
  try {
    return new TextDecoder(inHeader ?? inPage ?? "utf-8").encoding;
  } catch (_e) {
    return "utf-8";
  }
}

export function decodeHtml(body: Uint8Array, contentType: string | null): string {
  return new TextDecoder(pageCharset(body, contentType)).decode(body);
}

export function isRefusal(result: WebpageResult): result is z.infer<typeof REFUSAL> {
  return "refuse" in result;
}
