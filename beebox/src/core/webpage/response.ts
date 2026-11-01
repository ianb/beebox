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
});

const REFUSAL = z.object({ refuse: z.string().min(1) });

export const WEBPAGE_RESULT = z.union([REFUSAL, PAGE_RESULT]);
export type WebpageResult = z.infer<typeof WEBPAGE_RESULT>;
export type PageResult = z.infer<typeof PAGE_RESULT>;

export function isRefusal(result: WebpageResult): result is z.infer<typeof REFUSAL> {
  return "refuse" in result;
}
