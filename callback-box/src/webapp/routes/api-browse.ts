/**
 * Directory-browse route for the REST API.
 *
 * Split out of `api.ts`. Owns `GET /api/browse/*` — a one-level listing of a
 * box directory that folds `<basename>.attach/` directories into their owning
 * cards and loads each card so the frontend can render its status.
 */

import type { FastifyInstance } from "fastify";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { loadCardFrontmatter } from "../../core/frontmatter-field.js";
import { parseCardName } from "../../cli/lib/paths.js";

interface BrowseCard {
  relativePath: string;
  name: string;
  type: string;
  status?: string | undefined;
  hasAttachments?: boolean;
}

interface RegisterApiBrowseRoutesOptions {
  server: FastifyInstance;
  boxRoot: string;
}

/**
 * Register the `GET /api/browse/*` directory-listing route on the server.
 */
export function registerApiBrowseRoutes(options: RegisterApiBrowseRoutesOptions): void {
  const { server, boxRoot } = options;

  // GET /api/browse/* - Browse directory contents (one level)
  server.get<{ Params: { "*": string } }>(
    "/api/browse/*",
    async (request) => {
      const reqPath = request.params["*"] || "";

      // Resolve the target directory
      const targetDir = reqPath ? path.join(boxRoot, reqPath) : boxRoot;

      // Security: ensure we stay within boxRoot
      const resolved = path.resolve(targetDir);
      if (!resolved.startsWith(path.resolve(boxRoot))) {
        return { path: reqPath, dirs: [], cards: [] };
      }

      let entries: Array<{ name: string; isDirectory: () => boolean }>;
      try {
        entries = await fs.readdir(resolved, { withFileTypes: true });
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
          console.warn(`Could not read directory, returning empty listing: ${resolved}:`, e);
        }
        return { path: reqPath, dirs: [], cards: [] };
      }

      const dirs: string[] = [];
      const cards: BrowseCard[] = [];

      // Build basename → owning-card lookup so we can fold `<basename>.attach/`
      // directories into their owning cards (rendered as navigable cards, not
      // as standalone directories).
      const cardBasenames = new Set<string>();
      for (const entry of entries) {
        if (entry.isDirectory()) continue;
        if (!entry.name.endsWith(".card")) continue;
        const parsed = parseCardName(entry.name);
        if (parsed) cardBasenames.add(parsed.name);
      }

      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;

        if (entry.isDirectory()) {
          // Hide `<basename>.attach/` when a sibling card owns it. Stray
          // .attach/ directories (no owning card) still surface for triage.
          if (entry.name.endsWith(".attach")) {
            const owner = entry.name.slice(0, -".attach".length);
            if (cardBasenames.has(owner)) continue;
          }
          dirs.push(entry.name);
          continue;
        }

        if (!entry.name.endsWith(".card")) continue;

        const parsed = parseCardName(entry.name);
        if (!parsed) continue;

        const fullPath = path.join(resolved, entry.name);
        const relativePath = path.relative(boxRoot, fullPath);
        const attachDirName = `${parsed.name}.attach`;
        const hasAttachments = entries.some(
          (e) => e.isDirectory() && e.name === attachDirName,
        );

        const fm = await loadCardFrontmatter(fullPath);
        const status = fm !== null && typeof fm["status"] === "string" ? fm["status"] : undefined;
        cards.push({
          relativePath,
          name: parsed.name,
          type: parsed.type,
          ...(status !== undefined && { status }),
          hasAttachments,
        });
      }

      dirs.sort();
      cards.sort((a, b) => a.name.localeCompare(b.name));

      return { path: reqPath, dirs, cards };
    }
  );
}
