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
import { createDropboxMemoTemplate } from "../../schemas/memo.js";
import { createRecordTemplate } from "../../schemas/record.js";
import { safeFilename } from "../../connectors/chat-utils.js";
import { stageFiles, commit } from "../../cli/lib/git.js";

const memoSchema = z.object({
  text: z.string().min(1),
  context: z
    .object({
      url: z.string().url().optional(),
      title: z.string().optional(),
      selectedText: z.string().optional(),
    })
    .optional(),
  url: z.string().url().optional(),
  timestamp: z.string().optional(),
});

const savePageSchema = z.object({
  intent: z.enum(["save", "do"]),
  url: z.string().url(),
  title: z.string().min(1),
  siteName: z.string().optional(),
  byline: z.string().optional(),
  excerpt: z.string().optional(),
  markdown: z.string().min(1),
  frozenHtml: z.string().optional(),
  selectedText: z.string().optional(),
  timestamp: z.string().optional(),
});

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

  server.post("/api/clerk/memo", async (request, reply) => {
    applyExtensionCors(request, reply);
    const parsed = memoSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid memo payload" });
    }

    const { text, context, timestamp } = parsed.data;
    const created = timestamp ?? new Date().toISOString();
    const title = text.slice(0, 80);
    const filename = buildFilename(title, "Memo");
    const relPath = path.join("box/inbox", `${filename}.memo.card`);
    const absPath = path.join(boxRoot, relPath);

    const content = createDropboxMemoTemplate({
      content: text,
      timestamp: created,
      context: context ?? (parsed.data.url ? { url: parsed.data.url } : undefined),
    });

    await writeCard(absPath, content);
    await gitCommit(boxRoot, { relPaths: [relPath], message: `Add memo from Clerk: "${title}"` });

    return { created: relPath };
  });

  server.post("/api/clerk/save-page", async (request, reply) => {
    applyExtensionCors(request, reply);
    const parsed = savePageSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid page payload" });
    }

    const data = parsed.data;
    const intentDir =
      data.intent === "do" ? "box/inbox/pages-todo" : "box/inbox/pages-saved";
    const filename = buildFilename(data.title, "Page");
    const relPath = path.join(intentDir, `${filename}.record.card`);
    const absPath = path.join(boxRoot, relPath);

    const sources: Array<{ ref: string; text?: string }> = [
      {
        ref: data.url,
        text: [data.siteName, data.byline].filter(Boolean).join(" — ") || "Saved from browser",
      },
    ];

    const record = createRecordTemplate({
      name: data.title,
      content: data.markdown,
      sources,
      description: data.excerpt,
    });

    await writeCard(absPath, record);

    const createdPaths = [relPath];

    if (data.frozenHtml) {
      const frozenRel = path.join(intentDir, `${filename}.frozen`);
      await writeCard(path.join(boxRoot, frozenRel), data.frozenHtml);
      createdPaths.push(frozenRel);
    }

    await gitCommit(boxRoot, { relPaths: createdPaths, message: `Add saved page from Clerk: "${data.title}"` });

    return { created: createdPaths };
  });

  server.post("/api/clerk/tabs", async (request, reply) => {
    applyExtensionCors(request, reply);
    // Tabs are currently used only for UI context; store latest snapshot for reference.
    try {
      const body = JSON.stringify(
        {
          receivedAt: new Date().toISOString(),
          payload: request.body,
        },
        null,
        2,
      );
      await fs.mkdir(path.join(boxRoot, ".callback-box"), { recursive: true });
      await fs.writeFile(path.join(boxRoot, ".callback-box/clerk-tabs.json"), body);
    } catch (err) {
      console.error("[clerk] Failed to persist tab snapshot:", err);
    }

    return { ok: true };
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
