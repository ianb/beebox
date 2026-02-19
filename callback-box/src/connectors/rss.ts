/**
 * RSS Connector - Fetches RSS/Atom feeds and creates news-item cards.
 *
 * Configuration is stored in /config/connectors/rss.json:
 * {
 *   "feeds": [
 *     { "url": "https://example.com/rss", "title": "Example Feed" }
 *   ]
 * }
 *
 * State (last seen GUIDs) is stored in /config/connectors/rss-state.json
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseStringPromise } from "xml2js";
import {
  registerConnector,
  type Connector,
  type SyncResult,
  type ExecuteResult,
} from "./index.js";
import { createNewsItemTemplate } from "../schemas/news-item.js";
import { stageFiles, commit } from "../cli/lib/git.js";

interface FeedConfig {
  url: string;
  title?: string;
}

interface RssConfig {
  feeds: FeedConfig[];
}

interface RssState {
  seenGuids: Record<string, string[]>; // feedUrl -> list of GUIDs
}

interface FeedItem {
  title: string;
  link: string;
  published: string;
  summary?: string;
  author?: string;
  guid: string;
  comments?: string;
}

/**
 * Parse an RSS 2.0 feed.
 */
function parseRss2(data: Record<string, unknown>): FeedItem[] {
  const items: FeedItem[] = [];
  const channel = (data.rss as Record<string, unknown>)?.channel as Record<string, unknown>[];

  if (!channel?.[0]) return items;

  const channelData = channel[0];
  const feedItems = channelData.item as Record<string, unknown>[];

  if (!feedItems) return items;

  for (const item of feedItems) {
    const title = getFirstText(item.title);
    const link = getFirstText(item.link);
    const guid = getFirstText(item.guid) || link;
    const pubDate = getFirstText(item.pubDate);
    const description = getFirstText(item.description);
    const author = getFirstText(item.author) || getFirstText(item["dc:creator"]);
    const comments = getFirstText(item.comments);

    if (!title || !link || !guid) continue;

    const feedItem: FeedItem = {
      title,
      link,
      guid,
      published: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
    };
    if (description) feedItem.summary = stripHtml(description);
    if (author) feedItem.author = author;
    if (comments) feedItem.comments = comments;
    items.push(feedItem);
  }

  return items;
}

/**
 * Parse an Atom feed.
 */
function parseAtom(data: Record<string, unknown>): FeedItem[] {
  const items: FeedItem[] = [];
  const feed = data.feed as Record<string, unknown>;

  if (!feed) return items;

  const entries = feed.entry as Record<string, unknown>[];

  if (!entries) return items;

  for (const entry of entries) {
    const title = getFirstText(entry.title);
    const links = entry.link as Record<string, unknown>[];
    const link = links?.find((l) => l.$ && (l.$ as Record<string, string>).rel !== "self");
    const linkUrl = link ? (link.$ as Record<string, string>)?.href : undefined;
    const id = getFirstText(entry.id);
    const published = getFirstText(entry.published) || getFirstText(entry.updated);
    const summary = getFirstText(entry.summary) || getFirstText(entry.content);
    const authorObj = entry.author as Record<string, unknown>[];
    const author = authorObj?.[0] ? getFirstText(authorObj[0].name) : undefined;

    if (!title || !linkUrl || !id) continue;

    const feedItem: FeedItem = {
      title,
      link: linkUrl,
      guid: id,
      published: published ? new Date(published).toISOString() : new Date().toISOString(),
    };
    if (summary) feedItem.summary = stripHtml(summary);
    if (author) feedItem.author = author;
    items.push(feedItem);
  }

  return items;
}

/**
 * Get text from xml2js parsed element.
 */
function getFirstText(el: unknown): string | undefined {
  if (!el) return undefined;
  if (typeof el === "string") return el;
  if (Array.isArray(el)) {
    const first = el[0];
    if (typeof first === "string") return first;
    if (first && typeof first === "object" && "_" in first) {
      return first._ as string;
    }
  }
  return undefined;
}

/**
 * Strip HTML tags from text.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500); // Limit summary length
}

/**
 * Generate a safe filename from a title.
 */
function safeFilename(title: string): string {
  return title
    .replace(/[^\d\sA-Za-z-]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 50);
}

function buildRssCommitMessage(feedNotes: Map<string, string[]>): string {
  let total = 0;
  for (const items of feedNotes.values()) total += items.length;

  const subject = `Pull ${total} news item${total === 1 ? "" : "s"} from RSS`;
  if (feedNotes.size === 0) return subject;

  const lines = [subject, ""];
  for (const [feedTitle, items] of feedNotes) {
    if (feedNotes.size > 1) {
      lines.push(`${feedTitle} (${items.length}):`);
    }
    const cap = 5;
    for (const title of items.slice(0, cap)) {
      lines.push(`- ${title}`);
    }
    if (items.length > cap) {
      lines.push(`  + ${items.length - cap} more`);
    }
    if (feedNotes.size > 1) lines.push("");
  }
  return lines.join("\n").trimEnd();
}

