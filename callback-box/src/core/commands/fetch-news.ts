/**
 * Fetch-news command - Fetch full article content for news items.
 *
 * Takes a news item card with status "interesting" (or "new"),
 * fetches the article HTML, converts to markdown, and updates the card.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import TurndownService from "turndown";
import { stringify as stringifyYaml } from "yaml";
import {
  registerCommand,
  type CommandContext,
  type CommandResult,
} from "../command-runner.js";
import { isCardFile, boxPath } from "../../cli/lib/paths.js";
import { stageFiles, commit } from "../../cli/lib/git.js";
import { getBoxTimeISO } from "../../cli/lib/time.js";
import { boxFetch } from "../../cli/lib/fetch.js";
import { parseCardText } from "../card-io.js";
import { createCardSchemaMap } from "../../schemas/registry.js";
import type { NewsItemFields } from "../../schemas/news-item.js";
import type { ArticleFetcherService } from "../../services/article-fetcher.js";

/**
 * Arguments for the fetch-news command.
 */
export interface FetchNewsArgs {
  /** Path to the news-item card */
  path: string;
  /** Whether to commit the change */
  commit?: boolean;
  /** Timeout in milliseconds */
  timeout?: number;
  /** Injected article fetcher — if not provided, uses the real fetchArticle. */
  articleFetcher?: ArticleFetcherService;
}

// Initialize turndown with sensible defaults
const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});

// Remove script, style, nav, footer, aside elements
turndown.remove(["script", "style", "nav", "footer", "aside", "noscript"]);

/**
 * Extract the main content from HTML.
 * Tries to find article/main content, falls back to body.
 */
function extractMainContent(html: string): string {
  // Simple heuristic: look for <article>, <main>, or content divs
  // This is a basic implementation - could be improved with readability-like library

  // Try to find article tag content
  const articleMatch = html.match(/<article[^>]*>([\S\s]*?)<\/article>/i);
  if (articleMatch) {
    return articleMatch[1]!;
  }

  // Try main tag
  const mainMatch = html.match(/<main[^>]*>([\S\s]*?)<\/main>/i);
  if (mainMatch) {
    return mainMatch[1]!;
  }

  // Try common content divs
  const contentPatterns = [
    /<div[^>]*class="[^"]*(?:article|content|post|entry)[^"]*"[^>]*>([\S\s]*?)<\/div>/i,
    /<div[^>]*id="(?:article|content|post|entry)"[^>]*>([\S\s]*?)<\/div>/i,
  ];

  for (const pattern of contentPatterns) {
    const match = html.match(pattern);
    if (match) {
      return match[1]!;
    }
  }

  // Fall back to body
  const bodyMatch = html.match(/<body[^>]*>([\S\s]*?)<\/body>/i);
  if (bodyMatch) {
    return bodyMatch[1]!;
  }

  return html;
}

/**
 * Parameters for replaceUrlInAttr
 */
interface ReplaceUrlInAttrParams {
  match: string;
  prefix: string;
  url: string;
  suffix: string;
  base: URL;
}

/**
 * Replace a single URL in an attribute value.
 */
function replaceUrlInAttr(params: ReplaceUrlInAttrParams): string {
  const { prefix, url, suffix, base } = params;
  try {
    const absolute = new URL(url, base).href;
    return prefix + absolute + suffix;
  } catch {
    return prefix + url + suffix;
  }
}

/**
 * Make relative URLs absolute given a base URL.
 */
function makeUrlsAbsolute(html: string, baseUrl: string): string {
  const base = new URL(baseUrl);
  // Fix src and href attributes with relative URLs
  return html.replace(
    /((?:src|href|poster|action)=["'])([^"']+)(["'])/gi,
    // eslint-disable-next-line max-params -- regex replacement callback signature
    (match: string, prefix: string, url: string, suffix: string) => {
      return replaceUrlInAttr({ match, prefix, url, suffix, base });
    }
  );
}

/**
 * Fetch and convert article to markdown.
 */
