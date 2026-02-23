/**
 * Fetch-all-news command - Fetch article content for all unfetched news items.
 *
 * Finds news-item cards in a directory that don't have <content> yet,
 * and fetches them in parallel using the existing fetch-news logic.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  registerCommand,
  createCollectorContext,
  type CommandContext,
  type CommandResult,
} from "../command-runner.js";
import { executeFetchNews } from "./fetch-news.js";
import { createLoader } from "../../cli/lib/loader.js";
import { stageFiles, commit } from "../../cli/lib/git.js";
import { type ElementNode } from "cardworks";

/**
 * Result of fetching all news items.
 */
export interface FetchAllResult {
  fetched: string[];
  failed: string[];
  skipped: string[];
  errors: string[];
}

/**
 * Check if a card already has a <content> element.
 */
async function hasContent(boxRoot: string, cardPath: string): Promise<boolean> {
  try {
    const loader = await createLoader(boxRoot);
    const fullPath = path.isAbsolute(cardPath)
      ? cardPath
      : path.join(boxRoot, cardPath);
    const card = await loader.load(fullPath);
    const children = card.element.children as ElementNode[];
    return children.some((c) => c.tagName === "content");
  } catch {
    return false;
  }
}

/**
 * Parameters for fetchAllNewsItems
 */
export interface FetchAllNewsItemsParams {
  boxRoot: string;
  dir: string;
  options?: {
    concurrency?: number;
    onProgress?: (msg: string) => void;
  };
}

/**
 * Fetch all unfetched news items in a directory.
 *
 * Shared logic used by both the `fetch-all-news` command and
 * the fetch phase of `process-news`.
 */
export async function fetchAllNewsItems(
  params: FetchAllNewsItemsParams
): Promise<FetchAllResult> {
  const { boxRoot, dir, options } = params;
  const concurrency = options?.concurrency ?? 5;
  const onProgress = options?.onProgress;

  const fullDir = path.join(boxRoot, dir);
  let files: string[];
  try {
    files = (await fs.readdir(fullDir)).filter((f) =>
      f.endsWith(".news-item.card")
    );
  } catch {
    return { fetched: [], failed: [], skipped: [], errors: [] };
  }

  if (files.length === 0) {
    onProgress?.("No news items found.");
    return { fetched: [], failed: [], skipped: [], errors: [] };
  }

  // Check which items already have content
  const itemPaths: string[] = [];
  const result: FetchAllResult = {
    fetched: [],
    failed: [],
    skipped: [],
    errors: [],
  };

  for (const file of files) {
    const relativePath = path.join(dir, file);
    if (await hasContent(boxRoot, relativePath)) {
      result.skipped.push(relativePath);
    } else {
      itemPaths.push(relativePath);
    }
  }

  if (result.skipped.length > 0) {
    onProgress?.(
      `Skipping ${result.skipped.length} items that already have content.`
    );
  }

  if (itemPaths.length === 0) {
    onProgress?.("All items already have content.");
    return result;
  }

  onProgress?.(
    `Fetching ${itemPaths.length} items (concurrency: ${concurrency})...`
  );

  // Fetch in parallel with concurrency limit
  let index = 0;

  async function fetchNext(): Promise<void> {
    while (index < itemPaths.length) {
      const currentPath = itemPaths[index]!;
      index++;

      try {
        const { ctx } = createCollectorContext(boxRoot);
        const fetchResult = await executeFetchNews(ctx, {
          path: currentPath,
          commit: false,
        });

        if (fetchResult.success) {
          result.fetched.push(currentPath);
          onProgress?.(
            `  Fetched: ${path.basename(currentPath)} (${(fetchResult.data as { contentLength?: number })?.contentLength ?? "?"} chars)`
          );
        } else {
          result.failed.push(currentPath);
          result.errors.push(`${currentPath}: ${fetchResult.error}`);
          onProgress?.(`  Failed: ${path.basename(currentPath)}: ${fetchResult.error}`);
        }
      } catch (err) {
        result.failed.push(currentPath);
        result.errors.push(`${currentPath}: ${(err as Error).message}`);
        onProgress?.(
          `  Error: ${path.basename(currentPath)}: ${(err as Error).message}`
        );
      }
    }
  }

  // Launch concurrent workers
  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(concurrency, itemPaths.length); i++) {
    workers.push(fetchNext());
  }
  await Promise.all(workers);

  onProgress?.(
    `Done: ${result.fetched.length} fetched, ${result.failed.length} failed, ${result.skipped.length} skipped.`
  );

  return result;
}

/**
 * Execute the fetch-all-news command.
 */
async function executeFetchAllNews(
  ctx: CommandContext,
  args: Record<string, unknown>
): Promise<CommandResult> {
  const shouldCommit = (args.commit as boolean) ?? true;
  const concurrency = (args.concurrency as number) ?? 5;
  const dir = (args.dir as string) ?? "box/inbox/news";

  const result = await fetchAllNewsItems({
    boxRoot: ctx.boxRoot,
    dir,
    options: {
      concurrency,
      onProgress: (msg) => ctx.writeLine(msg),
    },
  });

  // Commit all changes at once
  if (shouldCommit && result.fetched.length > 0) {
    await stageFiles(ctx.boxRoot, [...result.fetched, ...result.failed]);

    // Collect feed sources from fetched items
    const feedCounts = new Map<string, number>();
    const loader = await createLoader(ctx.boxRoot);
    for (const itemPath of result.fetched) {
      try {
        const fullPath = path.isAbsolute(itemPath)
          ? itemPath
          : path.join(ctx.boxRoot, itemPath);
        const card = await loader.load(fullPath);
        const feedEl = (card.element.children as ElementNode[]).find(
          (c) => c.tagName === "feed"
        );
        const feedName = feedEl?.text ?? "unknown";
        feedCounts.set(feedName, (feedCounts.get(feedName) ?? 0) + 1);
      } catch {
        // Skip items we can't read
      }
    }

    const sourceNotes = [...feedCounts.entries()]
      .toSorted((a, b) => b[1] - a[1])
      .map(([name, count]) => `${name} (${count})`)
      .join(", ");
    const failed = result.failed.length > 0
      ? `, ${result.failed.length} failed`
      : "";
    const subject = `Fetch ${result.fetched.length} news articles${failed}`;
    const body = sourceNotes ? `\nSources: ${sourceNotes}` : "";

    await commit(ctx.boxRoot, {
      message: `${subject}${body}`,
      trailers: {
        "Triggered-By": "cb fetch-all-news",
        Phase: "fetch",
      },
    });
    ctx.writeLine("Committed.");
  }

  return {
    success: result.failed.length === 0,
    data: {
      fetched: result.fetched.length,
      failed: result.failed.length,
      skipped: result.skipped.length,
    },
    ...(result.errors.length > 0
      ? { error: `${result.failed.length} items failed to fetch` }
      : {}),
  };
}

// Register the command
registerCommand({
  name: "fetch-all-news",
  description: "Fetch article content for all unfetched news items",
  args: [
    {
      name: "dir",
      description: "Directory to scan for news items",
      required: false,
      default: "box/inbox/news",
      type: "string",
    },
    {
      name: "commit",
      description: "Commit after fetching",
      required: false,
      default: true,
      type: "boolean",
    },
    {
      name: "concurrency",
      description: "Number of parallel fetches",
      required: false,
      default: 5,
      type: "number",
    },
  ],
  execute: executeFetchAllNews,
});

export { executeFetchAllNews };
