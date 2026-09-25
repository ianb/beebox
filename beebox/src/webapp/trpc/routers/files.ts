/**
 * File summary endpoint — returns slim typed FileSummary records for a batch
 * of paths, using the loader registry for per-type extraction.
 *
 * List contexts (header dropdown, tool-use expansions, etc.) should use this
 * rather than the full card.get endpoint so that XML bodies don't ship over
 * the wire just to render one-line entries.
 */

import { getFileKind } from "./file-kind.js";
import { z } from "zod";
import * as fs from "node:fs/promises";
import { router, publicProcedure } from "../trpc.js";
import { loadCardFile } from "../../../core/card-io.js";
import { buildLoadContext } from "../../../core/load-context.js";
import { errnoCode } from "../../../lib/error-guards.js";
import { summarize } from "../../../core/loader-registry.js";
import type { LoadCardContext } from "../../../core/card-io.js";
import type { CardSchema } from "../../../cards/schema.js";
import type { FileSummary, LoaderInput } from "../../../core/file-summary.js";
import { resolveBoxNamespacePathOnDisk } from "../../../lib/box-namespace-resolve.js";

/**
 * Produce a summary for one path. Errors (missing file, parse failure) are
 * swallowed into a best-effort fallback so one bad file doesn't break the batch.
 *
 * Box containment + namespace fence, checked on the RESOLVED path: this reads
 * arbitrary file content (up to 64KB) for a non-card path, so an unfenced
 * traversal here would leak `package.json`/`src/*`/`node_modules/*` content
 * through the batch summary endpoint (`docs/implemented-plans/one-root-box-layout.md`
 * Track B).
 */
async function summarizePath(
  inputPath: string,
  { boxRoot, loadCtx }: { boxRoot: string; loadCtx: () => Promise<LoadCardContext> },
): Promise<FileSummary<unknown> | null> {
  const ns = await resolveBoxNamespacePathOnDisk({ boxRoot, rawPath: inputPath, mode: "read" });
  // A display-form path here has no visible "does not exist" concept to
  // report against (this endpoint returns `null` for any unresolvable
  // input, not an HTTP error) — the caller-visible message is not this
  // endpoint's place; the tRPC/route choke points that DO surface an error
  // (card.get, files/*, browse) carry the message instead.
  if (!ns.ok) return null;
  const { resolved, relativePath } = ns;
  const input: LoaderInput = { path: relativePath };
  // Empty unless this path IS a card that loaded: only then is there a card
  // type to ask for a summary, and only then has the schema map been built.
  let cardSchemas = new Map<string, CardSchema>();

  if (relativePath.endsWith(".card")) {
    try {
      const ctx = await loadCtx();
      const loaded = await loadCardFile(resolved, ctx);
      input.fields = loaded.fields;
      input.type = loaded.schema.type;
      cardSchemas = ctx.cardSchemas;
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

  return summarize(input, cardSchemas);
}

export const filesRouter = router({
  kind: publicProcedure.input(z.object({ path: z.string() })).query(({ ctx, input }) => getFileKind(ctx.boxRoot, input.path)),
  summarize: publicProcedure
    .input(z.object({ paths: z.array(z.string().min(1)).max(200) }))
    .query(async ({ input, ctx }) => {
      const unique = Array.from(new Set(input.paths));
      // One schema map for the batch, built at the first card and shared: the
      // box's schemas answer both "does this card parse" and "how does this
      // card type summarize itself". Built lazily because a batch of plain
      // files must not fail on a box whose schemas won't load.
      let pending: Promise<LoadCardContext> | null = null;
      const loadCtx = (): Promise<LoadCardContext> => {
        pending ??= buildLoadContext(ctx.boxRoot);
        return pending;
      };
      const results = await Promise.all(
        unique.map(async p => [p, await summarizePath(p, { boxRoot: ctx.boxRoot, loadCtx })] as const),
      );
      const byInput = new Map(results);
      return input.paths.map(p => byInput.get(p) ?? null);
    }),
});