async function fetchArticle(
  url: string,
  timeout: number
): Promise<{ markdown: string; finalUrl: string }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await boxFetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; CallbackBox/1.0; +https://github.com/example/callback-box)",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
    });

    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
      (error as Error & { statusCode?: number }).statusCode = response.status;
      throw error;
    }

    const html = await response.text();
    const mainContent = extractMainContent(html);
    const absoluteContent = makeUrlsAbsolute(mainContent, response.url);
    const markdown = turndown.turndown(absoluteContent);

    return {
      markdown,
      finalUrl: response.url, // May differ from original due to redirects
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Execute the fetch-news command.
 */
async function writeNewsItem(absPath: string, fields: NewsItemFields): Promise<void> {
  const { body, ...frontmatter } = fields;
  const yamlText = stringifyYaml(frontmatter);
  const bodyTail = body === "" ? "" : `${body}${body.endsWith("\n") ? "" : "\n"}`;
  await fs.writeFile(absPath, `---\n${yamlText}---\n${bodyTail}`);
}

async function executeFetchNews(
  ctx: CommandContext,
  args: Record<string, unknown>
): Promise<CommandResult> {
  const fetchArgs = args as unknown as FetchNewsArgs;

  if (!fetchArgs.path) {
    return { success: false, error: "Path is required" };
  }

  // Resolve path
  let fullPath: string;
  if (path.isAbsolute(fetchArgs.path)) {
    fullPath = fetchArgs.path;
  } else {
    fullPath = boxPath(ctx.boxRoot, fetchArgs.path);
  }

  // Validate it's a card file
  if (!isCardFile(fullPath)) {
    return { success: false, error: "Path must be a .card file" };
  }

  // Load the card (Phase 2 frontmatter format)
  let raw: string;
  let fields: NewsItemFields;
  try {
    raw = await fs.readFile(fullPath, "utf8");
    const parsed = parseCardText(raw, {
      source: fullPath,
      schemas: createCardSchemaMap(),
    });
    if (parsed.schema.type !== "news-item") {
      return { success: false, error: `Not a news-item card (found: ${parsed.schema.type})` };
    }
    fields = parsed.fields as unknown as NewsItemFields;
  } catch (error) {
    return { success: false, error: `Failed to load card: ${(error as Error).message}` };
  }

  const url = fields.link;
  if (!url) {
    return { success: false, error: "News item has no link" };
  }
  const timeout = fetchArgs.timeout ?? 30000;
  const now = getBoxTimeISO(ctx.boxRoot);

  ctx.writeLine(`Fetching: ${url}`);

  try {
    const fetcher = fetchArgs.articleFetcher;
    const { markdown, finalUrl } = fetcher
      ? await fetcher.fetch(url, timeout)
      : await fetchArticle(url, timeout);

    fields.status = "fetched";
    const fetched: NonNullable<NewsItemFields["fetched"]> = { at: now };
    if (finalUrl !== url) fetched.url = finalUrl;
    fields.fetched = fetched;
    delete fields["fetch-error"];
    fields.body = markdown;

    await writeNewsItem(fullPath, fields);

    const relativePath = path.relative(ctx.boxRoot, fullPath);
    ctx.writeLine(`Updated: ${relativePath} (${String(markdown.length)} chars)`);

    if (fetchArgs.commit) {
      await stageFiles(ctx.boxRoot, [relativePath]);
      await commit(ctx.boxRoot, {
        message: `Fetch news content: ${path.basename(fullPath, ".card")}`,
        trailers: {
          "Fetched-By": "cb fetch-news",
          "Source-URL": url,
        },
      });
      ctx.writeLine("Committed.");
    }

    return {
      success: true,
      data: {
        path: relativePath,
        url,
        finalUrl,
        contentLength: markdown.length,
      },
    };
  } catch (error) {
    const err = error as Error & { statusCode?: number };

    fields.status = "fetch-failed";
    const errInfo: NonNullable<NewsItemFields["fetch-error"]> = {
      "attempted-at": now,
      message: err.message,
    };
    if (err.statusCode !== undefined) errInfo["status-code"] = err.statusCode;
    fields["fetch-error"] = errInfo;
    delete fields.fetched;
    fields.body = "";

    await writeNewsItem(fullPath, fields);

    const relativePath = path.relative(ctx.boxRoot, fullPath);
    ctx.writeLine(`Fetch failed: ${err.message}`);
    ctx.writeLine(`Updated: ${relativePath} with error details`);

    // Optionally commit even on failure
    if (fetchArgs.commit) {
      await stageFiles(ctx.boxRoot, [relativePath]);
      await commit(ctx.boxRoot, {
        message: `Fetch news failed: ${path.basename(fullPath, ".card")}`,
        trailers: {
          "Fetched-By": "cb fetch-news",
          "Source-URL": url,
          "Error": err.message,
        },
      });
      ctx.writeLine("Committed.");
    }

    return {
      success: false,
      error: err.message,
      data: {
        path: relativePath,
        url,
        errorMessage: err.message,
        statusCode: err.statusCode,
      },
    };
  }
}

// Register the command
registerCommand({
  name: "fetch-news",
  description: "Fetch full article content for a news item",
  args: [
    {
      name: "path",
      description: "Path to the news-item card",
      required: true,
      type: "string",
    },
    {
      name: "commit",
      description: "Commit the change",
      required: false,
      default: false,
      type: "boolean",
    },
    {
      name: "timeout",
      description: "Fetch timeout in milliseconds",
      required: false,
      default: 30000,
      type: "number",
    },
  ],
  execute: executeFetchNews,
});

export { executeFetchNews, fetchArticle };
