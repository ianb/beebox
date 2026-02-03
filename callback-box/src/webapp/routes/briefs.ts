/**
 * News brief routes for the webapp.
 *
 * Provides endpoints for:
 * - Listing briefs (unread and read)
 * - Fetching a specific brief
 * - Marking a brief as read
 * - Submitting feedback
 * - Submitting query responses
 */

import type { FastifyInstance } from "fastify";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { CardLoader, type ElementNode } from "cardworks";
import { parseNewsBrief, type ParsedNewsBrief } from "../../schemas/news-brief.js";
import { parseNewsGuide, type ReactionSentiment } from "../../schemas/news-guide.js";
import { stageFiles, commit } from "../../cli/lib/git.js";

/**
 * Brief summary for the index.
 */
interface BriefSummary {
  path: string;
  relativePath: string;
  title: string;
  date: string;
  byline: string;
  /** Whether this brief has been read */
  read: boolean;
  /** How it was marked read: 'user' or 'expired' */
  readReason?: "user" | "expired" | undefined;
}

/**
 * Find all news brief cards in the box.
 */
async function findBriefs(boxRoot: string): Promise<{ path: string; read: boolean; readReason?: "user" | "expired" | undefined }[]> {
  const briefs: { path: string; read: boolean; readReason?: "user" | "expired" | undefined }[] = [];

  // Unread briefs in box/output/briefs/
  const unreadDir = path.join(boxRoot, "box/output/briefs");
  try {
    const files = await fs.readdir(unreadDir);
    for (const file of files) {
      if (file.endsWith(".news-brief.card")) {
        briefs.push({ path: path.join(unreadDir, file), read: false });
      }
    }
  } catch {
    // Directory doesn't exist
  }

  // Read briefs in store/archive/briefs/
  const readDir = path.join(boxRoot, "store/archive/briefs");
  try {
    const files = await fs.readdir(readDir);
    for (const file of files) {
      if (file.endsWith(".news-brief.card")) {
        // Check the card for read-reason attribute
        const fullPath = path.join(readDir, file);
        let readReason: "user" | "expired" | undefined;
        try {
          const loader = new CardLoader(boxRoot);
          const card = await loader.load(fullPath);
          readReason = card.element.attrs["read-reason"] as "user" | "expired" | undefined;
        } catch {
          // Ignore errors reading the card
        }
        briefs.push({ path: fullPath, read: true, readReason });
      }
    }
  } catch {
    // Directory doesn't exist
  }

  // Legacy locations for backwards compatibility
  const legacyDirs = [
    { dir: path.join(boxRoot, "box/output/editions"), read: false },
    { dir: path.join(boxRoot, "box/inbox/editions"), read: false },
    { dir: path.join(boxRoot, "store/archive/editions"), read: true },
  ];
  for (const { dir, read } of legacyDirs) {
    try {
      const files = await fs.readdir(dir);
      for (const file of files) {
        if (file.endsWith(".news-edition.card") || file.endsWith(".news-brief.card")) {
          briefs.push({ path: path.join(dir, file), read });
        }
      }
    } catch {
      // Directory doesn't exist
    }
  }

  // Sort by filename (date prefix) descending
  briefs.sort((a, b) => b.path.localeCompare(a.path));

  return briefs;
}

/**
 * Load a brief and extract summary info.
 */
async function loadBriefSummary(
  boxRoot: string,
  briefPath: string,
  read: boolean,
  readReason?: "user" | "expired"
): Promise<BriefSummary | null> {
  try {
    const loader = new CardLoader(boxRoot);
    const card = await loader.load(briefPath);

    if (card.element.tagName !== "news-brief" && card.element.tagName !== "news-edition") {
      return null;
    }

    const parsed = parseNewsBrief(card.element as any);

    return {
      path: briefPath,
      relativePath: path.relative(boxRoot, briefPath),
      title: parsed.title,
      date: parsed.date,
      byline: parsed.byline,
      read,
      readReason,
    };
  } catch (err) {
    console.error(`Failed to load brief ${briefPath}:`, err);
    return null;
  }
}

/**
 * Load a full brief.
 */
async function loadBrief(
  boxRoot: string,
  relativePath: string
): Promise<ParsedNewsBrief | null> {
  try {
    const fullPath = path.join(boxRoot, relativePath);
    const loader = new CardLoader(boxRoot);
    const card = await loader.load(fullPath);

    if (card.element.tagName !== "news-brief" && card.element.tagName !== "news-edition") {
      return null;
    }

    return parseNewsBrief(card.element as any);
  } catch (err) {
    console.error(`Failed to load brief ${relativePath}:`, err);
    return null;
  }
}

/**
 * Register brief routes on the Fastify server.
 */
