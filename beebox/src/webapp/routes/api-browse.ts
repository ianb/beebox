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
import { parseCardName } from "../../lib/paths.js";
import { errnoCode } from "../../lib/error-guards.js";
import { naturalCompare } from "../../lib/natural-sort.js";
import { resolveBoxNamespacePath } from "../../lib/box-namespace-resolve.js";
import { BOX_ROOT_VOCABULARY } from "../../lib/box-root-vocabulary.js";

/** The underscore area names — what the box root listing shows, and all it shows. */
const BOX_AREA_NAMES: ReadonlySet<string> = new Set(
  BOX_ROOT_VOCABULARY.filter((entry) => entry.kind === "area").map((entry): string => entry.name)
);

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
    async (request, reply) => {
      const reqPath = request.params["*"] || "";

      // Resolve the target directory. Box namespace fence, checked on the
      // RESOLVED path: the root's own listing shows only the underscore
      // areas (filtered below, and the root itself is allowed here); a
      // non-root path outside the namespace — src/, node_modules/, .git/,
      // package.json's siblings, or a traversal form like
      // `_content/../src` — 403s rather than browsing the npm/agent-identity
      // machinery (`docs/plans/one-root-box-layout.md` Track B).
      let resolved: string;
      if (reqPath === "") {
        resolved = path.resolve(boxRoot);
      } else {
        const ns = resolveBoxNamespacePath(boxRoot, reqPath);
        if (ns === null) {
          return reply.status(403).send({ error: "Access denied" });
        }
        resolved = ns.resolved;
      }

      let entries: Array<{ name: string; isDirectory: () => boolean }>;
      try {
        entries = await fs.readdir(resolved, { withFileTypes: true });
      } catch (e) {
        if (errnoCode(e) !== "ENOENT") {
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

      // At the box root, list ONLY the underscore areas — not the npm
      // namespace, `src/`, or agent-identity entries that also pass the
      // dotfile filter above (`src`, `node_modules` aren't dotfiles). There
      // are no ref-addressable root cards either (a stray one is a
      // closed-vocabulary violation Track C's `bbx validate` flags, not
      // something to browse here).
      const rootFilteredDirs = reqPath === "" ? dirs.filter((name) => BOX_AREA_NAMES.has(name)) : dirs;
      const rootFilteredCards = reqPath === "" ? [] : cards;

      rootFilteredDirs.sort(naturalCompare);
      rootFilteredCards.sort((a, b) => naturalCompare(a.name, b.name));

      return { path: reqPath, dirs: rootFilteredDirs, cards: rootFilteredCards };
    }
  );
}
