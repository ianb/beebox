import { z } from "zod";

/**
 * Schema for comment information attached to an element.
 */
export const CommentsSchema = z.object({
  start: z.string().optional(),
  end: z.string().optional(),
});

export type Comments = z.infer<typeof CommentsSchema>;

/**
 * Schema for source location information.
 */
export const LocationSchema = z.object({
  source: z.string(),
  startLine: z.number(),
  startColumn: z.number(),
  endLine: z.number(),
  endColumn: z.number(),
});

export type Location = z.infer<typeof LocationSchema>;

/**
 * Schema for text segments in mixed content.
 */
export const TextSegmentSchema = z.object({
  text: z.string(),
  position: z.number(),
});

export type TextSegment = z.infer<typeof TextSegmentSchema>;
