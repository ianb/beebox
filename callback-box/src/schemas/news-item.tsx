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
 */
export const NewsItemStatus = z.enum(["new", "processing", "processed", "skipped"]);
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
