/**
 * Todo list card schema — human-oriented task lists.
 *
 * Todo lists group related action items. Items can be nested
 * (sub-items within items) and have free-form details and agent
 * notes. Everything is structured frontmatter — no markdown body.
 */

import { cardSchema, type CardSchema } from "../cards/index.js";
import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";

export const TodoItemStatus = z.enum(["pending", "done", "cancelled", "deferred"]);
export type TodoItemStatusType = z.infer<typeof TodoItemStatus>;

const ItemSchema: z.ZodType<TodoItem> = z.lazy(() =>
  z.object({
    name: z.string(),
    status: TodoItemStatus.default("pending"),
    completed: z.string().datetime({ offset: true }).optional(),
    details: z.string().optional(),
    "agent-notes": z.string().optional(),
    items: z.array(ItemSchema).optional(),
  }),
);

export interface TodoItem {
  name: string;
  status: TodoItemStatusType;
  completed?: string | undefined;
  details?: string | undefined;
  "agent-notes"?: string | undefined;
  items?: TodoItem[] | undefined;
}

export const TodoListSchema: CardSchema = cardSchema("todo-list", {
  fields: {
    name: z.string(),
    details: z.string().optional(),
    "agent-notes": z.string().optional(),
    items: z.array(ItemSchema).optional(),
  },
  instructions: `# Todo Lists

Todo lists are human-oriented action items. They are NOT agent jobs —
they track things people need to do (errands, purchases, projects,
calls, etc.). Agents may create and maintain them but the work is for
humans.

## Structure

Frontmatter:
- \`name:\` — display name for the list
- \`details:\` — free-form description of the list's purpose/context
- \`agent-notes:\` — notes for agents about how to handle this list
  (not shown to users)
- \`items:\` — array of items, each \`{name, status, completed?,
  details?, agent-notes?, items?}\`. Items can nest via their own
  \`items\` field.

Status values: \`pending\`, \`done\`, \`cancelled\`, \`deferred\`.

When an item is completed, set \`status: done\` and add a \`completed\`
field with the ISO datetime.

## Storage

Active todo lists live in \`store/todos/\`. Filename:
\`List_Name.todo-list.card\`.

## Lifecycle

- **All done/cancelled** → move to \`store/archive/done/\`
- **All done/cancelled/deferred** (at least one deferred) → move to
  \`store/archive/deferred/\`
- **Any pending** → stays in \`store/todos/\`

## Guidelines

- Keep item names short and actionable
- Use \`details\` for supporting info, not the item name
- Use \`agent-notes\` for context the agent should remember (e.g.,
  "Boxholder mentioned this during the Feb 22 voice memo")
- Don't create separate todo lists for single items — add to an
  existing relevant list if one exists
- When extracting todos from voice memos or other inputs, group
  related items into lists by topic`,
});

export interface TodoListFields {
  type: "todo-list";
  name: string;
  details?: string;
  "agent-notes"?: string;
  items?: TodoItem[];
}

export function createTodoListTemplate(options: {
  name: string;
  details?: string;
  items?: Array<{ name: string; status?: string | undefined }>;
}): string {
  const fields: Record<string, unknown> = {
    name: options.name,
  };
  if (options.details !== undefined && options.details !== "") {
    fields["details"] = options.details;
  }
  if (options.items !== undefined && options.items.length > 0) {
    fields["items"] = options.items.map((it) => ({
      name: it.name,
      status: it.status === undefined ? "pending" : it.status,
    }));
  }
  return `---\n${stringifyYaml(fields)}---\n`;
}
