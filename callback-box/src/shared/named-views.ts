/**
 * Named builtin views — self-sufficient interface surfaces a `view` card
 * can point at (docs/plans/interface-as-cards.md, "instrument cards").
 * The card supplies the address, configuration (`params`), and notes; the
 * view brings its own data.
 *
 * Single source for schema validation (src/schemas/view.ts) and the
 * frontend component registry (src/frontend/src/renderers/view.tsx) —
 * keep the registry in sync when adding a name here.
 */

import { z } from "zod";

export interface NamedView {
  name: string;
  description: string;
  /**
   * Frontmatter `params` shape for this view. Absent means the view takes
   * no params (a card supplying any is a validation error). `.strict()`
   * so misspelled keys fail loudly instead of silently doing nothing.
   */
  params?: z.ZodType;
}

/**
 * `view: history` params — a frozen filter over the commit timeline,
 * mirroring the History page's URL filter state. A card with these params
 * IS a saved filter: a stable, linkable slice of history.
 */
export const HISTORY_VIEW_PARAMS = z
  .object({
    connectors: z.array(z.string()).optional(),
    workflows: z.array(z.string()).optional(),
    touchpoint: z.boolean().optional(),
    feedback: z.boolean().optional(),
    session: z.string().optional(),
  })
  .strict();
export type HistoryViewParams = z.infer<typeof HISTORY_VIEW_PARAMS>;

export const NAMED_VIEWS: readonly NamedView[] = [
  {
    name: "landmarks",
    description: "Every landmark in the box, each with its resolved links",
  },
  {
    name: "chat-picker",
    description: "Fresh chats grouped by landmark, with a New-chat button per landmark",
  },
  {
    name: "history",
    description:
      "The commit timeline, filtered by the card's params (connectors, workflows, touchpoint, feedback, session) — a saved filter over history",
    params: HISTORY_VIEW_PARAMS,
  },
];

export const NAMED_VIEW_NAMES: readonly string[] = NAMED_VIEWS.map((v) => v.name);

const byName = new Map(NAMED_VIEWS.map((v) => [v.name, v]));

/** Look up a named view, or undefined for unknown names. */
export function namedViewFor(name: string): NamedView | undefined {
  return byName.get(name);
}
