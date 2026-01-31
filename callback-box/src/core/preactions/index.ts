/**
 * Pre-action registry.
 *
 * Pre-actions run during wakeup to prepare inbox items before
 * they're processed by agents. Examples:
 * - Transcribe voice memos
 * - Extract text from images (OCR)
 * - Parse email attachments
 */

import type { Card } from "cardworks";
import type { ICardLoader } from "cardworks";

export interface PreActionContext {
  boxRoot: string;
  loader: ICardLoader;
  card: Card;
  cardPath: string;
}

export interface PreActionResult {
  modified: boolean;
  message?: string;
  error?: string;
}

export interface PreAction {
  /** Unique name for this pre-action */
  name: string;

  /** Card types this pre-action applies to */
  appliesTo: string[];

  /**
   * Check if this pre-action needs to run for the given card.
   * Return true if the pre-action should run.
   */
  shouldRun(context: PreActionContext): Promise<boolean>;

  /**
   * Execute the pre-action.
   * Should modify the card in place and return the result.
   */
  execute(context: PreActionContext): Promise<PreActionResult>;
}

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

// Import and register pre-actions
import { transcribePreAction } from "./transcribe.js";
registerPreAction(transcribePreAction);
