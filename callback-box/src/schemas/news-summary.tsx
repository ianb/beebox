/**
 * News summary card schema - compiled digest of news items.
 *
 * Created periodically from processed news items to provide
 * a concise overview of interesting articles.
 */

import { element, serialize, type ElementNode } from "cardworks";
import { z } from "zod";

/**
 * Valid news summary statuses.
 */
export const NewsSummaryStatus = z.enum(["draft", "final"]);
export type NewsSummaryStatus = z.infer<typeof NewsSummaryStatus>;

/**
 * Reference to a source news item.
 */
export const SourceRef = element("source", {
  attrs: {
    /** Path to the source news-item card */
    path: z.string(),
  },
  /** Title of the referenced article */
  text: z.string(),
});

/**
 * The markdown content of the summary.
 */
export const SummaryContent = element("content", {
  attrs: {
    format: z.literal("markdown").default("markdown"),
  },
  /** Markdown text of the summary */
  text: z.string(),
});

/**
 * Period covered by this summary.
 */
export const SummaryPeriod = element("period", {
  attrs: {
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
  },
});

/**
 * News summary card schema.
 *
 * Example:
 * ```xml
 * <news-summary status="final">
 *   <period from="2024-01-15T00:00:00Z" to="2024-01-15T23:59:59Z" />
 *   <content format="markdown">
 * ## Tech Highlights
 *
 * **Major breakthrough in AI** - Researchers announced...
 *
 * **New programming language released** - The team behind...
 *   </content>
 *   <source path="box/inbox/news/AI_Breakthrough.news-item.card">Major AI Breakthrough</source>
 *   <source path="box/inbox/news/New_Language.news-item.card">New Programming Language</source>
 * </news-summary>
 * ```
 */
export const NewsSummarySchema = element("news-summary", {
  attrs: {
    status: NewsSummaryStatus.default("draft"),
  },
  children: z.array(
    z.union([
      SummaryPeriod,
      SummaryContent,
      SourceRef,
    ])
  ),
});

export type NewsSummary = z.infer<typeof NewsSummarySchema>;

/**
 * Template options for creating a news summary.
 */
export interface NewsSummaryOptions {
  status?: NewsSummaryStatus;
  periodFrom: string;
  periodTo: string;
  content: string;
  sources: Array<{
    path: string;
    title: string;
  }>;
}

/**
 * Template for creating a news summary card.
 */
export function createNewsSummaryTemplate(options: NewsSummaryOptions): string {
  const sources = options.sources.map((s) => (
    <source path={s.path}>{s.title}</source>
  ));

  const summary = (
    <news-summary status={options.status ?? "draft"}>
      <period from={options.periodFrom} to={options.periodTo} />
      <content format="markdown">{options.content}</content>
      {sources}
    </news-summary>
  );

  return serialize(summary as ElementNode) + "\n";
}
