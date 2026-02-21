/**
 * Pre-action registry.
 *
 * Pre-actions run during sync to prepare inbox items before
 * they're processed by agents. Examples:
 * - Transcribe voice memos
 * - Extract text from images (OCR)
 * - Parse email attachments
 */

import type { PreAction, PreActionContext, PreActionResult } from "./types.js";

// Import and register pre-actions
import { transcribePreAction } from "./transcribe.js";

export type { PreAction, PreActionContext, PreActionResult };

const registry: PreAction[] = [];

/**
 * Register a pre-action.
 */
export function registerPreAction(action: PreAction): void {
  registry.push(action);
}

/**
 * Get all registered pre-actions.
 */
export function getPreActions(): PreAction[] {
  return [...registry];
}

/**
 * Get pre-actions that apply to a given card type.
 */
export function getPreActionsForType(cardType: string): PreAction[] {
  return registry.filter((a) => a.appliesTo.includes(cardType));
}

/**
 * Run all applicable pre-actions for a card.
 *
 * @param context - The pre-action context
 * @returns Results from all pre-actions that ran
 */
export async function runPreActions(
  context: PreActionContext
): Promise<Array<{ name: string; result: PreActionResult }>> {
  const cardType = context.card.element.tagName;
  const applicable = getPreActionsForType(cardType);
  const results: Array<{ name: string; result: PreActionResult }> = [];

  for (const action of applicable) {
    try {
      if (await action.shouldRun(context)) {
        console.log(`  Running pre-action: ${action.name}`);
        const result = await action.execute(context);
        results.push({ name: action.name, result });

        if (result.modified) {
          // Save the card after modification
          await context.loader.save(context.card);
        }

        if (result.error) {
          console.log(`    Error: ${result.error}`);
        } else if (result.message) {
          console.log(`    ${result.message}`);
        }
      }
    } catch (error) {
      console.error(`  Pre-action ${action.name} failed:`, error);
      results.push({
        name: action.name,
        result: {
          modified: false,
          error: (error as Error).message,
        },
      });
    }
  }

  return results;
}
registerPreAction(transcribePreAction);
