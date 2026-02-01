/**
 * News item card schema - RSS/Atom feed items.
 *
 * Created by the RSS connector when pulling feeds.
 * Processed by the agent during wakeup to create summaries.
 */

import { element, serialize } from "cardworks";
import { z } from "zod";

/**
 * Valid news item statuses.
 *
 * Lifecycle:
 * - new: Just fetched from RSS, not yet triaged
 * - possibly-interesting: Initial triage suggests it might be worth reading
 * - interesting: Confirmed interesting, ready to fetch full content
 * - fetched: Full article content has been fetched
 * - fetch-failed: Failed to fetch article content
 * - summarized: Included in a news summary
 * - skipped: Triaged as not interesting (will be trashed)
 */
export const NewsItemStatus = z.enum([
  "new",
  "possibly-interesting",
  "interesting",
  "fetched",
  "fetch-failed",
  "summarized",
  "skipped",
]);
export type NewsItemStatus = z.infer<typeof NewsItemStatus>;

/**
 * Child element for the article title.
 */
export const NewsTitle = element("title", {
  text: z.string(),
});

/**
 * Child element for the article URL.
 */
export const NewsLink = element("link", {
  text: z.string().url(),
});

/**
 * Child element for the publication date.
 */
export const NewsPublished = element("published", {
  text: z.string().datetime({ offset: true }),
});

/**
 * Child element for the feed source.
 */
export const NewsFeed = element("feed", {
  attrs: {
    url: z.string().url(),
  },
  text: z.string(), // Feed title
});

/**
 * Child element for article summary/description.
 */
export const NewsSummary = element("summary", {
  text: z.string(),
});

/**
 * Child element for article author.
 */
export const NewsAuthor = element("author", {
  text: z.string(),
});

/**
 * Child element for unique identifier (GUID).
 */
export const NewsGuid = element("guid", {
  text: z.string(),
});

/**
 * Child element for the full article content (markdown).
 * Added after fetching the article.
 */
export const NewsContent = element("content", {
  attrs: {
    format: z.literal("markdown").default("markdown"),
    /** Original URL that was fetched (may differ from link due to redirects) */
    "fetched-url": z.string().url().optional(),
    /** When the content was fetched */
    "fetched-at": z.string().datetime({ offset: true }).optional(),
  },
  text: z.string(),
});

/**
 * Child element for fetch error details.
 * Added when fetching fails.
 */
export const NewsFetchError = element("fetch-error", {
  attrs: {
    /** When the fetch was attempted */
    "attempted-at": z.string().datetime({ offset: true }),
    /** HTTP status code if applicable */
    "status-code": z.number().optional(),
  },
  /** Error message */
  text: z.string(),
});

/**
 * News item card schema.
 *
 * Example:
 * ```xml
 * <news-item status="new">
 *   <title>Breaking: Important Tech News</title>
 *   <link>https://example.com/article</link>
 *   <published>2024-01-15T10:00:00Z</published>
 *   <feed url="https://example.com/rss">Example News</feed>
 *   <summary>A brief description of the article...</summary>
 *   <author>John Doe</author>
 *   <guid>unique-article-id-123</guid>
 * </news-item>
 * ```
 */
export const NewsItemSchema = element("news-item", {
  attrs: {
    status: NewsItemStatus.default("new"),
  },
  children: z.array(
    z.union([
      NewsTitle,
      NewsLink,
      NewsPublished,
      NewsFeed,
      NewsSummary,
      NewsAuthor,
      NewsGuid,
      NewsContent,
      NewsFetchError,
    ])
  ),
});

export type NewsItem = z.infer<typeof NewsItemSchema>;

/**
 * Template for creating a news item card.
 */
export function createNewsItemTemplate(options: {
  title: string;
  link: string;
  published: string;
  feedUrl: string;
  feedTitle: string;
  summary?: string;
  author?: string;
  guid: string;
}): string {
  const newsItem = (
    <news-item status="new">
      <title>{options.title}</title>
      <link>{options.link}</link>
      <published>{options.published}</published>
      <feed url={options.feedUrl}>{options.feedTitle}</feed>
      {options.summary && <summary>{options.summary}</summary>}
      {options.author && <author>{options.author}</author>}
      <guid>{options.guid}</guid>
    </news-item>
  );

  return serialize(newsItem) + "\n";
}
