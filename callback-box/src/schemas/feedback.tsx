/**
 * Feedback card schema - user feedback on editions.
 *
 * Feedback cards capture user responses to:
 * - Query prompts in editions (text or voice)
 * - Comments on specific sections/expandos (text or voice)
 *
 * Uses cardworks references to target specific elements.
 *
 * Voice feedback works like voice memos - uses the same <source>,
 * <transcription>, and <transcription-error> elements so the
 * transcriber pre-action can process them generically.
 */

import { element } from "cardworks";
import { z } from "zod";

/**
 * Target element for the feedback.
 * Uses a cardworks reference (path#fragment) to identify the target.
 *
 * Examples:
 * - `box/output/editions/2026-02-01_news.news-edition.card#q1` - targets query q1
 * - `box/output/editions/2026-02-01_news.news-edition.card#s1` - targets section s1
 * - `box/output/editions/2026-02-01_news.news-edition.card#h1` - targets hypothesis h1
 */
export const FeedbackTarget = element("target", {
  attrs: {
    /** Reference to the target element (path#fragment) */
    ref: z.string(),
  },
});

/**
 * User's response to a query prompt.
 * Text is optional for voice feedback (populated by transcription).
 */
export const FeedbackResponse = element("response", {
  text: z.string().optional(),
});

/**
 * User's comment on a section or element.
 * Text is optional for voice feedback (populated by transcription).
 */
export const FeedbackComment = element("comment", {
  text: z.string().optional(),
});

/**
 * When the feedback was submitted.
 */
export const FeedbackTimestamp = element("timestamp", {
  text: z.string().datetime({ offset: true }),
});

/**
 * Source of the feedback - "text" or "voice".
 * Same element name as memo schema for generic transcription.
 */
export const FeedbackSource = element("source", {
  text: z.enum(["text", "voice"]),
});

/**
 * Transcription of voice feedback (added by pre-action).
 * Same element as memo schema for generic transcription.
 */
export const FeedbackTranscription = element("transcription", {
  attrs: {
    language: z.string().optional(),
    "transcribed-at": z.string().datetime({ offset: true }).optional(),
  },
  text: z.string(),
});

/**
 * Transcription error (added by pre-action if transcription fails).
 * Same element as memo schema for generic transcription.
 */
export const FeedbackTranscriptionError = element("transcription-error", {
  attrs: {
    permanent: z.enum(["true", "false"]),
    code: z.string().optional(),
    "attempted-at": z.string().datetime({ offset: true }).optional(),
  },
  text: z.string(),
});

/**
 * Feedback card schema.
 *
 * Example (text query response):
 * ```xml
 * <feedback type="query-response">
 *   <target ref="box/output/editions/2026-02-01_news.news-edition.card#q1" />
 *   <source>text</source>
 *   <response>I'm most interested in the AI safety developments.</response>
 *   <timestamp>2026-02-01T18:48:52.641Z</timestamp>
 * </feedback>
 * ```
 *
 * Example (voice feedback, after transcription):
 * ```xml
 * <feedback type="edition">
 *   <target ref="box/output/editions/2026-02-01_news.news-edition.card#s1" />
 *   <source>voice</source>
 *   <comment></comment>
 *   <timestamp>2026-02-01T18:48:52.641Z</timestamp>
 *   <transcription language="en" transcribed-at="2026-02-01T18:49:00.000Z">
 *     This section was really helpful, especially the part about...
 *   </transcription>
 * </feedback>
 * ```
 */
export const FeedbackSchema = element("feedback", {
  attrs: {
    /** Type of feedback */
    type: z.enum(["query-response", "edition"]),
  },
  children: z.array(
    z.union([
      FeedbackTarget,
      FeedbackSource,
      FeedbackResponse,
      FeedbackComment,
      FeedbackTimestamp,
      FeedbackTranscription,
      FeedbackTranscriptionError,
    ])
  ),
});

export type Feedback = z.infer<typeof FeedbackSchema>;
