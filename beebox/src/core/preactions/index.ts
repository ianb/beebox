/**
 * Pre-action registry.
 *
 * Pre-actions run during sync to prepare inbox items before
 * they're processed by agents. Examples:
 * - Transcribe voice memos
 * - Extract text from images (OCR)
 * - Parse email attachments
 *
 * Pre-actions work against frontmatter cards (loaded via card-io). The runner
 * loads the card, builds the context, and persists the (possibly mutated)
 * fields back to disk when an action reports `modified`.
 */

import { writeFile } from "node:fs/promises";
import { renderFrontmatterBlock } from "../../cards/index.js";
import type { PreAction, PreActionContext, PreActionResult } from "./types.js";
import { loadCardFile } from "../card-io.js";
import { buildLoadContext } from "../load-context.js";

import { transcribePreAction } from "./transcribe.js";
import { errorMessage } from "../../lib/error-guards.js";

export type { PreAction, PreActionContext, PreActionResult } from "./types.js";

const registry: PreAction[] = [];

function registerPreAction(action: PreAction): void {
  registry.push(action);
}

function getPreActionsForType(cardType: string): PreAction[] {
  return registry.filter((a) => a.appliesTo.includes(cardType));
}

/**
 * Run all applicable pre-actions for a card. Returns one result per
 * action that ran (skipping ones that decline via `shouldRun`).
 */
export async function runPreActions(input: {
  boxRoot: string;
  cardPath: string;
}): Promise<Array<{ name: string; result: PreActionResult }>> {
  const { boxRoot, cardPath } = input;
  const ctx = await buildContext({ boxRoot, cardPath });
  if (ctx === null) return [];

  const applicable = getPreActionsForType(ctx.cardType);
  const results: Array<{ name: string; result: PreActionResult }> = [];

  for (const action of applicable) {
    try {
      if (await action.shouldRun(ctx)) {
        console.log(`  Running pre-action: ${action.name}`);
        const result = await action.execute(ctx);
        results.push({ name: action.name, result });

        if (result.modified) {
          await persistContext(ctx);
        }

        if (result.error !== undefined && result.error !== "") {
          console.log(`    Error: ${result.error}`);
        } else if (result.message !== undefined && result.message !== "") {
          console.log(`    ${result.message}`);
        }
      }
    } catch (error) {
      console.error(`  Pre-action ${action.name} failed:`, error);
      results.push({
        name: action.name,
        result: { modified: false, error: errorMessage(error) },
      });
    }
  }

  return results;
}

async function buildContext(input: {
  boxRoot: string;
  cardPath: string;
}): Promise<PreActionContext | null> {
  const { boxRoot, cardPath } = input;

  try {
    const loaded = await loadCardFile(cardPath, await buildLoadContext(boxRoot));
    return {
      boxRoot,
      cardPath,
      cardType: loaded.schema.type,
      frontmatter: { schema: loaded.schema, fields: loaded.fields },
    };
  } catch (e) {
    // Couldn't load as a known card — skip pre-actions for this file.
    console.warn(`Could not load card for pre-actions: ${cardPath}:`, e);
    return null;
  }
}

async function persistContext(ctx: PreActionContext): Promise<void> {
  // Rewrite the file with the (possibly mutated) fields.
  await writeFile(ctx.cardPath, renderFrontmatterBlock(ctx.frontmatter.fields));
}

registerPreAction(transcribePreAction);
