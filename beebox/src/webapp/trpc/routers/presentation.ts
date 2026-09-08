import { z } from "zod";
import {
  THEME_CATALOG,
  resolveChromeTheme,
  type ThemeChoice,
} from "../../../shared/card-theme.js";
import { loadPresentationConfig } from "../../../core/box/presentation.js";
import { createCardSchemaMap } from "../../../schemas/registry.js";
import { publicProcedure, router } from "../trpc.js";

export const presentationRouter = router({
  /**
   * One box-scoped presentation snapshot. `boxKey` participates in the client
   * query identity; authority always comes from the request context.
   */
  get: publicProcedure
    .input(z.object({ boxKey: z.string() }))
    .query(async ({ ctx }) => {
      const [presentation, schemas] = await Promise.all([
        loadPresentationConfig(ctx.boxRoot),
        createCardSchemaMap(ctx.boxRoot),
      ]);
      const typeDefaults: Record<string, ThemeChoice> = {};
      for (const [type, schema] of schemas) {
        if (schema.defaultTheme !== undefined) typeDefaults[type] = schema.defaultTheme;
      }
      return {
        catalog: THEME_CATALOG,
        presentation,
        typeDefaults,
        chrome: resolveChromeTheme(presentation),
        configProblems: presentation.status === "invalid" ? presentation.problems : [],
        canEditCardThemes: ctx.isOwner,
      };
    }),
});
