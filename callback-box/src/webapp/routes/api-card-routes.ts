/**
 * Single-card read route for the REST API.
 *
 * Split out of `api.ts`. Owns the legacy XML read endpoint:
 *
 *   GET /api/card/* — load a card, return its xml + sanitized element tree
 *
 * The element-sanitization helper lives in `api-card-patch.ts`.
 */

import type { FastifyInstance } from "fastify";
import * as path from "node:path";
import { createLoader } from "../../cli/lib/loader.js";
import { sanitizeElement } from "./api-card-patch.js";

interface RegisterApiCardRoutesOptions {
  server: FastifyInstance;
  boxRoot: string;
}

/**
 * Register the `/api/card/*` GET + PATCH routes on the Fastify server.
 */
export function registerApiCardRoutes(options: RegisterApiCardRoutesOptions): void {
  const { server, boxRoot } = options;

  // GET /api/card/:path - Get a single card's content
  server.get<{ Params: { "*": string }; Querystring: { format?: string } }>(
    "/api/card/*",
    async (request, reply) => {
      const cardPath = request.params["*"];
      if (!cardPath) {
        return reply.status(400).send({ error: "Card path required" });
      }

      const fullPath = path.join(boxRoot, cardPath);
      const loader = await createLoader(boxRoot);

      try {
        const card = await loader.load(fullPath);
        const xml = loader.serialize(card.element);

        // Include element tree for tree view rendering
        const element = sanitizeElement(card.element);

        return {
          path: cardPath,
          tagName: card.element.tagName,
          status: card.element.attrs["status"],
          version: card.version,
          xml,
          element,
        };
      } catch (error) {
        const msg = (error as Error).message;
        const isNotFound = msg.includes("ENOENT") || msg.includes("no such file");
        return reply.status(isNotFound ? 404 : 422).send({
          error: isNotFound ? `Card not found: ${cardPath}` : `Card validation failed: ${cardPath}`,
          details: msg,
        });
      }
    }
  );
}
