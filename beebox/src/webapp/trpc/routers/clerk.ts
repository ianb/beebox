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
import type { z } from "zod";
import { router, publicProcedure, authedProcedure } from "../procedures.js";
import {
  commentaryInput,
  commentaryOutput,
  commentaryDestinationsOutput,
  tabArrangementPayload,
  tabArrangementOutput,
} from "../clerk-contract.js";
import { createWebpageTemplate } from "../../../schemas/webpage.js";
import { createCommentaryTemplate } from "../../../schemas/commentary.js";
import { attachmentPath } from "../../../shared/attach-path.js";
import { listDestinations } from "../../../core/landmark/list-destinations.js";
import { safeFilename } from "../../../job-cards/chat-utils.js";
import { stageAndCommitPaths } from "../../../lib/git/core.js";
import { createTabArrangementCard } from "../../../schemas/tab-arrangement.js";
import { parseFrontmatterObject } from "../../../exports/cards.js";
import { withCardLock } from "../../../lib/card-lock.js";
import { errnoCode } from "../../../shared/error-guards.js";
import { isRecord } from "../../../shared/is-record.js";
import { BOX_DIRS } from "../../../lib/paths/core.js";

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

    const captureId = input.captureId;
    if (captureId === undefined) {
      return writeCommentaryCapture({ boxRoot, destDir, capturedAt, input });
    }
    // Serialize same-id retries so two in-flight attempts can't both miss the
    // lookup. The card's name comes from the title + server time, so the lock
    // key is the capture id's slot in the destination, not the card path.
    return withCardLock(path.join(boxRoot, destDir, `.clerk-capture-${captureId}`), async () => {
      const existing = await findCaptureCard({ boxRoot, destDir, captureId });
      if (existing !== null) {
        if (existing.url !== input.url) {
          throw new TRPCError({ code: "CONFLICT", message: "Capture ID already belongs to a different page" });
        }
        return commentaryResult(destDir, await existingCapturePaths(boxRoot, existing.relPath));
      }
      return writeCommentaryCapture({ boxRoot, destDir, capturedAt, input });
    });
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
            JSON.stringify(fields["captured-tabs"]) === JSON.stringify(input.source);
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

const WEBPAGE_SUFFIX = ".webpage.card";

async function writeCommentaryCapture(opts: {
  boxRoot: string;
  destDir: string;
  capturedAt: string;
  input: z.infer<typeof commentaryInput>;
}): Promise<z.infer<typeof commentaryOutput>> {
  const { boxRoot, destDir, input } = opts;
  const filename = buildFilename(input.title, "Page");
  const cardRel = path.join(destDir, `${filename}${WEBPAGE_SUFFIX}`);

  // The captured page is the webpage card (readable body + frozen snapshot).
  const createdPaths = await writeWebpageCard({
    boxRoot,
    cardRel,
    title: input.title,
    url: input.url,
    capturedAt: opts.capturedAt,
    markdown: input.readableMarkdown,
    siteName: input.siteName,
    byline: input.byline,
    excerpt: input.excerpt,
    frozenHtml: input.frozenHtml,
    captureId: input.captureId,
  });

  // The commentary is a separate card inside the webpage's attach scope: it
  // belongs to the page (moves/dies with it). Empty to start — the chat agent
  // authors the {% source %} anchors. The webpage view surfaces it inline.
  const commentaryRel = commentaryPathFor(cardRel);
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
  return commentaryResult(destDir, createdPaths);
}

/**
 * Open the webpage card in a chat companion pane, chat scoped to the dest dir.
 * Returned relative to the box URL — the extension joins it onto boxUrl.
 */
function commentaryResult(destDir: string, created: string[]): z.infer<typeof commentaryOutput> {
  const companion = `view:${created[0] ?? ""}`;
  const open =
    `chat?session=new&contextDir=${encodeURIComponent(destDir)}` +
    `&companion=${encodeURIComponent(companion)}`;
  return { created, open };
}

function commentaryPathFor(cardRel: string): string {
  const filename = path.basename(cardRel, WEBPAGE_SUFFIX);
  return attachmentPath(cardRel, `${filename}.commentary.card`);
}

/**
 * The webpage card in `destDir` carrying `captureId`, or null. Scoped to the
 * destination's own webpage cards: a retry lands in the same dir seconds
 * later, so a box-wide scan would only add cost.
 */
async function findCaptureCard(opts: {
  boxRoot: string;
  destDir: string;
  captureId: string;
}): Promise<{ relPath: string; url: unknown } | null> {
  let names: string[];
  try {
    names = await fs.readdir(path.join(opts.boxRoot, opts.destDir));
  } catch (error) {
    if (errnoCode(error) === "ENOENT") return null;
    throw error;
  }
  const matches: Array<{ relPath: string; url: unknown }> = [];
  for (const name of names.filter((n) => n.endsWith(WEBPAGE_SUFFIX))) {
    const relPath = path.join(opts.destDir, name);
    const fields = parseFrontmatterObject(await fs.readFile(path.join(opts.boxRoot, relPath), "utf-8"));
    if (fields?.["capture-id"] !== opts.captureId) continue;
    const sources = fields["sources"];
    const first: unknown = Array.isArray(sources) ? sources[0] : undefined;
    matches.push({ relPath, url: isRecord(first) ? first["href"] : undefined });
  }
  if (matches.length > 1) {
    throw new TRPCError({ code: "CONFLICT", message: "Capture ID appears on more than one webpage card" });
  }
  return matches[0] ?? null;
}

/** The paths a prior capture wrote, in the same order a fresh capture reports them. */
async function existingCapturePaths(boxRoot: string, cardRel: string): Promise<string[]> {
  const candidates = [cardRel, attachmentPath(cardRel, "page.frozen"), commentaryPathFor(cardRel)];
  const present: string[] = [];
  for (const rel of candidates) {
    if ((await readIfPresent(path.join(boxRoot, rel))) !== undefined) present.push(rel);
  }
  return present;
}

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
  captureId?: string | undefined;
}): Promise<string[]> {
  const frozen = opts.frozenHtml;
  const hasFrozen = typeof frozen === "string" && frozen !== "";
  const card = createWebpageTemplate({
    title: opts.title,
    url: opts.url,
    capturedAt: opts.capturedAt,
    content: opts.markdown,
    siteName: opts.siteName,
    byline: opts.byline,
    excerpt: opts.excerpt,
    frozenRef: hasFrozen ? "attach/page.frozen" : undefined,
    captureId: opts.captureId,
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
