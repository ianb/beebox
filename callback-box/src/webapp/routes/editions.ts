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
  status: string;
}

/**
 * Find all news edition cards in the box.
 */
async function findEditions(boxRoot: string): Promise<string[]> {
  const editionPaths: string[] = [];

  // Look in box/inbox/editions/ and store/archive/editions/
  const searchDirs = [
    path.join(boxRoot, "box/inbox/editions"),
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
      status: parsed.status,
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

  // POST /api/edition/feedback - Submit feedback on an edition
  server.post<{
    Body: {
      editionPath: string;
      targetId: string;
      comment: string;
    };
  }>("/api/edition/feedback", async (request, reply) => {
    const { editionPath, targetId, comment } = request.body ?? {};

    if (!editionPath || !targetId || !comment) {
      return reply.status(400).send({ error: "Missing required fields" });
    }

    // For now, store feedback as a separate card
    // TODO: Implement proper feedback storage
    const feedbackDir = path.join(boxRoot, "box/inbox/feedback");
    await fs.mkdir(feedbackDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const feedbackPath = path.join(
      feedbackDir,
      `edition_feedback_${timestamp}.feedback.card`
    );

    const feedbackContent = `<feedback type="edition">
  <edition-path>${editionPath}</edition-path>
  <target-id>${targetId}</target-id>
  <comment>${comment}</comment>
  <timestamp>${new Date().toISOString()}</timestamp>
</feedback>
`;

    await fs.writeFile(feedbackPath, feedbackContent);

    return { success: true, path: feedbackPath };
  });

  // POST /api/edition/query-response - Submit a query response
  server.post<{
    Body: {
      editionPath: string;
      queryId: string;
      response: string;
    };
  }>("/api/edition/query-response", async (request, reply) => {
    const { editionPath, queryId, response } = request.body ?? {};

    if (!editionPath || !queryId || !response) {
      return reply.status(400).send({ error: "Missing required fields" });
    }

    // Store query response as a card
    const feedbackDir = path.join(boxRoot, "box/inbox/feedback");
    await fs.mkdir(feedbackDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const responsePath = path.join(
      feedbackDir,
      `query_response_${timestamp}.feedback.card`
    );

    const responseContent = `<feedback type="query-response">
  <edition-path>${editionPath}</edition-path>
  <query-id>${queryId}</query-id>
  <response>${response}</response>
  <timestamp>${new Date().toISOString()}</timestamp>
</feedback>
`;

    await fs.writeFile(responsePath, responseContent);

    return { success: true, path: responsePath };
  });
}
