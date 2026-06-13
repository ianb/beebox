/**
 * Pre-action registry.
 *
 * Pre-actions run during sync to prepare inbox items before
 * they're processed by agents. Examples:
 * - Transcribe voice memos
 * - Extract text from images (OCR)
 * - Parse email attachments
 *
 * Pre-actions work against both shapes of card:
 * - Phase 1 XML-bodied cards (loaded via cardworks ICardLoader)
 * - Phase 2 frontmatter cards (loaded via card-io)
 *
 * The runner dispatches based on what `loadCardFile` returns; the
 * pre-action's `execute()` branches on `"xml" in ctx` vs
 * `"frontmatter" in ctx`.
 */

import { writeFile } from "node:fs/promises";
import { stringify as stringifyYaml } from "yaml";
import type { ICardLoader } from "cardworks";
import type { PreAction, PreActionContext, PreActionResult } from "./types.js";
import { loadCardFile } from "../card-io.js";
import { buildLoadContext } from "../load-context.js";

import { transcribePreAction } from "./transcribe.js";

export type { PreAction, PreActionContext, PreActionResult } from "./types.js";

const registry: PreAction[] = [];

export function registerPreAction(action: PreAction): void {
  registry.push(action);
}

export function getPreActions(): PreAction[] {
  return [...registry];
}

export function getPreActionsForType(cardType: string): PreAction[] {
  return registry.filter((a) => a.appliesTo.includes(cardType));
}

/**
 * Run all applicable pre-actions for a card. Returns one result per
 * action that ran (skipping ones that decline via `shouldRun`).
 */
export async function runPreActions(input: {
  boxRoot: string;
  loader: ICardLoader;
  cardPath: string;
}): Promise<Array<{ name: string; result: PreActionResult }>> {
  const { boxRoot, loader, cardPath } = input;
  const ctx = await buildContext({ boxRoot, loader, cardPath });
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
        result: { modified: false, error: (error as Error).message },
      });
    }
  }

  return results;
}

async function buildContext(input: {
  boxRoot: string;
  loader: ICardLoader;
  cardPath: string;
}): Promise<PreActionContext | null> {
  const { boxRoot, loader, cardPath } = input;

  // Try frontmatter (Phase 2) first; if the file isn't a CardSchema card
  // it will fall through to the XML path on its own.
  try {
    const loaded = await loadCardFile(cardPath, await buildLoadContext(boxRoot));
    if (loaded.kind === "frontmatter") {
      return {
        boxRoot,
        loader,
        cardPath,
        cardType: loaded.schema.type,
        frontmatter: { schema: loaded.schema, fields: loaded.fields },
      };
    }
    // XML branch
    return {
      boxRoot,
      loader,
      cardPath,
      cardType: loaded.element.tagName,
      xml: { card: await loader.load(cardPath) },
    };
  } catch (e) {
    // Couldn't load as a known card — skip pre-actions for this file.
    console.warn(`Could not load card for pre-actions: ${cardPath}:`, e);
    return null;
  }
}

async function persistContext(ctx: PreActionContext): Promise<void> {
  if ("xml" in ctx) {
    await ctx.loader.save(ctx.xml.card);
    return;
  }
  // Frontmatter path: rewrite the file with the (possibly mutated) fields.
  await writeFile(ctx.cardPath, `---\n${stringifyYaml(ctx.frontmatter.fields)}---\n`);
}

registerPreAction(transcribePreAction);
