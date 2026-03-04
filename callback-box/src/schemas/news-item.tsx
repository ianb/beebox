/** @jsxImportSource cardworks/jsx */
/**
 * News item card schema - RSS/Atom feed items.
 *
 * Created by the RSS connector when pulling feeds.
 * Processed by the reactor agent via news jobs.
 */

import { element, serialize } from "cardworks";
import { z } from "zod";
import { cleanTitle } from "./news-brief.js";

/**
 * Valid news item statuses.
 *
 * Lifecycle:
 * - new: Just fetched from RSS, not yet triaged
 * - possibly-interesting: Initial triage suggests it might be worth reading
 * - interesting: Confirmed interesting, ready to fetch full content
 * - fetched: Full article content has been fetched
 * - fetch-failed: Failed to fetch article content
 * - analyzed: Full content fetched and analyzed, ready for brief
 * - summarized: Included in a news summary/brief
 * - skipped: Triaged as not interesting (will be trashed)
 */
export const NewsItemStatus = z.enum([
  "new",
  "possibly-interesting",
  "interesting",
  "fetched",
  "fetch-failed",
  "analyzed",
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
    url: z.string().url().optional(),
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
 * Child element for discussion/comments URL (e.g., HN discussion page).
 * The brief agent may optionally fetch this to incorporate community perspective.
 */
export const NewsComments = element("comments", {
  text: z.string().url(),
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
    /** Content format - defaults to markdown */
    format: z.literal("markdown").optional(),
    /** Original URL that was fetched (may differ from link due to redirects) */
    "fetched-url": z.string().url().optional(),
    /** When the content was fetched */
    "fetched-at": z.string().datetime({ offset: true }).optional(),
  },
  // Text is optional because CDATA content may not be parsed correctly by cardworks
  text: z.string().optional(),
});

/**
 * Child element for fetch error details.
 * Added when fetching fails.
 */
export const NewsFetchError = element("fetch-error", {
  attrs: {
    /** When the fetch was attempted */
    "attempted-at": z.string().datetime({ offset: true }),
    /** HTTP status code if applicable (stored as string in XML) */
    "status-code": z.coerce.number().optional(),
  },
  /** Error message */
  text: z.string(),
});

/**
 * Child element for article analysis.
 *
 * This is NOT a summary of the content - the content is already there.
 * This is metadata about how the article fits into the mental space:
 * - What topics/themes does it cover?
 * - Is it opinion, news, tutorial, etc.?
 * - What's the thesis or main argument?
 * - How might it be used in an edition?
 *
 * Example:
 * ```xml
 * <analysis analyzed-at="2024-01-15T12:00:00Z">
 *   <topics>
 *     <topic>AI safety</topic>
 *     <topic>regulation</topic>
 *   </topics>
 *   <type>opinion</type>
 *   <thesis>AI regulation should focus on outcomes, not methods</thesis>
 *   <tone>measured, academic</tone>
 *   <timeliness>evergreen</timeliness>
 *   <notes>Could pair well with the EU AI Act news. Author is a known expert.</notes>
 *   <questions>
 *     <question>Is this position mainstream or contrarian?</question>
 *   </questions>
 * </analysis>
 * ```
 */
export const AnalysisTopic = element("topic", {
  text: z.string(),
});

export const AnalysisTopics = element("topics", {
  children: z.array(AnalysisTopic),
});

export const AnalysisQuestion = element("question", {
  text: z.string(),
});

export const AnalysisQuestions = element("questions", {
  children: z.array(AnalysisQuestion).optional(),
});

export const NewsAnalysis = element("analysis", {
  attrs: {
    /** When the analysis was created */
    "analyzed-at": z.string().datetime({ offset: true }),
  },
  children: z.array(
    z.union([
      AnalysisTopics,
      AnalysisQuestions,
      /** Article type: news, opinion, tutorial, announcement, etc. */
      element("type", { text: z.string() }),
      /** Main thesis or argument if opinion/analysis piece */
      element("thesis", { text: z.string().optional() }),
      /** Tone: measured, urgent, casual, academic, promotional, etc. */
      element("tone", { text: z.string().optional() }),
      /** Timeliness: breaking, timely, evergreen, or descriptive text */
      element("timeliness", { text: z.string().optional() }),
      /** Free-form notes about how this might be used */
      element("notes", { text: z.string().optional() }),
    ])
  ).optional(),
});

/**
 * News item card schema.
 *
 * Lifecycle is primarily expressed by location:
 * - box/inbox/news/     → New items from RSS, awaiting triage
 * - box/pool/news/      → Analyzed and ready for edition creation
 * - store/archive/news/ → Used in an edition
 * - store/trash/news/   → Skipped as uninteresting
 *
 * Example (new item):
 * ```xml
 * <news-item>
 *   <title>Breaking: Important Tech News</title>
 *   <link>https://example.com/article</link>
 *   <published>2024-01-15T10:00:00Z</published>
 *   <feed url="https://example.com/rss">Example News</feed>
 *   <summary>A brief description of the article...</summary>
 *   <author>John Doe</author>
 *   <guid>unique-article-id-123</guid>
 * </news-item>
 * ```
 *
 * Example (analyzed item in pool):
 * ```xml
 * <news-item>
 *   <title>Breaking: Important Tech News</title>
 *   <link>https://example.com/article</link>
 *   ...
 *   <content format="markdown" fetched-at="2024-01-15T11:00:00Z">
 *     Full article content here...
 *   </content>
 *   <analysis analyzed-at="2024-01-15T12:00:00Z">
 *     <topics><topic>AI</topic><topic>regulation</topic></topics>
 *     <type>news</type>
 *     <timeliness>timely</timeliness>
 *     <notes>Major announcement, should feature prominently</notes>
 *   </analysis>
 * </news-item>
 * ```
 */
export const NewsItemSchema = element("news-item", {
  attrs: {
    /** @deprecated Use location instead. Kept for backward compatibility. */
    status: NewsItemStatus.optional(),
    /** Where this item came from: "rss" (default) or "user" (explicitly saved from browser) */
    source: z.enum(["rss", "user"]).optional(),
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
      NewsComments,
      NewsContent,
      NewsFetchError,
      NewsAnalysis,
    ])
  ),
  instructions: `# Handling News Items

**Location IS state.** The filesystem path tells you the lifecycle stage:
- \`box/inbox/news/\` — new, awaiting triage
- \`box/pool/news/\` — triaged as interesting, ready for brief
- \`store/archive/news/\` — used in a brief
- \`store/trash/news/\` — skipped

The \`status\` attribute is deprecated. Don't set it or rely on it. Use \`cb mv\` and \`cb rm\` to change state, never manual file moves.

The <analysis> element is NOT a summary. The full article content is already in <content>. Analysis is metadata about how the article fits the reader's mental space: topics, type, thesis, tone, timeliness. Think of it as cataloging notes for the brief writer.

When fetching article content, store it in <content format="markdown"> with \`fetched-at\` and \`fetched-url\` attributes. If fetch fails, add <fetch-error> with \`attempted-at\` — don't leave the card in an ambiguous state.`,
});

export type NewsItem = z.infer<typeof NewsItemSchema>;

/**
 * Template for creating a news item card.
 */
export function createNewsItemTemplate(options: {
  title: string;
  link: string;
  published: string;
  feedUrl?: string;
  feedTitle?: string;
  summary?: string;
  author?: string;
  guid?: string;
  comments?: string;
  source?: "rss" | "user";
}): string {
  const feedTitle = options.feedTitle || (options.source === "user" ? "Saved from browser" : undefined);
  const guid = options.guid || options.link;
  const newsItem = (
    <news-item status="new" source={options.source}>
      <title>{cleanTitle(options.title)}</title>
      <link>{options.link}</link>
      <published>{options.published}</published>
      {feedTitle && <feed url={options.feedUrl}>{feedTitle}</feed>}
      {options.summary && <summary>{options.summary}</summary>}
      {options.author && <author>{options.author}</author>}
      <guid>{guid}</guid>
      {options.comments && <comments>{options.comments}</comments>}
    </news-item>
  );

  return serialize(newsItem) + "\n";
}
