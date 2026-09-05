/**
 * Clerk tRPC router — endpoints for the browser extension (beebox-clerk).
 *
 * The extension calls these cross-origin with its box host-permission + the
 * browser session cookie (credentialed); the global chrome-extension CORS hook
 * (server-root.ts) reflects the origin on the responses. Replaces the former
 * raw routes/clerk.ts.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, authedProcedure } from "../trpc.js";
import {
  commentaryInput,
  commentaryOutput,
  commentaryDestinationsOutput,
  tabArrangementPayload,
  tabArrangementOutput,
} from "./clerk-contract.js";
import { createWebpageTemplate } from "../../../schemas/webpage.js";
import { createCommentaryTemplate } from "../../../schemas/commentary.js";
import { attachmentPath } from "../../../shared/attach-path.js";
import { listDestinations } from "../../../core/landmark/list-destinations.js";
import { safeFilename } from "../../../connectors/chat-utils.js";
import { stageAndCommitPaths } from "../../../lib/git.js";
import { createTabArrangementCard } from "../../../schemas/tab-arrangement.js";
import { parseFrontmatterObject } from "../../../cards/index.js";
import { withCardLock } from "../../../lib/card-lock.js";
import { errnoCode } from "../../../lib/error-guards.js";
import { BOX_DIRS } from "../../../lib/paths.js";

/** Default filing spot when no commentary destination is chosen. */
const DEFAULT_COMMENTARY_DIR = BOX_DIRS.inbox;

export const clerkRouter = router({
  commentaryDestinations: publicProcedure.output(commentaryDestinationsOutput).query(async ({ ctx }) => {
    const destinations = await listDestinations(ctx.boxRoot, "commentary");
    return { destinations };
  }),

  commentary: publicProcedure.input(commentaryInput).output(commentaryOutput).mutation(async ({ input, ctx }) => {
    const boxRoot = ctx.boxRoot;
    const capturedAt = input.timestamp ?? new Date().toISOString();

    // A provided destination must be a real commentary destination; otherwise
    // file into the inbox. Validating turns a stale/typo'd dir into a clear
    // error rather than a card silently landing somewhere unexpected.
    let destDir: string = DEFAULT_COMMENTARY_DIR;
    if (input.destinationDir !== undefined && input.destinationDir !== "") {
      const destinations = await listDestinations(boxRoot, "commentary");
      const match = destinations.find((d) => d.dir === input.destinationDir);
      if (match === undefined) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Unknown commentary destination: ${input.destinationDir}` });
      }
      destDir = input.destinationDir;
    }

    const filename = buildFilename(input.title, "Page");
    const cardRel = path.join(destDir, `${filename}.webpage.card`);

    // The captured page is the webpage card (readable body + frozen snapshot).
    const createdPaths = await writeWebpageCard({
      boxRoot,
      cardRel,
      title: input.title,
      url: input.url,
      capturedAt,
      markdown: input.readableMarkdown,
      siteName: input.siteName,
      byline: input.byline,
      excerpt: input.excerpt,
      frozenHtml: input.frozenHtml,
    });

    // The commentary is a separate card inside the webpage's attach scope: it
    // belongs to the page (moves/dies with it). Empty to start — the chat agent
    // authors the {% source %} anchors. The webpage view surfaces it inline.
    const commentaryRel = attachmentPath(cardRel, `${filename}.commentary.card`);
    await writeCard(path.join(boxRoot, commentaryRel), createCommentaryTemplate({ title: input.title }));
    createdPaths.push(commentaryRel);

    // commitPaths (inside stageAndCommitPaths) scopes the commit to exactly our
    // paths so a concurrent sweep can't entangle unrelated staged changes under
    // the clerk attribution.
    await stageAndCommitPaths(boxRoot, {
      paths: createdPaths,
      message: `Add commentary from Clerk: "${input.title}"`,
      trailers: { "Created-By": "clerk-api" },
    });

    // Open the webpage card in a chat companion pane, chat scoped to the dest
    // dir. Returned relative to the box URL — the extension joins it onto boxUrl.
    const companion = `view:${cardRel}`;
    const open =
      `chat?session=new&contextDir=${encodeURIComponent(destDir)}` +
      `&companion=${encodeURIComponent(companion)}`;
    return { created: createdPaths, open };
  }),

  tabArrangement: authedProcedure
    .input(tabArrangementPayload)
    .output(tabArrangementOutput)
    .mutation(async ({ input, ctx }) => {
      const cardRel = path.join(DEFAULT_COMMENTARY_DIR, `Tabs_${input.transferId}.tab-arrangement.card`);
      const absPath = path.join(ctx.boxRoot, cardRel);
      await withCardLock(absPath, async () => {
        const existing = await readIfPresent(absPath);
        if (existing !== undefined) {
          const fields = parseFrontmatterObject(existing);
          const sameImmutablePayload =
            fields?.["transfer-id"] === input.transferId &&
            fields["scope"] === input.scope &&
            fields["captured-at"] === input.capturedAt &&
            JSON.stringify(fields["source"]) === JSON.stringify(input.source);
          if (!sameImmutablePayload) {
            throw new TRPCError({ code: "CONFLICT", message: "Tab transfer ID already belongs to different content" });
          }
          return;
        }

        await writeCard(absPath, createTabArrangementCard(input));
        await stageAndCommitPaths(ctx.boxRoot, {
          paths: [cardRel],
          message: `Add tab arrangement from Clerk: ${input.transferId}`,
          trailers: { "Created-By": "clerk-api" },
        });
      });

      const companion = `view:${cardRel}`;
      const open =
        `chat?session=new&contextDir=${encodeURIComponent(DEFAULT_COMMENTARY_DIR)}` +
        `&companion=${encodeURIComponent(companion)}`;
      return { card: cardRel, open, transferId: input.transferId };
    }),
});

function buildFilename(title: string, fallback: string): string {
  const safe = safeFilename(title, fallback);
  const suffix = new Date().toISOString().replace(/[.:]/g, "-").slice(0, 19);
  return `${safe}_${suffix}`;
}

async function writeCard(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf-8");
}

async function readIfPresent(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch (error) {
    if (errnoCode(error) === "ENOENT") return undefined;
    throw error;
  }
}

/**
 * Write a `.webpage.card` (readable body + capture provenance) and, when a
 * frozen snapshot is provided, `<card>.attach/page.frozen` beside it. Returns
 * the box-relative paths written, in commit order.
 */
async function writeWebpageCard(opts: {
  boxRoot: string;
  cardRel: string;
  title: string;
  url: string;
  capturedAt: string;
  markdown: string;
  siteName?: string | undefined;
  byline?: string | undefined;
  excerpt?: string | undefined;
  frozenHtml?: string | undefined;
}): Promise<string[]> {
  const frozen = opts.frozenHtml;
  const hasFrozen = typeof frozen === "string" && frozen !== "";
  const card = createWebpageTemplate({
    title: opts.title,
    source: opts.url,
    capturedAt: opts.capturedAt,
    content: opts.markdown,
    siteName: opts.siteName,
    byline: opts.byline,
    excerpt: opts.excerpt,
    frozenRef: hasFrozen ? "attach/page.frozen" : undefined,
  });
  await writeCard(path.join(opts.boxRoot, opts.cardRel), card);
  const created = [opts.cardRel];
  if (hasFrozen) {
    const frozenRel = attachmentPath(opts.cardRel, "page.frozen");
    await writeCard(path.join(opts.boxRoot, frozenRel), frozen);
    created.push(frozenRel);
  }
  return created;
}
