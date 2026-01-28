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
 * Schema for provenance (source location) information.
 */
export const ProvenanceSchema = z.object({
  source: z.string(),
  startLine: z.number(),
  startColumn: z.number(),
  endLine: z.number(),
  endColumn: z.number(),
});

export type Provenance = z.infer<typeof ProvenanceSchema>;

/**
 * Schema for text segments in mixed content.
 */
export const TextSegmentSchema = z.object({
  text: z.string(),
  position: z.number(),
});

export type TextSegment = z.infer<typeof TextSegmentSchema>;
