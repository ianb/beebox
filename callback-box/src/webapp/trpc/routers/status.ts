import { z } from "zod";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { router, publicProcedure } from "../trpc.js";
import { getSystemState } from "../../../core/state.js";
import { generateContext } from "../../context.js";
import { createLoader } from "../../../cli/lib/loader.js";
import { parseCardName } from "../../../cli/lib/paths.js";
import { getLog } from "../../../cli/lib/git.js";

export interface BrowseDir {
  name: string;
  fileCount: number;
}

export interface BrowseCard {
  relativePath: string;
  name: string;
  type: string;
  tagName: string;
  status?: string | undefined;
  title?: string | undefined;
  /** True if this card has a `<basename>.attach/` directory (i.e. attachments). */
  hasAttachments?: boolean;
}

export interface BrowseFile {
  relativePath: string;
  name: string;
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

  browse: publicProcedure
    .input(z.object({ path: z.string().default("") }))
    .query(async ({ input, ctx }) => {
      const targetDir = input.path
        ? path.join(ctx.boxRoot, input.path)
        : ctx.boxRoot;

      // Security: ensure we stay within boxRoot
      const resolved = path.resolve(targetDir);
      if (!resolved.startsWith(path.resolve(ctx.boxRoot))) {
        return { path: input.path, dirs: [] as BrowseDir[], cards: [] as BrowseCard[], files: [] as BrowseFile[] };
      }

      let entries: Array<{ name: string; isDirectory: () => boolean }>;
      try {
        entries = await fs.readdir(resolved, { withFileTypes: true });
      } catch {
        return { path: input.path, dirs: [] as BrowseDir[], cards: [] as BrowseCard[], files: [] as BrowseFile[] };
      }

      const dirs: BrowseDir[] = [];
      const cards: BrowseCard[] = [];
      const files: BrowseFile[] = [];
      const loader = await createLoader(ctx.boxRoot);

      // Build a set of card basenames so we can fold owned `<basename>.attach/`
      // directories into their owning card (cards-as-directories UI).
      const cardBasenames = new Set<string>();
      for (const e of entries) {
        if (e.isDirectory()) continue;
        if (!e.name.endsWith(".card")) continue;
        const parsed = parseCardName(e.name);
        if (parsed) cardBasenames.add(parsed.name);
      }

      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
        if (entry.isDirectory()) {
          // Hide `<basename>.attach/` when an owning card sits next to it.
          // Stray attach dirs (no owner) still show up so they can be cleaned.
          if (entry.name.endsWith(".attach")) {
            const owner = entry.name.slice(0, -".attach".length);
            if (cardBasenames.has(owner)) continue;
          }
          const dirFullPath = path.join(resolved, entry.name);
          let fileCount = 0;
          try {
            const subEntries = await fs.readdir(dirFullPath, { recursive: true });
            fileCount = subEntries.filter((f) => typeof f === "string" && f.endsWith(".card")).length;
          } catch {
            // Can't read directory
          }
          dirs.push({ name: entry.name, fileCount });
          continue;
        }
        const fullPath = path.join(resolved, entry.name);
        const relativePath = path.relative(ctx.boxRoot, fullPath);

        if (entry.name.endsWith(".card")) {
          const parsed = parseCardName(entry.name);
          if (!parsed) continue;

          const attachDirName = `${parsed.name}.attach`;
          const hasAttachments = entries.some(
            (e) => e.isDirectory() && e.name === attachDirName,
          );

          try {
            const card = await loader.load(fullPath);
            cards.push({
              relativePath,
              name: parsed.name,
              type: parsed.type,
              tagName: card.element.tagName,
              status: card.element.attrs["status"],
              title: card.element.attrs["title"],
              hasAttachments,
            });
          } catch {
            cards.push({ relativePath, name: parsed.name, type: parsed.type, tagName: "unknown", hasAttachments });
          }
          continue;
        }

        // Non-card file: list it as a generic file
        files.push({ relativePath, name: entry.name });
      }

      dirs.sort((a, b) => a.name.localeCompare(b.name));
      cards.sort((a, b) => a.name.localeCompare(b.name));
      files.sort((a, b) => a.name.localeCompare(b.name));
      return { path: input.path, dirs, cards, files };
    }),
});
