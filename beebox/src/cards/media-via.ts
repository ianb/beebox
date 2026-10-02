/**
 * The `via` object: how media came to be in the box. A media reference
 * (`filename: { ref, via, … }` on image, file, pdf and audio cards) carries
 * one, and feedback carries one at the top level. See the Ontology in
 * `docs/implemented-plans/standard-card-fields.md`. Shared by the built-in schemas in
 * `src/schemas/`.
 */

import { z } from "zod";

/** An ISO 8601 date at whatever precision is known: `1974`, `1974-06`, `1974-06-02`. */
const PartialIsoDate = z.string().regex(/^\d{4}(-\d{2}(-\d{2})?)?$/, "expected an ISO date: YYYY, YYYY-MM or YYYY-MM-DD");

/**
 * The `via` shape with `channel` typed per card type (image keeps its enum;
 * the others take a free string such as `disk`, `microphone`,
 * `scan-upload/<token>`).
 *
 * - `channel` — how the media came into the box.
 * - `at` — when it was acquired (shutter, upload or import time).
 * - `original` — the date of the original, when known and different from
 *   `at` (a scanned 1970s photo).
 * - `note` — how or why, in prose.
 */
export function mediaVia<Channel extends z.ZodType<string>>(channel: Channel) {
  return z.object({
    channel,
    at: z.string().datetime({ offset: true }),
    original: PartialIsoDate.optional(),
    note: z.string().optional(),
  });
}

/** `via` with a free-string channel. */
export const MediaViaSchema = mediaVia(z.string());
export type MediaVia = z.infer<typeof MediaViaSchema>;
