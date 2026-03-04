import { z } from "zod";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { router, publicProcedure } from "../trpc.js";
import { getSystemState, generateContext } from "../../../core/state.js";
import { createLoader } from "../../../cli/lib/loader.js";
import { parseCardName } from "../../../cli/lib/paths.js";
import { getLog } from "../../../cli/lib/git.js";

/**
 * Count news items in a directory.
 */
async function countNewsInDir(boxRoot: string, relativeDir: string): Promise<number> {
  const dir = path.join(boxRoot, relativeDir);
  try {
    const files = await fs.readdir(dir);
    return files.filter((f) => f.endsWith(".news-item.card")).length;
  } catch {
    return 0;
  }
}

export const statusRouter = router({
  status: publicProcedure.query(async ({ ctx }) => {
    const state = await getSystemState(ctx.boxRoot);
    return {
      boxRoot: state.boxRoot,
      boxVersion: state.boxVersion,
      created: state.created,
      git: state.git,
      counts: {
        inbox: state.inbox.length,
        questions: state.questions.length,
        pendingQuestions: state.questions.filter((q) => q.status === "pending").length,
      },
    };
  }),

  inbox: publicProcedure.query(async ({ ctx }) => {
    const state = await getSystemState(ctx.boxRoot);
    return { items: state.inbox };
  }),

  questions: publicProcedure.query(async ({ ctx }) => {
    const state = await getSystemState(ctx.boxRoot);
    const context = await generateContext(ctx.boxRoot);
    const enriched = state.questions.map((q) => {
      const pending = context.pendingQuestions.find((p) => p.path === q.relativePath);
      return { ...q, prompt: pending?.prompt, options: pending?.options };
    });
    return { items: enriched };
  }),

  context: publicProcedure.query(async ({ ctx }) => {
    return generateContext(ctx.boxRoot);
  }),

  activity: publicProcedure
    .input(z.object({ count: z.number().int().positive().default(10) }))
    .query(async ({ input, ctx }) => {
      const entries = await getLog(ctx.boxRoot, input.count);
      return { entries };
    }),

  newsStatus: publicProcedure.query(async ({ ctx }) => {
    const [inbox, pool, archive, trash] = await Promise.all([
      countNewsInDir(ctx.boxRoot, "box/inbox/news"),
      countNewsInDir(ctx.boxRoot, "box/pool/news"),
      countNewsInDir(ctx.boxRoot, "store/archive/news"),
      countNewsInDir(ctx.boxRoot, "store/trash/news"),
    ]);
    return { inbox, pool, archive, trash };
  }),

  browse: publicProcedure
    .input(z.object({ path: z.string().default("") }))
    .query(async ({ input, ctx }) => {
      const targetDir = input.path
        ? path.join(ctx.boxRoot, input.path)
        : ctx.boxRoot;

      // Security: ensure we stay within boxRoot
      const resolved = path.resolve(targetDir);
      if (!resolved.startsWith(path.resolve(ctx.boxRoot))) {
        return { path: input.path, dirs: [] as string[], cards: [] as Array<{ relativePath: string; name: string; type: string; tagName: string; status?: string | undefined }> };
      }

      let entries: Array<{ name: string; isDirectory: () => boolean }>;
      try {
        entries = await fs.readdir(resolved, { withFileTypes: true });
      } catch {
        return { path: input.path, dirs: [] as string[], cards: [] as Array<{ relativePath: string; name: string; type: string; tagName: string; status?: string | undefined }> };
      }

      const dirs: string[] = [];
      const cards: Array<{ relativePath: string; name: string; type: string; tagName: string; status?: string | undefined }> = [];
      const loader = await createLoader(ctx.boxRoot);

      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
        if (entry.isDirectory()) {
          dirs.push(entry.name);
          continue;
        }
        if (!entry.name.endsWith(".card")) continue;
        const parsed = parseCardName(entry.name);
        if (!parsed) continue;

        const fullPath = path.join(resolved, entry.name);
        const relativePath = path.relative(ctx.boxRoot, fullPath);

        try {
          const card = await loader.load(fullPath);
          cards.push({
            relativePath,
            name: parsed.name,
            type: parsed.type,
            tagName: card.element.tagName,
            status: card.element.attrs["status"],
          });
        } catch {
          cards.push({ relativePath, name: parsed.name, type: parsed.type, tagName: "unknown" });
        }
      }

      dirs.sort();
      cards.sort((a, b) => a.name.localeCompare(b.name));
      return { path: input.path, dirs, cards };
    }),
});