export async function registerBriefRoutes(
  server: FastifyInstance,
  boxRoot: string
): Promise<void> {
  // GET /api/briefs - List all briefs
  server.get("/api/briefs", async () => {
    const briefInfos = await findBriefs(boxRoot);
    const briefs: BriefSummary[] = [];

    for (const info of briefInfos) {
      const summary = await loadBriefSummary(boxRoot, info.path, info.read, info.readReason);
      if (summary) {
        briefs.push(summary);
      }
    }

    return { briefs };
  });

  // Legacy endpoint for backwards compatibility
  server.get("/api/editions", async () => {
    const briefInfos = await findBriefs(boxRoot);
    const editions: BriefSummary[] = [];

    for (const info of briefInfos) {
      const summary = await loadBriefSummary(boxRoot, info.path, info.read, info.readReason);
      if (summary) {
        editions.push(summary);
      }
    }

    return { editions };
  });

  // GET /api/brief/:path - Get a specific brief
  server.get<{ Params: { path: string } }>(
    "/api/brief/:path",
    async (request, reply) => {
      const relativePath = decodeURIComponent(request.params.path);
      const brief = await loadBrief(boxRoot, relativePath);

      if (!brief) {
        return reply.status(404).send({ error: "Brief not found" });
      }

      return { brief };
    }
  );

  // Legacy endpoint
  server.get<{ Params: { path: string } }>(
    "/api/edition/:path",
    async (request, reply) => {
      const relativePath = decodeURIComponent(request.params.path);
      const edition = await loadBrief(boxRoot, relativePath);

      if (!edition) {
        return reply.status(404).send({ error: "Edition not found" });
      }

      return { edition };
    }
  );

  // POST /api/brief/mark-read - Mark a brief as read
  server.post<{
    Body: {
      briefPath: string;
    };
  }>("/api/brief/mark-read", async (request, reply) => {
    const { briefPath } = request.body ?? {};

    if (!briefPath) {
      return reply.status(400).send({ error: "Missing briefPath" });
    }

    const fullPath = path.join(boxRoot, briefPath);

    // Check if brief exists and is in unread location
    try {
      await fs.access(fullPath);
    } catch {
      return reply.status(404).send({ error: "Brief not found" });
    }

    // Only move if it's in the unread location
    if (!briefPath.startsWith("box/output/briefs/") && !briefPath.startsWith("box/output/editions/")) {
      return reply.status(400).send({ error: "Brief is not in unread location" });
    }

    // Add read-at and read-reason attributes to the card
    const loader = new CardLoader(boxRoot);
    const card = await loader.load(fullPath);
    card.element.attrs["read-at"] = new Date().toISOString();
    card.element.attrs["read-reason"] = "user";
    await loader.save(card);

    // Determine destination
    const filename = path.basename(briefPath);
    const archiveDir = path.join(boxRoot, "store/archive/briefs");
    await fs.mkdir(archiveDir, { recursive: true });
    const newPath = path.join(archiveDir, filename);

    // Move the file
    await fs.rename(fullPath, newPath);

    // Commit
    const newRelativePath = path.relative(boxRoot, newPath);
    await stageFiles(boxRoot, [briefPath, newRelativePath]);
    await commit(boxRoot, {
      message: "Mark brief as read",
      trailers: {
        "Source": "webapp",
        "Endpoint": "/api/brief/mark-read",
      },
    });

    return { success: true, newPath: newRelativePath };
  });

  // POST /api/brief/feedback - Submit feedback on a brief (text or voice)
  server.post<{
    Body: {
      briefPath: string;
      targetId: string;
      comment?: string;
      audioData?: string;
      audioMimeType?: string;
    };
  }>("/api/brief/feedback", {
    bodyLimit: 50 * 1024 * 1024,
  }, async (request, reply) => {
    const { briefPath, targetId, comment, audioData, audioMimeType } = request.body ?? {};

    if (!briefPath || !targetId) {
      return reply.status(400).send({ error: "Missing required fields" });
    }

    const isVoice = !!audioData;
    if (!isVoice && !comment) {
      return reply.status(400).send({ error: "Either comment or audioData is required" });
    }

    const feedbackDir = path.join(boxRoot, "box/inbox/feedback");
    await fs.mkdir(feedbackDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const baseName = `brief_feedback_${timestamp}`;
    const feedbackPath = path.join(feedbackDir, `${baseName}.feedback.card`);

    if (isVoice && audioData) {
      const ext = audioMimeType?.includes("webm") ? ".webm" : ".m4a";
      const audioPath = path.join(feedbackDir, `${baseName}${ext}`);
      const audioBuffer = Buffer.from(audioData, "base64");
      await fs.writeFile(audioPath, audioBuffer);
    }

    const feedbackContent = `<feedback type="brief">
  <target ref="${briefPath}#${targetId}" />
  <source>${isVoice ? "voice" : "text"}</source>
  <comment>${isVoice ? "" : escapeXml(comment ?? "")}</comment>
  <timestamp>${new Date().toISOString()}</timestamp>
</feedback>
`;

    await fs.writeFile(feedbackPath, feedbackContent);

    const filesToStage = [path.relative(boxRoot, feedbackPath)];
    if (isVoice && audioData) {
      const ext = audioMimeType?.includes("webm") ? ".webm" : ".m4a";
      filesToStage.push(`box/inbox/feedback/${baseName}${ext}`);
    }
    await stageFiles(boxRoot, filesToStage);
    await commit(boxRoot, {
      message: "Add brief feedback",
      trailers: {
        "Source": "webapp",
        "Endpoint": "/api/brief/feedback",
        "Type": isVoice ? "voice" : "text",
      },
    });

    return { success: true, path: feedbackPath, isVoice };
  });

  // Legacy endpoint
  server.post<{
    Body: {
      editionPath: string;
      targetId: string;
      comment?: string;
      audioData?: string;
      audioMimeType?: string;
    };
  }>("/api/edition/feedback", {
    bodyLimit: 50 * 1024 * 1024,
  }, async (request, reply) => {
    const { editionPath, targetId, comment, audioData, audioMimeType } = request.body ?? {};
    // Redirect to new endpoint
    request.body = { briefPath: editionPath, targetId, comment, audioData, audioMimeType } as any;
    return server.inject({
      method: "POST",
      url: "/api/brief/feedback",
      payload: { briefPath: editionPath, targetId, comment, audioData, audioMimeType },
    });
  });

  // POST /api/brief/query-response - Submit a query response
  server.post<{
    Body: {
      briefPath: string;
      queryId: string;
      response?: string;
      audioData?: string;
      audioMimeType?: string;
    };
  }>("/api/brief/query-response", {
    bodyLimit: 50 * 1024 * 1024,
  }, async (request, reply) => {
    const { briefPath, queryId, response, audioData, audioMimeType } = request.body ?? {};

    if (!briefPath || !queryId) {
      return reply.status(400).send({ error: "Missing required fields" });
    }

    const isVoice = !!audioData;
    if (!isVoice && !response) {
      return reply.status(400).send({ error: "Either response or audioData is required" });
    }

    const feedbackDir = path.join(boxRoot, "box/inbox/feedback");
    await fs.mkdir(feedbackDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const baseName = `query_response_${timestamp}`;
    const responsePath = path.join(feedbackDir, `${baseName}.feedback.card`);

    if (isVoice && audioData) {
      const ext = audioMimeType?.includes("webm") ? ".webm" : ".m4a";
      const audioPath = path.join(feedbackDir, `${baseName}${ext}`);
      const audioBuffer = Buffer.from(audioData, "base64");
      await fs.writeFile(audioPath, audioBuffer);
    }

    const responseContent = `<feedback type="query-response">
  <target ref="${briefPath}#${queryId}" />
  <source>${isVoice ? "voice" : "text"}</source>
  <response>${isVoice ? "" : escapeXml(response ?? "")}</response>
  <timestamp>${new Date().toISOString()}</timestamp>
</feedback>
`;

    await fs.writeFile(responsePath, responseContent);

    const filesToStage = [path.relative(boxRoot, responsePath)];
    if (isVoice && audioData) {
      const ext = audioMimeType?.includes("webm") ? ".webm" : ".m4a";
      filesToStage.push(`box/inbox/feedback/${baseName}${ext}`);
    }
    await stageFiles(boxRoot, filesToStage);
    await commit(boxRoot, {
      message: "Add query response",
      trailers: {
        "Source": "webapp",
        "Endpoint": "/api/brief/query-response",
        "Type": isVoice ? "voice" : "text",
      },
    });

    return { success: true, path: responsePath, isVoice };
  });

  // Legacy endpoint
  server.post<{
    Body: {
      editionPath: string;
      queryId: string;
      response?: string;
      audioData?: string;
      audioMimeType?: string;
    };
  }>("/api/edition/query-response", {
    bodyLimit: 50 * 1024 * 1024,
  }, async (request, reply) => {
    const { editionPath, queryId, response, audioData, audioMimeType } = request.body ?? {};
    return server.inject({
      method: "POST",
      url: "/api/brief/query-response",
      payload: { briefPath: editionPath, queryId, response, audioData, audioMimeType },
    });
  });

  // GET /api/news-guide/reactions - Get reader reactions from the guide
  server.get("/api/news-guide/reactions", async (request, reply) => {
    const guidePath = path.join(boxRoot, "config/news-guide.news-guide.card");

    try {
      await fs.access(guidePath);
    } catch {
      // No guide exists yet, return empty reactions
      return { reactions: [] };
    }

    try {
      const loader = new CardLoader(boxRoot);
      const card = await loader.load(guidePath);
      const parsed = parseNewsGuide(card.element as any);

      return {
        reactions: parsed.readerReactions.map((r) => ({
          id: r.id,
          sentiment: r.sentiment,
          text: r.text,
        })),
      };
    } catch (err) {
      console.error("Failed to load news guide:", err);
      return { reactions: [] };
    }
  });

  // POST /api/brief/complete-reading - Complete reading a brief with feedback
  server.post<{
    Body: {
      briefPath: string;
      overallRating: "great" | "ok" | "meh";
      selectedReactions: Array<{ id: string; source: "guide" | "brief" }>;
      itemFeedback: Array<{ id: string; feedback: "thumbs-up" | "thumbs-down" }>;
    };
  }>("/api/brief/complete-reading", async (request, reply) => {
    const { briefPath, overallRating, selectedReactions, itemFeedback } = request.body ?? {};

    if (!briefPath || !overallRating) {
      return reply.status(400).send({ error: "Missing required fields: briefPath and overallRating" });
    }

    const fullPath = path.join(boxRoot, briefPath);

    // Check if brief exists
    try {
      await fs.access(fullPath);
    } catch {
      return reply.status(404).send({ error: "Brief not found" });
    }

    // Only accept briefs from unread location
    if (!briefPath.startsWith("box/output/briefs/") && !briefPath.startsWith("box/output/editions/")) {
      return reply.status(400).send({ error: "Brief is not in unread location" });
    }

    // Load and update the brief
    const loader = new CardLoader(boxRoot);
    const card = await loader.load(fullPath);

    // Set root-level feedback attributes
    card.element.attrs["overall-rating"] = overallRating;
    card.element.attrs["read-at"] = new Date().toISOString();
    card.element.attrs["read-reason"] = "user";

    // Set selected reactions as comma-separated IDs
    if (selectedReactions && selectedReactions.length > 0) {
      card.element.attrs["selected-reactions"] = selectedReactions.map((r) => r.id).join(",");
    }

    // Apply item feedback (thumbs up/down) to sections and expandos
    if (itemFeedback && itemFeedback.length > 0) {
      const feedbackMap = new Map(itemFeedback.map((f) => [f.id, f.feedback]));
      updateElementFeedback(card.element, feedbackMap);
    }

    // Save the updated card
    await loader.save(card);

    // Move to archive using cardworks (updates references in other cards)
    const filename = path.basename(briefPath);
    const archiveDir = path.join(boxRoot, "store/archive/briefs");
    await fs.mkdir(archiveDir, { recursive: true });
    const newPath = path.join(archiveDir, filename);

    // Use loader.move() to update references pointing to this brief
    const { result: moveResult } = await loader.move(card, newPath);

    // Commit changes - include any cards that had references updated
    const newRelativePath = path.relative(boxRoot, newPath);
    const filesToStage = [briefPath, newRelativePath];

    // Add any cards that had references updated
    for (const updated of moveResult.updatedCards) {
      filesToStage.push(path.relative(boxRoot, updated.path));
    }
    // Add any related files that were moved (attachments)
    for (const moved of moveResult.movedFiles) {
      if (moved.from !== fullPath) {
        filesToStage.push(path.relative(boxRoot, moved.from));
        filesToStage.push(path.relative(boxRoot, moved.to));
      }
    }
    await stageFiles(boxRoot, [briefPath, newRelativePath]);
    await commit(boxRoot, {
      message: `Complete reading: ${overallRating}`,
      trailers: {
        "Source": "webapp",
        "Endpoint": "/api/brief/complete-reading",
        "Rating": overallRating,
        "Reactions": selectedReactions?.length?.toString() ?? "0",
        "Thumbs": itemFeedback?.length?.toString() ?? "0",
      },
    });

    return {
      success: true,
      newPath: newRelativePath,
    };
  });
}

/**
 * Recursively update user-feedback attributes on sections and expandos.
 */
function updateElementFeedback(
  element: ElementNode,
  feedbackMap: Map<string, "thumbs-up" | "thumbs-down">
): void {
  // Check if this element has an ID and feedback for it
  const id = element.attrs?.id as string | undefined;
  if (id) {
    const feedback = feedbackMap.get(id);
    if (feedback) {
      element.attrs = element.attrs || {};
      element.attrs["user-feedback"] = feedback;
    }
  }

  // Recurse into children
  if (element.children && Array.isArray(element.children)) {
    for (const child of element.children) {
      if (typeof child === "object" && child !== null && "tagName" in child) {
        updateElementFeedback(child as ElementNode, feedbackMap);
      }
    }
  }
}

/**
 * Escape special XML characters in text.
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
