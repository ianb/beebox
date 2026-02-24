# Knowledge Test Report — 2026-02-23T05:04:22.329Z

Box: /Users/ianbicking/src/boxes/scenarios/knowledge/box
Tests run: 1

## create-new-card-type
**Prompt:** "How would you create a brand new card type for this box?"
**Expected level:** discoverable
**Watch for:** Navigates to config/schemas/ and finds CLAUDE.md

**Agent behavior:**
- Files read: (none)
- Searches: (none)
- Response length: 243 words

**Response:**
> [thinking]
> Here's how you'd create a new card type:
> 
> ### 1. Create a schema file in `config/schemas/`
> 
> For example, `config/schemas/task.ts`:
> 
> ```typescript
> import { element } from "cardworks";
> import { z } from "zod";
> 
> export default element("task", {
>   attrs: {
>     status: z.enum(["todo", "in-progress", "done"]).default("todo"),
>     priority: z.enum(["low", "medium", "high"]).optional(),
>   },
>   children: z.array(z.unknown()),
>   instructions: `# Task Cards
> 
> Task cards track work items.
> 
> ## Fields
> - **status** — todo, in-progress, or done
> - **priority** — low, medium, or high (optional)
> `,
> });
> ```
> 
> Key parts of the schema:
> - **`element(tagName, config)`** — defines the XML root element name
> - **`attrs`** — Zod schemas for XML attributes (with defaults, enums, optionals)
> - **`children`** — schema for child elements
> - **`instructions`** — markdown guidance for agents working with this card type
> 
> ### 2. Optionally export a template
> 
> In the same file, export a `template` to enable `cb create -t <name>`:
> 
> ```typescript
> export const template = {
>   name: "task",
>   description: "A task card",
>   argsSchema: z.object({
>     title: z.string().describe("Task title"),
>   }),
>   generate: (args) => `<task status="todo">\n  <title>${args.title}</title>\n</task>`,
>   cardTypes: ["task"],
>   defaultForTypes: ["task"],
> };
> ```
> 
> ### 3. Run `cb init .`
> 
> This auto-generates:
> - **`.claude/rules/card-task.md`** — agent rules (loaded when editing `*.task.card` files)
> - **`docs/generated/card-task.md`** — documentation
> - Updates the agent guide with the new type
> 
> ### 4. Create cards
> 
> Cards are XML files named `*.task.card`, validated with `cb validate`:
> 
> ```xml
> <task status="todo" priority="high">
>   <title>My first task</title>
> </task>
> ```
> 
> You can look at the existing `config/schemas/bookmark.ts` for a real working example in this box.

**Automated checks:**
- ✗ Read config/schemas/CLAUDE.md

**Assessment:** (to be filled in during evaluation)

---
