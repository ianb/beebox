/**
 * tRPC router for box-authored views.
 *
 * `resolveRef` backs the card-aware view widgets (CardLink/CardRef): it
 * resolves a `cardRef` written in a view to the target card's
 * title/type/existence so the widget can show the title and a missing-state
 * marker. The widgets call it through the view-host context's `useResolvedRef`,
 * never directly.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";
import { listViews } from "../../views/compiler.js";
import { resolveContainedRef } from "../../../core/ref-exists.js";
import { typeFromFilename } from "../../../core/card-io.js";
import { splitCardContent } from "../../../cards/frontmatter.js";
import { titleFromFilename } from "../../../core/file-summary.js";

export interface ResolvedRef {
  /** Box-relative path the ref resolved to. */
  path: string;
  /** Display title: frontmatter `title`, else filename-derived. */
  title: string;
  /** Card type from the filename (`Foo.<type>.card`), or "" for non-cards. */
  type: string;
  /** Whether the target exists on disk inside the box. */
  exists: boolean;
}

/** Read a card's frontmatter `title`, or null when absent/unparseable. */
async function frontmatterTitle(absPath: string): Promise<string | null> {
  try {
    const content = await fs.readFile(absPath, "utf-8");
    const { frontmatterText, hasFrontmatter } = splitCardContent(content);
    if (!hasFrontmatter) return null;
    const fields = parseYaml(frontmatterText) as Record<string, unknown> | null;
    const title = fields?.["title"];
    return typeof title === "string" && title.trim() !== "" ? title.trim() : null;
  } catch (_e) {
    // A card whose frontmatter doesn't parse still resolves by filename; the
    // broken frontmatter is a separate `cb validate` concern, not this lookup's.
    return null;
  }
}

export const viewsRouter = router({
  /** List all box-authored views (slug, name, rendered card types). */
  list: publicProcedure.query(({ ctx }) => {
    return listViews(ctx.boxRoot);
  }),

  resolveRef: publicProcedure
    .input(
      z.object({
        ref: z.string(),
        /** Box-relative path the ref is written relative to ("" = box root). */
        basePath: z.string().default(""),
      }),
    )
    .query(async ({ ctx, input }): Promise<ResolvedRef> => {
      // Strip any `?view=…&zoom` query: only the path portion addresses a file.
      const qIdx = input.ref.indexOf("?");
      const refPath = qIdx === -1 ? input.ref : input.ref.slice(0, qIdx);

      // The resolver needs a *file* fromPath (it takes the dirname); a
      // placeholder basename under basePath's dir gives box-root resolution
      // when basePath is empty, and document-relative resolution otherwise.
      // resolveContainedRef also does the containment guard: a `..`-laden ref
      // must not let this endpoint stat (and report the existence of) files
      // outside the box. An escape is treated as a missing target — the same
      // surface a broken ref gets.
      const fromPath = path.join(ctx.boxRoot, input.basePath || "_");
      const contained = resolveContainedRef({ ref: refPath, fromPath, boxRoot: ctx.boxRoot });
      if (contained === null) {
        console.warn(`views.resolveRef: ref "${refPath}" (base "${input.basePath}") escapes the box`);
        return { path: refPath, title: titleFromFilename(refPath), type: typeFromFilename(refPath) ?? "", exists: false };
      }
      const abs = path.join(ctx.boxRoot, contained);
      const relPath = contained;

      let exists = false;
      try {
        await fs.stat(abs);
        exists = true;
      } catch (_e) {
        // ENOENT (and any other stat failure) → the widget renders a "(missing)"
        // marker; `cb validate` is the channel that explains *why*.
        exists = false;
      }

      const fmTitle = exists ? await frontmatterTitle(abs) : null;
      return {
        path: relPath,
        title: fmTitle ?? titleFromFilename(refPath),
        type: typeFromFilename(refPath) ?? "",
        exists,
      };
    }),
});
