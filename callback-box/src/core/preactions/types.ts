import type { CardSchema } from "../../cards/index.js";

/**
 * Context for a pre-action invocation. Cards are all frontmatter now, so the
 * card's parsed schema + fields are always present.
 */
export type PreActionContext = PreActionContextBase & { frontmatter: PreActionFrontmatter };

export interface PreActionFrontmatter {
  schema: CardSchema;
  fields: Record<string, unknown>;
}

interface PreActionContextBase {
  boxRoot: string;
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
   * Execute the pre-action — mutate `context.frontmatter.fields` in place.
   * The runner persists the result when `modified` is true.
   */
  execute(context: PreActionContext): Promise<PreActionResult>;
}
