/**
 * Clerk tRPC router — endpoints for the browser extension (callback-clerk).
 *
 * The extension calls these cross-origin with its box host-permission + the
 * browser session cookie (credentialed); the global chrome-extension CORS hook
 * (server-root.ts) reflects the origin on the responses. Replaces the former
 * raw routes/clerk.ts.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure } from "../trpc.js";
import { createWebpageTemplate } from "../../../schemas/webpage.js";
import { createCommentaryTemplate } from "../../../schemas/commentary.js";
import { attachmentPath } from "../../../shared/attach-path.js";
import { listDestinations } from "../../../core/landmark/list-destinations.js";
import { safeFilename } from "../../../connectors/chat-utils.js";
import { stageFiles, commitPaths, pathsHaveChanges, isNothingToCommitError } from "../../../lib/git.js";

const commentaryInput = z.object({
  url: z.string().url(),
  title: z.string().min(1),
  siteName: z.string().optional(),
  byline: z.string().optional(),
  excerpt: z.string().optional(),
  // The readable rendering of the page (Defuddle markdown), stored in-box.
  readableMarkdown: z.string().min(1),
  // The frozen, self-contained page (SingleFile HTML) — optional attachment.
  frozenHtml: z.string().optional(),
  // Box-relative dir of a landmark commentary destination; omitted → inbox.
  destinationDir: z.string().optional(),
  timestamp: z.string().optional(),
});

/** Default filing spot when no commentary destination is chosen. */
const DEFAULT_COMMENTARY_DIR = "box/inbox";

export const clerkRouter = router({
  commentaryDestinations: publicProcedure.query(async ({ ctx }) => {
    const destinations = await listDestinations(ctx.boxRoot, "commentary");
    return { destinations };
  }),

  commentary: publicProcedure.input(commentaryInput).mutation(async ({ input, ctx }) => {
    const boxRoot = ctx.boxRoot;
    const capturedAt = input.timestamp ?? new Date().toISOString();

    // A provided destination must be a real commentary destination; otherwise
    // file into the inbox. Validating turns a stale/typo'd dir into a clear
    // error rather than a card silently landing somewhere unexpected.
    let destDir = DEFAULT_COMMENTARY_DIR;
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

    await gitCommit(boxRoot, {
      relPaths: createdPaths,
      message: `Add commentary from Clerk: "${input.title}"`,
    });

    // Open the webpage card in a chat companion pane, chat scoped to the dest
    // dir. Returned relative to the box URL — the extension joins it onto boxUrl.
    const companion = `view:${cardRel}`;
    const open =
      `chat?session=new&contextDir=${encodeURIComponent(destDir)}` +
      `&companion=${encodeURIComponent(companion)}`;
    return { created: createdPaths, open };
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

async function gitCommit(boxRoot: string, { relPaths, message }: { relPaths: string[]; message: string }): Promise<void> {
  // Fast path: the box's auto-sweep may already have committed these cards.
  if (!(await pathsHaveChanges(boxRoot, relPaths))) return;
  await stageFiles(boxRoot, relPaths);
  try {
    // commitPaths scopes the commit to exactly our paths so a concurrent sweep
    // can't entangle unrelated staged changes under the clerk attribution.
    await commitPaths(boxRoot, { paths: relPaths, message, trailers: { "Created-By": "clerk-api" } });
  } catch (err) {
    // Residual race: the sweep committed our paths first. "nothing to commit"
    // means the cards landed anyway — success, not an error. Re-throw the rest.
    if (isNothingToCommitError(err)) return;
    throw err;
  }
}
