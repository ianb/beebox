import type { Card, ICardLoader } from "cardworks";
import type { CardSchema } from "../../cards/index.js";

/**
 * Context for a pre-action invocation. Exactly one of `xml` or
 * `frontmatter` is present, depending on whether the card was loaded
 * via cardworks's XML loader (Phase 1) or via the frontmatter card-io
 * dispatcher (Phase 2).
 */
export type PreActionContext = PreActionContextBase &
  ({ xml: { card: Card } } | { frontmatter: PreActionFrontmatter });

export interface PreActionFrontmatter {
  schema: CardSchema;
  fields: Record<string, unknown>;
}

interface PreActionContextBase {
  boxRoot: string;
  loader: ICardLoader;
  cardPath: string;
  cardType: string;
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
   * Execute the pre-action. Implementations branch on
   * `"xml" in context` vs `"frontmatter" in context` to mutate the
   * right shape. The runner persists the result.
   */
  execute(context: PreActionContext): Promise<PreActionResult>;
}
