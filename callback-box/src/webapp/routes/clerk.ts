/**
 * Clerk API routes - endpoints for the browser extension.
 *
 * Replaces the old relay by letting the extension
 * call box-hosted HTTP APIs directly once the user is authenticated.
 */

import type { FastifyInstance, FastifyReply } from "fastify";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { createWebpageTemplate } from "../../schemas/webpage.js";
import { createCommentaryTemplate } from "../../schemas/commentary.js";
import { attachmentPath } from "../../lib/attach-path.js";
import { listDestinations } from "../../core/landmark/list-destinations.js";
import { safeFilename } from "../../connectors/chat-utils.js";
import { stageFiles, commit } from "../../cli/lib/git.js";

const commentarySchema = z.object({
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

interface RegisterClerkRoutesOptions {
  server: FastifyInstance;
  boxRoot: string;
}

export async function registerClerkRoutes(
  options: RegisterClerkRoutesOptions,
): Promise<void> {
  const { server, boxRoot } = options;

  server.options("/api/clerk/*", async (request, reply) => {
    applyExtensionCors(request, reply);
    return reply
      .header("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS")
      .header("Access-Control-Allow-Headers", "Content-Type")
      .send();
  });

  server.get("/api/clerk/commentary-destinations", async (request, reply) => {
    applyExtensionCors(request, reply);
    const destinations = await listDestinations(boxRoot, "commentary");
    return { destinations };
  });

  server.post("/api/clerk/commentary", async (request, reply) => {
    applyExtensionCors(request, reply);
    const parsed = commentarySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid commentary payload" });
    }

    const data = parsed.data;
    const capturedAt = data.timestamp ?? new Date().toISOString();

    // A provided destination must be a real commentary destination; otherwise
    // file into the inbox. Validating here turns a stale/typo'd dir into a
    // clear 400 rather than a card silently landing somewhere unexpected.
    let destDir = DEFAULT_COMMENTARY_DIR;
    if (data.destinationDir !== undefined && data.destinationDir !== "") {
      const destinations = await listDestinations(boxRoot, "commentary");
      const match = destinations.find((d) => d.dir === data.destinationDir);
      if (match === undefined) {
        return reply
          .status(400)
          .send({ error: `Unknown commentary destination: ${data.destinationDir}` });
      }
      destDir = data.destinationDir;
    }

    const filename = buildFilename(data.title, "Page");
    const cardRel = path.join(destDir, `${filename}.webpage.card`);

    // The captured page is the webpage card (readable body + frozen snapshot).
    const createdPaths = await writeWebpageCard({
      boxRoot,
      cardRel,
      title: data.title,
      url: data.url,
      capturedAt,
      markdown: data.readableMarkdown,
      siteName: data.siteName,
      byline: data.byline,
      excerpt: data.excerpt,
      frozenHtml: data.frozenHtml,
    });

    // The commentary is a separate card inside the webpage's attach scope: it
    // belongs to the page (moves/dies with it). Empty to start — the chat agent
    // authors the {% source %} anchors. The webpage view surfaces it inline.
    const commentaryRel = attachmentPath(cardRel, `${filename}.commentary.card`);
    await writeCard(
      path.join(boxRoot, commentaryRel),
      createCommentaryTemplate({ title: data.title }),
    );
    createdPaths.push(commentaryRel);

    await gitCommit(boxRoot, {
      relPaths: createdPaths,
      message: `Add commentary from Clerk: "${data.title}"`,
    });

    // Open the webpage card in a chat companion pane (it renders the page plus
    // its inline commentary), with the chat scoped to the destination dir.
    // Returned relative to the box URL — the extension joins it onto box.boxUrl.
    const companion = `view:${cardRel}`;
    const open =
      `chat?session=new&contextDir=${encodeURIComponent(destDir)}` +
      `&companion=${encodeURIComponent(companion)}`;
    return { created: createdPaths, open };
  });

  server.get("/api/clerk/actions", async (request, reply) => {
    applyExtensionCors(request, reply);
    // Placeholder — no outbound actions yet.
    return { actions: [] };
  });

  server.post<{ Params: { id: string } }>("/api/clerk/actions/:id/dismiss", async (request, reply) => {
    applyExtensionCors(request, reply);
    // No-op placeholder so the client can clear actions once real ones exist.
    return { dismissed: request.params.id };
  });
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

/**
 * Write a `.webpage.card` (readable body + capture provenance) and, when a
 * frozen snapshot is provided, `<card>.attach/page.frozen` beside it. Returns
 * the box-relative paths written, in commit order. Shared by save-page and
 * commentary capture — both produce the same captured-page artifact.
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
  await stageFiles(boxRoot, relPaths);
  await commit(boxRoot, {
    message,
    trailers: {
      "Created-By": "clerk-api",
    },
  });
}

function applyExtensionCors(request: { headers: Record<string, string | string[] | undefined> }, reply: FastifyReply): void {
  const origin = request.headers.origin;
  if (typeof origin === "string" && origin.startsWith("chrome-extension://")) {
    reply.header("Access-Control-Allow-Origin", origin);
    reply.header("Access-Control-Allow-Credentials", "true");
    reply.header("Vary", "Origin");
  }
}
