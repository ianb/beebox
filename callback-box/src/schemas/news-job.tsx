/**
 * News job card schema - a job to process incoming news items.
 *
 * Created by the RSS connector during sync when new items arrive.
 * Processed by the reactor agent, which triages, fetches, analyzes,
 * creates a brief, and then calls `cb finish` to complete the job.
 */

import { element, escapeText, escapeAttr } from "cardworks";
import { z } from "zod";

/**
 * Child element for job description.
 */
export const JobDescription = element("description", {
  text: z.string(),
});

/**
 * Child element referencing an inbox item to process.
 */
export const JobItem = element("item", {
  attrs: {
    ref: z.string(),
  },
});

/**
 * News job card schema.
 *
 * Example:
 * ```xml
 * <news-job created="2026-02-21T08:15:00Z" source="rss-connector">
 *   <description>5 new items from RSS feeds</description>
 *   <item ref="box/inbox/news/item1.news-item.card" />
 *   <item ref="box/inbox/news/item2.news-item.card" />
 * </news-job>
 * ```
 */
export const NewsJobSchema = element("news-job", {
  attrs: {
    created: z.string().datetime({ offset: true }),
    source: z.string(),
  },
  children: z.array(z.union([JobDescription, JobItem])),
  instructions: `# Processing News Jobs

A news job means new RSS/news items have arrived and need processing.

## Steps

1. Read this job card to find the referenced items (each \`<item ref="...">\` points to a news-item card)
2. Read the news guide (\`config/news-guide.news-guide.card\`) if it exists — it describes what topics are interesting
3. Triage: run \`cb trash <path>\` on items that aren't interesting based on the guide
4. Fetch: run \`cb fetch-all-news --dir box/inbox/news\` to get full article content for remaining items
5. Analyze: use \`cb process-news\` to analyze and create a brief
6. When all work is done and committed, run \`cb finish <this-job-file>\` to complete the job

## Important

- Commit your work as you go (after triage, after analysis, etc.)
- The \`cb finish\` command only deletes the job file — make sure your actual work is committed first
- Read the items before deciding what to trash — don't just go by titles`,
});

export type NewsJob = z.infer<typeof NewsJobSchema>;

/**
 * Template for creating a news job card.
 */
export function createNewsJobTemplate(options: {
  created?: string;
  source: string;
  description: string;
  items: string[];
}): string {
  const created = options.created ?? new Date().toISOString();
  const itemElements = options.items
    .map((ref) => `  <item ref="${escapeAttr(ref)}" />`)
    .join("\n");

  return `<news-job created="${created}" source="${escapeAttr(options.source)}">
  <description>${escapeText(options.description)}</description>
${itemElements}
</news-job>
`;
}
