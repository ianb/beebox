/**
 * File summary endpoint — returns slim typed FileSummary records for a batch
 * of paths, using the loader registry for per-type extraction.
 *
 * List contexts (header dropdown, tool-use expansions, etc.) should use this
 * rather than the full card.get endpoint so that XML bodies don't ship over
 * the wire just to render one-line entries.
 */

import { z } from "zod";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { router, publicProcedure } from "../trpc.js";
import { loadCardFile } from "../../../core/card-io.js";
import { buildLoadContext } from "../../../core/load-context.js";
import { registerBuiltinLoaders } from "../../../core/loader-registrations.js";
import { summarize } from "../../../core/loader-registry.js";
import type { FileSummary, LoaderInput } from "../../../core/file-summary.js";

registerBuiltinLoaders();

/**
 * Normalize a client-supplied path to box-relative, or return null if the
 * path is absolute and lives outside the box.
 */
function normalizePath(boxRoot: string, raw: string): string | null {
  if (!path.isAbsolute(raw)) return raw;
  const relative = path.relative(boxRoot, raw);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return relative;
}

/**
 * Produce a summary for one path. Errors (missing file, parse failure) are
 * swallowed into a best-effort fallback so one bad file doesn't break the batch.
 */
async function summarizePath(boxRoot: string, inputPath: string): Promise<FileSummary<unknown> | null> {
  const relPath = normalizePath(boxRoot, inputPath);
  if (relPath === null) return null;
  const fullPath = path.join(boxRoot, relPath);
  const input: LoaderInput = { path: relPath };

  if (relPath.endsWith(".card")) {
    try {
      const loaded = await loadCardFile(fullPath, await buildLoadContext(boxRoot));
      input.fields = loaded.fields;
      input.type = loaded.schema.type;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn(`Failed to load card ${relPath}, falling through to fallback loader:`, e);
      }
    }
  } else {
    try {
      const stat = await fs.stat(fullPath);
      if (stat.isFile() && stat.size < 64 * 1024) {
        input.content = await fs.readFile(fullPath, "utf-8");
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn(`Failed to stat/read ${relPath}, leaving content unset:`, e);
      }
    }
  }

  return summarize(input);
}

export const filesRouter = router({
  summarize: publicProcedure
    .input(z.object({ paths: z.array(z.string().min(1)).max(200) }))
    .query(async ({ input, ctx }) => {
      const unique = Array.from(new Set(input.paths));
      const results = await Promise.all(
        unique.map(async p => [p, await summarizePath(ctx.boxRoot, p)] as const),
      );
      const byInput = new Map(results);
      return input.paths.map(p => byInput.get(p) ?? null);
    }),
});
