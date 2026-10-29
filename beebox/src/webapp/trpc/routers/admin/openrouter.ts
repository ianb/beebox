/**
 * Admin → OpenRouter models: the owner's act that lets a box run a model
 * OpenRouter carries, and the one place the box says what those models cost.
 *
 * Adding a model is the gate (`docs/implemented-plans/openrouter-chat-models.md`): a key
 * alone runs nothing. An add is validated against OpenRouter's public catalog
 * — the id must exist and support tool calling — so a typo fails here, not in
 * someone's chat turn. Owner-only; every change commits the box config.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { ownerProcedure } from "../../procedures.js";
import { loadAddedModels, loadEnabledEngines, parseAddedModel } from "../../../../core/box/config.js";
import { lookupPiModel, piBundledCatalog } from "../../../../core/agent/pi-run/session/core.js";
import { getOpenRouterKey } from "../../../../core/openrouter.js";
import { lookupOpenRouterModel, readOpenRouterKeyUsage } from "../../../../core/openrouter-catalog.js";
import type { FetchLike } from "../../../../core/secrets/probe-registry.js";
import { addOpenRouterModel, OpenRouterModelInUseError, removeOpenRouterModel } from "./box-config-openrouter.js";
import type { Services } from "../../../../services/container.js";

function fetchFor(services: Services): FetchLike {
  return services.openrouterFetch ?? fetch;
}

function commitWarning(commitError: Error | null): string | null {
  if (commitError === null) return null;
  console.error("[admin] OpenRouter model list saved, but its Git commit failed:", commitError);
  return "Saved, but the Git commit failed.";
}

/**
 * What pi lacks to run an added model, in admin's words, or null. Uses the
 * run's own lookup (`lookupPiModel`), so admin and a pi turn never disagree.
 */
async function piModelWarning(id: string, deps: { fetch: FetchLike; now: number }): Promise<string | null> {
  const found = await lookupPiModel({ catalog: piBundledCatalog(), id }, deps);
  switch (found.source) {
    case "pi":
      return null;
    case "listing":
      return "pi has no built-in settings for this model, so it uses OpenRouter's listing. "
        + (found.pricesKnown
          ? "Some models fail with settings built this way."
          : "OpenRouter lists no price for it, so pi counts its cost as $0.");
    case "none":
      return `pi cannot run this model: ${found.missing}.`;
  }
}

export const openrouterAdminProcedures = {
  /**
   * The added models with their live catalog entry (price, context), whether
   * the box has a usable key, and what that key has spent. The key read is a
   * non-spending presence resolve; usage is OpenRouter's figure for the whole
   * key, not per model (boxholder, 2026-09-19).
   */
  openrouterModels: ownerProcedure.query(async ({ ctx }) => {
    const fetchImpl = fetchFor(ctx.services);
    const now = Date.now();
    const [added, key, engines] = await Promise.all([
      loadAddedModels(ctx.boxRoot),
      getOpenRouterKey(ctx.boxRoot, { purpose: "admin-usage", observe: false }),
      loadEnabledEngines(ctx.boxRoot),
    ]);
    // Only a box that can run pi needs to hear what pi lacks.
    const piOn = engines.includes("pi");
    const models = await Promise.all(added.map(async (m) => ({
      ...m,
      catalog: await lookupOpenRouterModel(m.id, { fetch: fetchImpl, now }),
      piWarning: piOn ? await piModelWarning(m.id, { fetch: fetchImpl, now }) : null,
    })));
    return {
      keyGranted: key !== null,
      usage: key === null ? null : await readOpenRouterKeyUsage(key, { fetch: fetchImpl }),
      models,
    };
  }),

  addOpenrouterModel: ownerProcedure
    .input(z.object({ id: z.string().trim(), label: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const model = parseAddedModel(input);
      if (model === null) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Enter an OpenRouter model id like deepseek/deepseek-v3.2 (lowercase, author/model) and a label of at most 60 characters.",
        });
      }
      const found = await lookupOpenRouterModel(model.id, { fetch: fetchFor(ctx.services), now: Date.now() });
      if (!found.ok) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Could not check the model with OpenRouter, so it was not added: ${found.error}` });
      }
      if (!found.found) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `OpenRouter has no model ${model.id}. Check the id on openrouter.ai/models.` });
      }
      if (!found.model.supportsTools) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `${model.id} does not support tool calling, which every chat and agent turn needs.` });
      }
      const result = await addOpenRouterModel({ boxRoot: ctx.boxRoot, model });
      return { ok: true, commitWarning: commitWarning(result.commitError) };
    }),

  removeOpenrouterModel: ownerProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const result = await removeOpenRouterModel({ boxRoot: ctx.boxRoot, id: input.id });
        return { ok: true, commitWarning: commitWarning(result.commitError) };
      } catch (e) {
        if (e instanceof OpenRouterModelInUseError) throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
        throw e;
      }
    }),
};
