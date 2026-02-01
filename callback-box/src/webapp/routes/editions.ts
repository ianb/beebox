/**
 * News edition routes for the webapp.
 *
 * Provides endpoints for:
 * - Listing editions
 * - Fetching a specific edition
 * - Submitting feedback
 * - Submitting query responses
 */

import type { FastifyInstance } from "fastify";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { CardLoader } from "cardworks";
import { parseNewsEdition, type ParsedNewsEdition } from "../../schemas/news-edition.js";

/**
 * Edition summary for the index.
 */
interface EditionSummary {
  path: string;
  relativePath: string;
  title: string;
  date: string;
  byline: string;
}

/**
 * Find all news edition cards in the box.
 */
async function findEditions(boxRoot: string): Promise<string[]> {
  const editionPaths: string[] = [];

  // Look in box/output/editions/ and store/archive/editions/
  const searchDirs = [
    path.join(boxRoot, "box/output/editions"),
    path.join(boxRoot, "box/inbox/editions"), // Legacy location
    path.join(boxRoot, "box/inbox/summaries"), // Legacy location
    path.join(boxRoot, "store/archive/editions"),
  ];

  for (const dir of searchDirs) {
    try {
      const files = await fs.readdir(dir);
      for (const file of files) {
        if (file.endsWith(".news-edition.card")) {
          editionPaths.push(path.join(dir, file));
        }
      }
    } catch {
      // Directory doesn't exist, skip
    }
  }

  // Sort by filename (date prefix) descending
  editionPaths.sort().reverse();

  return editionPaths;
}

/**
 * Load an edition and extract summary info.
 */
async function loadEditionSummary(
  boxRoot: string,
  editionPath: string
): Promise<EditionSummary | null> {
  try {
    const loader = new CardLoader(boxRoot);
    const card = await loader.load(editionPath);

    if (card.element.tagName !== "news-edition") {
      return null;
    }

    const parsed = parseNewsEdition(card.element as any);

    return {
      path: editionPath,
      relativePath: path.relative(boxRoot, editionPath),
      title: parsed.title,
      date: parsed.date,
      byline: parsed.byline,
    };
  } catch (err) {
    console.error(`Failed to load edition ${editionPath}:`, err);
    return null;
  }
}

/**
 * Load a full edition.
 */
async function loadEdition(
  boxRoot: string,
  relativePath: string
): Promise<ParsedNewsEdition | null> {
  try {
    const fullPath = path.join(boxRoot, relativePath);
    const loader = new CardLoader(boxRoot);
    const card = await loader.load(fullPath);

    if (card.element.tagName !== "news-edition") {
      return null;
    }

    return parseNewsEdition(card.element as any);
  } catch (err) {
    console.error(`Failed to load edition ${relativePath}:`, err);
    return null;
  }
}

/**
 * Register edition routes on the Fastify server.
 */
export async function registerEditionRoutes(
  server: FastifyInstance,
  boxRoot: string
): Promise<void> {
  // GET /api/editions - List all editions
  server.get("/api/editions", async () => {
    const editionPaths = await findEditions(boxRoot);
    const editions: EditionSummary[] = [];

    for (const editionPath of editionPaths) {
      const summary = await loadEditionSummary(boxRoot, editionPath);
      if (summary) {
        editions.push(summary);
      }
    }

    return { editions };
  });

  // GET /api/edition/:path - Get a specific edition
  server.get<{ Params: { path: string } }>(
    "/api/edition/:path",
    async (request, reply) => {
      const relativePath = decodeURIComponent(request.params.path);
      const edition = await loadEdition(boxRoot, relativePath);

      if (!edition) {
        return reply.status(404).send({ error: "Edition not found" });
      }

      return { edition };
    }
  );

  // POST /api/edition/feedback - Submit feedback on an edition (text or voice)
  server.post<{
    Body: {
      editionPath: string;
      targetId: string;
      comment?: string;
      audioData?: string; // Base64-encoded audio for voice feedback
      audioMimeType?: string;
    };
  }>("/api/edition/feedback", async (request, reply) => {
    const { editionPath, targetId, comment, audioData, audioMimeType } = request.body ?? {};

    if (!editionPath || !targetId) {
      return reply.status(400).send({ error: "Missing required fields" });
    }

    const isVoice = !!audioData;
    if (!isVoice && !comment) {
      return reply.status(400).send({ error: "Either comment or audioData is required" });
    }

    const feedbackDir = path.join(boxRoot, "box/inbox/feedback");
    await fs.mkdir(feedbackDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const baseName = `edition_feedback_${timestamp}`;
    const feedbackPath = path.join(feedbackDir, `${baseName}.feedback.card`);

    // For voice feedback, save the audio file
    if (isVoice && audioData) {
      const ext = audioMimeType?.includes("webm") ? ".webm" : ".m4a";
      const audioPath = path.join(feedbackDir, `${baseName}${ext}`);
      const audioBuffer = Buffer.from(audioData, "base64");
      await fs.writeFile(audioPath, audioBuffer);
    }

    const feedbackContent = `<feedback type="edition">
  <target ref="${editionPath}#${targetId}" />
  <source>${isVoice ? "voice" : "text"}</source>
  <comment>${isVoice ? "" : escapeXml(comment ?? "")}</comment>
  <timestamp>${new Date().toISOString()}</timestamp>
</feedback>
`;

    await fs.writeFile(feedbackPath, feedbackContent);

    return { success: true, path: feedbackPath, isVoice };
  });

  // POST /api/edition/query-response - Submit a query response (text or voice)
  server.post<{
    Body: {
      editionPath: string;
      queryId: string;
      response?: string;
      audioData?: string; // Base64-encoded audio for voice response
      audioMimeType?: string;
    };
  }>("/api/edition/query-response", async (request, reply) => {
    const { editionPath, queryId, response, audioData, audioMimeType } = request.body ?? {};

    if (!editionPath || !queryId) {
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

    // For voice feedback, save the audio file
    if (isVoice && audioData) {
      const ext = audioMimeType?.includes("webm") ? ".webm" : ".m4a";
      const audioPath = path.join(feedbackDir, `${baseName}${ext}`);
      const audioBuffer = Buffer.from(audioData, "base64");
      await fs.writeFile(audioPath, audioBuffer);
    }

    const responseContent = `<feedback type="query-response">
  <target ref="${editionPath}#${queryId}" />
  <source>${isVoice ? "voice" : "text"}</source>
  <response>${isVoice ? "" : escapeXml(response ?? "")}</response>
  <timestamp>${new Date().toISOString()}</timestamp>
</feedback>
`;

    await fs.writeFile(responsePath, responseContent);

    return { success: true, path: responsePath, isVoice };
  });
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
