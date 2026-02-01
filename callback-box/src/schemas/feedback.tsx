/**
 * Feedback card schema - user feedback on editions.
 *
 * Feedback cards capture user responses to:
 * - Query prompts in editions
 * - Comments on specific sections/expandos
 *
 * Uses cardworks references to target specific elements.
 */

import { element } from "cardworks";
import { z } from "zod";

/**
 * Target element for the feedback.
 * Uses a cardworks reference (path#fragment) to identify the target.
 *
 * Examples:
 * - `box/inbox/editions/2026-02-01_news.news-edition.card#q1` - targets query q1
 * - `box/inbox/editions/2026-02-01_news.news-edition.card#s1` - targets section s1
 * - `box/inbox/editions/2026-02-01_news.news-edition.card#h1` - targets hypothesis h1
 */
export const FeedbackTarget = element("target", {
  attrs: {
    /** Reference to the target element (path#fragment) */
    ref: z.string(),
  },
});

/**
 * User's response to a query prompt.
 */
export const FeedbackResponse = element("response", {
  text: z.string(),
});

/**
 * User's comment on a section or element.
 */
export const FeedbackComment = element("comment", {
  text: z.string(),
});

/**
 * When the feedback was submitted.
 */
export const FeedbackTimestamp = element("timestamp", {
  text: z.string().datetime({ offset: true }),
});

/**
 * Feedback card schema.
 *
 * Example (query response):
 * ```xml
 * <feedback type="query-response">
 *   <target ref="box/inbox/editions/2026-02-01_news.news-edition.card#q1" />
 *   <response>I'm most interested in the AI safety developments.</response>
 *   <timestamp>2026-02-01T18:48:52.641Z</timestamp>
 * </feedback>
 * ```
 *
 * Example (edition comment):
 * ```xml
 * <feedback type="edition">
 *   <target ref="box/inbox/editions/2026-02-01_news.news-edition.card#s1" />
 *   <comment>This section was really helpful!</comment>
 *   <timestamp>2026-02-01T18:48:52.641Z</timestamp>
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
      FeedbackResponse,
      FeedbackComment,
      FeedbackTimestamp,
    ])
  ),
});

export type Feedback = z.infer<typeof FeedbackSchema>;
