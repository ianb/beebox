/**
 * `todo-view` card schema (`docs/implemented-plans/todo-annotation.md`, Track 4) — a
 * frontmatter-only card that IS a todos display surface: its fields are a
 * query over the collector (`src/core/todo/collect.ts`), rendered by
 * `TodoViewCard` (`src/frontend/src/components/TodoViewCard.tsx`) via the
 * `todos.list` tRPC procedure.
 *
 * **`glob` has no schema default on purpose.** `cardSchema` never sees a
 * card's own path, so "default to this card's own directory subtree" can't
 * be expressed here (a static `"**"` default would make every project-local
 * instance silently box-wide). The renderer passes the card's own path as
 * `cardPath` to `todos.list`, which resolves an omitted `glob` server-side to
 * `<card's directory>/**` — see `src/webapp/trpc/routers/todos.ts`.
 */

import { z } from "zod";
import { cardSchema, renderFrontmatterBlock, type InferCardFields } from "../cards/index.js";
import { TODO_STATUSES } from "../shared/todo-model.js";

export const TodoViewSchema = cardSchema("todo-view", {
  description: "A todos display surface scoped to a glob — the box-wide plate, or a project-local subtree instance",
  category: "authored",
  fields: {
    glob: z.string().optional(),
    status: z.array(z.enum(TODO_STATUSES)).optional(),
    assigned: z.string().optional(),
  },
  instructions: `# Todo View Cards

A \`todo-view\` card IS a todos display surface — not a list you fill in by
hand, but a live query over every \`{% todo %}\` tag and frontmatter \`todos:\`
entry the box's collector finds. Its frontmatter fields are the query; the
renderer runs it every time the card is opened.

## Fields

- \`glob:\` — which cards to scan, relative to the box root (e.g.
  \`"store/projects/kitchen-remodel/**"\`). **Omit it** to scope the view to
  this card's own directory subtree — that's the common case for a
  project-local plate. The box-wide instance
  (\`store/plate.todo-view.card\`) sets \`glob: "**"\` explicitly.
- \`status:\` — restrict to specific statuses (\`open\`, \`done\`, \`dropped\`,
  \`parked\`). **Omit** to see \`open\` + \`parked\` — every plate-state group
  (escalated / on-plate / quiet / parked); \`done\`/\`dropped\` stay out of
  the default view. List them explicitly to include them.
- \`assigned:\` — restrict to todos with a matching \`assigned\` attribute
  (exact match, e.g. \`"agent"\`).

## When to create one

Drop a \`todo-view\` card in a project directory to give that project its own
plate — every todo captured anywhere under that directory shows up there,
subtree-scoped by the omitted-\`glob\` rule above. Link to it like any other
card (a plain card ref — chat, another card's body, a landmark). Tend these
freely: create one when a directory's todos deserve their own surface,
rename/move it with the directory, delete it when the project's done. There
is exactly one box-wide instance (the stock \`store/plate.todo-view.card\`,
"The plate") — everything else is as many project-local instances as are
useful.

## Rendering

Read-only in v1 — no click-to-done. Todos group by plate-state (escalated /
on plate / quiet / parked, per \`todo-model.ts\`'s truth table), each item
linking to its source card at card granularity (no line-anchored deep links
yet). Cards the collector couldn't read (parse/validate/load failures) show
in their own muted section rather than silently vanishing — the same
"never hide a failure" rule the collector and \`bbx todos\` follow.`,
});

export type TodoViewFields = InferCardFields<typeof TodoViewSchema>;

/**
 * Generate a `todo-view` card's frontmatter. `glob` is optional — omit it
 * for a subtree-scoped project plate; the box-wide stock instance
 * (`installTodoView`, `src/core/box/defaults.ts`) passes `"**"` explicitly.
 */
export function createTodoViewTemplate(options?: {
  glob?: string;
  status?: string[];
  assigned?: string;
  title?: string;
}): string {
  const fields: Record<string, unknown> = {};
  if (options?.title !== undefined && options.title !== "") {
    fields["title"] = options.title;
  }
  if (options?.glob !== undefined && options.glob !== "") {
    fields["glob"] = options.glob;
  }
  if (options?.status !== undefined && options.status.length > 0) {
    fields["status"] = options.status;
  }
  if (options?.assigned !== undefined && options.assigned !== "") {
    fields["assigned"] = options.assigned;
  }
  return renderFrontmatterBlock(fields);
}
