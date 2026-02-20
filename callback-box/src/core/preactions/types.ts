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
