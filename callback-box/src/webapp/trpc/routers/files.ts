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
import { createLoader } from "../../../cli/lib/loader.js";
import { registerBuiltinLoaders } from "../../../core/loader-registrations.js";
import { summarize } from "../../../core/loader-registry.js";
import type { FileSummary, LoaderInput } from "../../../core/file-summary.js";

registerBuiltinLoaders();

/**
 * Produce a summary for one path. Errors (missing file, parse failure) are
 * swallowed into a best-effort fallback so one bad file doesn't break the batch.
 */
async function summarizePath(boxRoot: string, relPath: string): Promise<FileSummary<unknown>> {
  const fullPath = path.join(boxRoot, relPath);
  const input: LoaderInput = { path: relPath };

  if (relPath.endsWith(".card")) {
    try {
      const loader = await createLoader(boxRoot);
      const card = await loader.load(fullPath);
      input.element = card.element;
    } catch {
      // fall through to fallback loader
    }
  } else {
    try {
      const stat = await fs.stat(fullPath);
      if (stat.isFile() && stat.size < 64 * 1024) {
        input.content = await fs.readFile(fullPath, "utf-8");
      }
    } catch {
      // fall through
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
        unique.map(p => summarizePath(ctx.boxRoot, p)),
      );
      const byPath = new Map(results.map(r => [r.path, r]));
      return input.paths.map(p => byPath.get(p)!);
    }),
});
