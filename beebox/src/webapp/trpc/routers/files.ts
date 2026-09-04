/**
 * File summary endpoint — returns slim typed FileSummary records for a batch
 * of paths, using the loader registry for per-type extraction.
 *
 * List contexts (header dropdown, tool-use expansions, etc.) should use this
 * rather than the full card.get endpoint so that XML bodies don't ship over
 * the wire just to render one-line entries.
 */

import { z } from "zod";
import * as fs from "node:fs/promises";
import { router, publicProcedure } from "../trpc.js";
import { loadCardFile } from "../../../core/card-io.js";
import { buildLoadContext } from "../../../core/load-context.js";
import { errnoCode } from "../../../lib/error-guards.js";
import { registerBuiltinLoaders } from "../../../core/loader-registrations.js";
import { summarize } from "../../../core/loader-registry.js";
import type { FileSummary, LoaderInput } from "../../../core/file-summary.js";
import { resolveBoxNamespacePath } from "../../../lib/box-namespace-resolve.js";

registerBuiltinLoaders();

/**
 * Produce a summary for one path. Errors (missing file, parse failure) are
 * swallowed into a best-effort fallback so one bad file doesn't break the batch.
 *
 * Box containment + namespace fence, checked on the RESOLVED path: this reads
 * arbitrary file content (up to 64KB) for a non-card path, so an unfenced
 * traversal here would leak `package.json`/`src/*`/`node_modules/*` content
 * through the batch summary endpoint (`docs/plans/one-root-box-layout.md`
 * Track B).
 */
async function summarizePath(boxRoot: string, inputPath: string): Promise<FileSummary<unknown> | null> {
  const ns = resolveBoxNamespacePath(boxRoot, inputPath);
  if (ns === null) return null;
  const { resolved, relativePath } = ns;
  const input: LoaderInput = { path: relativePath };

  if (relativePath.endsWith(".card")) {
    try {
      const loaded = await loadCardFile(resolved, await buildLoadContext(boxRoot));
      input.fields = loaded.fields;
      input.type = loaded.schema.type;
    } catch (e) {
      if (errnoCode(e) !== "ENOENT") {
        console.warn(`Failed to load card ${relativePath}, falling through to fallback loader:`, e);
      }
    }
  } else {
    try {
      const stat = await fs.stat(resolved);
      if (stat.isFile() && stat.size < 64 * 1024) {
        input.content = await fs.readFile(resolved, "utf-8");
      }
    } catch (e) {
      if (errnoCode(e) !== "ENOENT") {
        console.warn(`Failed to stat/read ${relativePath}, leaving content unset:`, e);
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
