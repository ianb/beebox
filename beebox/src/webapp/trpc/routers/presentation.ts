import { z } from "zod";
import * as fs from "node:fs/promises";
import { TRPCError } from "@trpc/server";
import { Document, isMap, parseDocument } from "yaml";
import {
  THEME_CATALOG,
  SystemThemeChoiceSchema,
  validateSystemThemeChoice,
  type ThemeChoice,
} from "../../../shared/card-theme.js";
import { loadPresentationConfig } from "../../../core/box/presentation.js";
import { resolveSystemTheme } from "../../../core/system-theme.js";
import { boxRelativePathSchema } from "../../../core/landmark/nearest.js";
import { updateBoxSystemTheme } from "../../box-config-write.js";
import { resolveBoxNamespacePathOnDisk } from "../../../lib/box-namespace-resolve.js";
import { splitCardContent } from "../../../cards/index.js";
import { withCardLock } from "../../../lib/card-lock.js";
import { writeFileAtomic } from "../../../lib/atomic-write.js";
import { stageAndCommitPaths } from "../../../lib/git.js";
import { isRecord } from "../../../lib/is-record.js";
import { createCardSchemaMap } from "../../../schemas/registry.js";
import { ownerProcedure, publicProcedure, router } from "../trpc.js";

const systemThemeInput = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("box"), theme: SystemThemeChoiceSchema.nullable() }),
  z.object({ scope: z.literal("landmark"), path: boxRelativePathSchema, theme: SystemThemeChoiceSchema.nullable() }),
]);

function boxHasSystemThemeOverride(presentation: Awaited<ReturnType<typeof loadPresentationConfig>>): boolean {
  if (presentation.status === "valid") return presentation.config.chrome !== undefined;
  return presentation.status === "invalid"
    && isRecord(presentation.requested)
    && Object.hasOwn(presentation.requested, "chrome");
}

export const presentationRouter = router({
  /**
   * One box-scoped presentation snapshot. `boxKey` participates in the client
   * query identity; authority always comes from the request context.
   */
  get: publicProcedure
    .input(z.object({ boxKey: z.string(), contextDir: boxRelativePathSchema.optional() }))
    .query(async ({ input, ctx }) => {
      const [presentation, schemas] = await Promise.all([
        loadPresentationConfig(ctx.boxRoot),
        createCardSchemaMap(ctx.boxRoot),
      ]);
      const typeDefaults: Record<string, ThemeChoice> = {};
      for (const [type, schema] of schemas) {
        if (schema.defaultTheme !== undefined) typeDefaults[type] = schema.defaultTheme;
      }
      const systemTheme = await resolveSystemTheme({ boxRoot: ctx.boxRoot, presentation,
        ...(input.contextDir === undefined ? {} : { contextDir: input.contextDir }) });
      return {
        catalog: THEME_CATALOG,
        presentation,
        typeDefaults,
        chrome: systemTheme.chrome,
        systemTheme: {
          contextDir: input.contextDir ?? "",
          landmark: systemTheme.landmark,
          boxExplicitTheme: presentation.status === "valid" ? presentation.config.chrome ?? null : null,
          boxHasOverride: boxHasSystemThemeOverride(presentation),
        },
        configProblems: presentation.status === "invalid" ? presentation.problems : [],
        canEditCardThemes: ctx.isOwner,
      };
    }),

  setSystemTheme: ownerProcedure
    .input(systemThemeInput)
    .mutation(async ({ input, ctx }) => {
      const checked = input.theme === null ? null : validateSystemThemeChoice(input.theme);
      if (checked?.problem !== null && checked !== null) {
        throw new TRPCError({ code: "BAD_REQUEST", message: checked.problem.message });
      }
      if (input.scope === "box") {
        const saved = await updateBoxSystemTheme({ boxRoot: ctx.boxRoot, theme: input.theme });
        return { scope: input.scope, theme: input.theme, commitWarning: saved.commitError === null ? null : "Saved, but the Git commit failed." };
      }
      if (!input.path.endsWith(".landmark.card")) throw new TRPCError({ code: "BAD_REQUEST", message: "System theme override requires a landmark card" });
      const resolved = await resolveBoxNamespacePathOnDisk({ boxRoot: ctx.boxRoot, rawPath: input.path, mode: "write" });
      if (!resolved.ok) throw new TRPCError({ code: "BAD_REQUEST", message: "Landmark path is outside the box namespace" });
      const saved = await withCardLock(resolved.resolved, async () => {
        let raw: string;
        try { raw = await fs.readFile(resolved.resolved, "utf-8"); }
        catch (error) {
          void error;
          throw new TRPCError({ code: "NOT_FOUND", message: `Landmark not found: ${resolved.relativePath}` });
        }
        const split = splitCardContent(raw);
        if (!split.hasFrontmatter) throw new TRPCError({ code: "BAD_REQUEST", message: "Landmark has no frontmatter block" });
        const document = split.frontmatterText.trim() === "" ? new Document({}) : parseDocument(split.frontmatterText);
        if (document.errors.length > 0 || !isMap(document.contents)) throw new TRPCError({ code: "BAD_REQUEST", message: "Landmark frontmatter is not a valid YAML mapping" });
        if (input.theme === null) document.delete("system-theme");
        else document.set("system-theme", input.theme);
        const yaml = String(document);
        await writeFileAtomic(resolved.resolved, { content: `---\n${yaml.endsWith("\n") ? yaml : `${yaml}\n`}---\n${split.body}` });
        try {
          const commit = await stageAndCommitPaths(ctx.boxRoot, { paths: [resolved.relativePath],
            message: input.theme === null ? `Clear landmark system theme: ${resolved.relativePath}` : `Set landmark system theme: ${resolved.relativePath}` });
          return { commit, commitWarning: null };
        } catch (error) {
          void error;
          return { commit: null, commitWarning: "Saved, but the Git commit failed." };
        }
      });
      ctx.eventBus.emitTransient("file-change", { event: "change", path: resolved.relativePath, timestamp: new Date().toISOString() });
      return { scope: input.scope, path: resolved.relativePath, theme: input.theme, ...saved };
    }),
});