class RssConnector implements Connector {
  name = "rss";
  handles: string[] = []; // RSS connector doesn't execute commands
  produces = ["news-item"];

  private boxRoot: string;

  constructor(boxRoot: string) {
    this.boxRoot = boxRoot;
  }

  private configPath(): string {
    return path.join(this.boxRoot, "config/connectors/rss.json");
  }

  private statePath(): string {
    return path.join(this.boxRoot, "config/connectors/rss-state.json");
  }

  private async loadConfig(): Promise<RssConfig> {
    try {
      const content = await fs.readFile(this.configPath(), "utf-8");
      return JSON.parse(content);
    } catch {
      return { feeds: [] };
    }
  }

  private async loadState(): Promise<RssState> {
    try {
      const content = await fs.readFile(this.statePath(), "utf-8");
      return JSON.parse(content);
    } catch {
      return { seenGuids: {} };
    }
  }

  private async saveState(state: RssState): Promise<void> {
    await fs.mkdir(path.dirname(this.statePath()), { recursive: true });
    await fs.writeFile(this.statePath(), JSON.stringify(state, null, 2));
  }

  async sync(): Promise<SyncResult> {
    const config = await this.loadConfig();
    const state = await this.loadState();

    if (config.feeds.length === 0) {
      return {
        success: true,
        created: [],
        updated: [],
      };
    }

    const created: string[] = [];
    const errors: string[] = [];
    const feedNotes = new Map<string, string[]>();

    for (const feed of config.feeds) {
      try {
        const response = await fetch(feed.url);
        if (!response.ok) {
          errors.push(`Failed to fetch ${feed.url}: ${response.status}`);
          continue;
        }

        const xml = await response.text();
        const parsed = await parseStringPromise(xml);

        // Determine feed type and parse
        let items: FeedItem[] = [];
        let feedTitle = feed.title || feed.url;

        if (parsed.rss) {
          items = parseRss2(parsed);
          const channel = (parsed.rss as Record<string, unknown>)?.channel as Record<
            string,
            unknown
          >[];
          feedTitle = feed.title || getFirstText(channel?.[0]?.title) || feed.url;
        } else if (parsed.feed) {
          items = parseAtom(parsed);
          feedTitle = feed.title || getFirstText(parsed.feed.title) || feed.url;
        }

        // Filter out already seen items
        const seenGuids = state.seenGuids[feed.url] || [];
        const newItems = items.filter((item) => !seenGuids.includes(item.guid));

        // Create cards for new items in inbox/news/
        const newsDir = path.join(this.boxRoot, "box/inbox/news");
        await fs.mkdir(newsDir, { recursive: true });

        for (const item of newItems) {
          const timestamp = new Date().toISOString().replace(/[.:]/g, "-").slice(0, 19);
          const filename = `${safeFilename(item.title)}_${timestamp}.news-item.card`;
          const cardPath = path.join(newsDir, filename);

          const templateOptions: Parameters<typeof createNewsItemTemplate>[0] = {
            title: item.title,
            link: item.link,
            published: item.published,
            feedUrl: feed.url,
            feedTitle,
            guid: item.guid,
          };
          if (item.summary) templateOptions.summary = item.summary;
          if (item.author) templateOptions.author = item.author;
          if (item.comments) templateOptions.comments = item.comments;
          const content = createNewsItemTemplate(templateOptions);

          await fs.writeFile(cardPath, content);
          created.push(path.relative(this.boxRoot, cardPath));

          // Accumulate note for commit message
          const feedItems = feedNotes.get(feedTitle) || [];
          feedItems.push(item.title);
          feedNotes.set(feedTitle, feedItems);
        }

        // Update state with new GUIDs
        state.seenGuids[feed.url] = [
          ...seenGuids,
          ...newItems.map((item) => item.guid),
        ].slice(-1000); // Keep last 1000 GUIDs per feed
      } catch (err) {
        errors.push(`Error processing ${feed.url}: ${(err as Error).message}`);
      }
    }

    await this.saveState(state);

    // Commit if we created any cards
    if (created.length > 0) {
      await stageFiles(this.boxRoot, created);
      await commit(this.boxRoot, {
        message: buildRssCommitMessage(feedNotes),
        trailers: {
          "Pulled-By": "rss-connector",
        },
      });
    }

    const result: SyncResult = {
      success: errors.length === 0,
      created,
      updated: [],
    };
    if (errors.length > 0) {
      result.error = errors.join("; ");
    }
    return result;
  }

  async execute(_cardPath: string, _dryRun: boolean): Promise<ExecuteResult> {
    // RSS connector doesn't execute commands
    return {
      success: false,
      error: "RSS connector does not support command execution",
    };
  }
}

/**
 * Create and register the RSS connector for a box.
 */
export function createRssConnector(boxRoot: string): Connector {
  const connector = new RssConnector(boxRoot);
  registerConnector(connector);
  return connector;
}
