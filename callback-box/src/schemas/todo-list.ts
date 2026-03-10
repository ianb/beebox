/**
 * Todo list card schema — human-oriented task lists.
 *
 * Todo lists group related action items. Items can be nested
 * (sub-items within items) and have free-form details and agent notes.
 */

import { element, escapeText, escapeAttr } from "cardworks";
import { z } from "zod";

/**
 * Valid item statuses.
 */
export const TodoItemStatus = z.enum(["pending", "done", "cancelled", "deferred"]);
export type TodoItemStatusType = z.infer<typeof TodoItemStatus>;

/**
 * Agent notes child element — context for the agent about
 * how to handle this item or list.
 */
export const AgentNotesElement = element("agent-notes", {
  text: z.string(),
});

/**
 * Details child element — free-form description or notes.
 */
export const DetailsElement = element("details", {
  text: z.string(),
});

/**
 * Todo item element — a single action item.
 * Items can contain details, agent-notes, and nested child items.
 */
export const TodoItemElement: ReturnType<typeof element> = element("item", {
  attrs: {
    name: z.string(),
    status: TodoItemStatus.default("pending"),
    completed: z.string().datetime({ offset: true }).optional(),
  },
  children: z.array(
    z.union([
      DetailsElement,
      AgentNotesElement,
      z.lazy(() => TodoItemElement),
    ])
  ).optional(),
});

export type TodoItem = z.infer<typeof TodoItemElement>;

/**
 * Todo list card schema.
 *
 * Example:
 * ```xml
 * <todo-list name="Kitchen Remodel">
 * <details>Renovating the kitchen, started getting quotes in February</details>
 * <agent-notes>Ian prefers local contractors</agent-notes>
 * <item name="Get cabinet quotes" status="done" completed="2026-03-01T00:00:00Z">
 * <details>Called three places, went with HomeDepot</details>
 * </item>
 * <item name="Choose backsplash" status="pending">
 * <item name="Get tile samples" status="pending"/>
 * <item name="Check outlet covers" status="deferred"/>
 * </item>
 * </todo-list>
 * ```
 */
export const TodoListSchema = element("todo-list", {
  attrs: {
    name: z.string(),
  },
  children: z.array(
    z.union([DetailsElement, AgentNotesElement, TodoItemElement])
  ),
  instructions: `# Todo Lists

Todo lists are human-oriented action items. They are NOT agent jobs — they track things people need to do (errands, purchases, projects, calls, etc.). Agents may create and maintain them but the work is for humans.

## Structure

A todo list has a \`name\` attribute (display name) and contains:
- \`<details>\` — free-form description of the list's purpose/context
- \`<agent-notes>\` — notes for agents about how to handle this list (not shown to users)
- \`<item>\` — individual action items

Each \`<item>\` has a \`name\` attribute and a \`status\` attribute (\`pending\`, \`done\`, \`cancelled\`, \`deferred\`). Items can contain:
- \`<details>\` — extra info (phone numbers, addresses, notes)
- \`<agent-notes>\` — agent context for this item
- Nested \`<item>\` elements for sub-tasks

When an item is completed, set \`status="done"\` and add a \`completed\` attribute with the ISO datetime.

## Storage

Active todo lists live in \`store/todos/\`. Filename: \`List_Name.todo-list.card\`.

## Lifecycle

- **All done/cancelled** → move to \`store/archive/done/\`
- **All done/cancelled/deferred** (at least one deferred) → move to \`store/archive/deferred/\`
- **Any pending** → stays in \`store/todos/\`

## Guidelines

- Keep item names short and actionable
- Use details for supporting info, not the item name
- Use agent-notes for context the agent should remember (e.g., "Ian mentioned this during the Feb 22 voice memo")
- Don't create separate todo lists for single items — add to an existing relevant list if one exists
- When extracting todos from voice memos or other inputs, group related items into lists by topic`,
});

export type TodoList = z.infer<typeof TodoListSchema>;

/**
 * Template for creating a new todo list.
 */
export function createTodoListTemplate(options: {
  name: string;
  details?: string | undefined;
  items?: Array<{ name: string; status?: string | undefined }> | undefined;
}): string {
  let xml = `<todo-list name="${escapeAttr(options.name)}">`;
  if (options.details) {
    xml += `\n<details>${escapeText(options.details)}</details>`;
  }
  if (options.items) {
    for (const item of options.items) {
      const status = item.status || "pending";
      xml += `\n<item name="${escapeAttr(item.name)}" status="${escapeAttr(status)}"/>`;
    }
  }
  xml += "\n</todo-list>\n";
  return xml;
}
