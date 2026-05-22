/**
 * News item card schema — RSS/Atom feed items.
 *
 * Created by the RSS connector when pulling feeds. Processed by the
 * reactor agent via news jobs.
 *
 * The card's markdown body is the full fetched article content. RSS
 * metadata (title, link, feed, summary, author, guid, comments) lives
 * in the frontmatter, as does the agent's `analysis` structure and any
 * `fetch-error` info.
 */

import { cardSchema, type CardSchema } from "cardworks";
import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import { body } from "cardworks";
import { cleanTitle } from "./news-brief.js";

/**
 * Valid news item statuses. Status is mostly derived from filesystem
 * location now; the field is kept for the few flows that still read it
 * (deprecated — prefer location).
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

const FeedEntry = z.object({
  url: z.string().url().optional(),
  title: z.string(),
});

const FetchedMeta = z.object({
  /** Final URL after redirects, if different from `link`. */
  url: z.string().url().optional(),
  at: z.string().datetime({ offset: true }),
});

const FetchError = z.object({
  "attempted-at": z.string().datetime({ offset: true }),
  "status-code": z.coerce.number().optional(),
  message: z.string(),
});

const AnalysisFields = z.object({
  "analyzed-at": z.string().datetime({ offset: true }),
  topics: z.array(z.string()).optional(),
  type: z.string().optional(),
  thesis: z.string().optional(),
  tone: z.string().optional(),
  timeliness: z.string().optional(),
  notes: z.string().optional(),
  questions: z.array(z.string()).optional(),
});

export const NewsItemSchema: CardSchema = cardSchema("news-item", {
  fields: {
    status: NewsItemStatus.optional(),
    source: z.enum(["rss", "user"]).optional(),
    title: z.string(),
    link: z.string().url(),
    published: z.string().datetime({ offset: true }),
    feed: FeedEntry.optional(),
    summary: z.string().optional(),
    author: z.string().optional(),
    guid: z.string().optional(),
    comments: z.string().url().optional(),
    fetched: FetchedMeta.optional(),
    "fetch-error": FetchError.optional(),
    analysis: AnalysisFields.optional(),
    body: body(z.string()),
  },
  instructions: `# Handling News Items

**Location IS state.** The filesystem path tells you the lifecycle
stage:
- \`box/inbox/news/\` — new, awaiting triage
- \`box/pool/news/\` — triaged as interesting, ready for brief
- \`store/archive/news/\` — used in a brief
- \`store/trash/news/\` — skipped

The \`status\` field is deprecated. Don't set it or rely on it. Use
\`cb mv\` and \`cb rm\` to change state, never manual file moves.

## Body

The card's markdown body is the full article content fetched by
\`cb fetch-news\`. It's empty until the fetch step has run.

## Frontmatter

- \`title\`, \`link\`, \`published\` — required, set by the RSS connector.
- \`feed:\` — \`{url?, title}\` for the source feed.
- \`summary\`, \`author\`, \`guid\`, \`comments\` — optional, set by RSS.
- \`fetched:\` — \`{url?, at}\` set by \`cb fetch-news\` on success. \`url\`
  is the final URL after redirects (when different from \`link\`).
- \`fetch-error:\` — \`{attempted-at, status-code?, message}\` set by
  \`cb fetch-news\` on failure. Mutually exclusive with a non-empty body.
- \`analysis:\` — the brief writer's catalogue metadata about how this
  article fits the reader's mental space. NOT a summary of the
  content — the body is already the content. Fields: \`analyzed-at\`,
  \`topics\` (array), \`type\` (news/opinion/tutorial/…), \`thesis\`,
  \`tone\`, \`timeliness\`, \`notes\`, \`questions\` (array).`,
});

export interface NewsItemFields {
  type: "news-item";
  status?: NewsItemStatus;
  source?: "rss" | "user";
  title: string;
  link: string;
  published: string;
  feed?: { url?: string; title: string };
  summary?: string;
  author?: string;
  guid?: string;
  comments?: string;
  fetched?: { url?: string; at: string };
  "fetch-error"?: { "attempted-at": string; "status-code"?: number; message: string };
  analysis?: {
    "analyzed-at": string;
    topics?: string[];
    type?: string;
    thesis?: string;
    tone?: string;
    timeliness?: string;
    notes?: string;
    questions?: string[];
  };
  body: string;
}

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
  const fields: Record<string, unknown> = {
    type: "news-item",
    title: cleanTitle(options.title),
    link: options.link,
    published: options.published,
  };
  if (options.source !== undefined) fields["source"] = options.source;
  const feedTitle = options.feedTitle ?? (options.source === "user" ? "Saved from browser" : undefined);
  if (feedTitle !== undefined) {
    const feed: Record<string, unknown> = { title: feedTitle };
    if (options.feedUrl !== undefined) feed["url"] = options.feedUrl;
    fields["feed"] = feed;
  }
  if (options.summary !== undefined) fields["summary"] = options.summary;
  if (options.author !== undefined) fields["author"] = options.author;
  fields["guid"] = options.guid ?? options.link;
  if (options.comments !== undefined) fields["comments"] = options.comments;
  return `---\n${stringifyYaml(fields)}---\n`;
}
