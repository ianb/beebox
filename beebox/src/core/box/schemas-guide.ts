/**
 * The box-local schema-authoring guide, installed at the box's schemas
 * directory as `CLAUDE.md`.
 *
 * It lives in its own module because it is one long string and `templates.ts`
 * holds several others; the v2 variant is DERIVED from v1 by substitution
 * rather than duplicated by hand, so the two cannot drift.
 */

const SCHEMAS_CLAUDE_MD = `# Writing Box-Local Schemas

Box-local schemas let you define new card types inside your box. Each schema is a \`.ts\` file
in \`config/schemas/\` that uses the same tools as built-in schemas.

**Default to the frontmatter form** (\`cardSchema\`) shown below: it produces standard cards —
YAML frontmatter plus a markdown body. Reach for the legacy \`element()\` / XML form only when
your card needs Markdoc-shaped inline content (see the end of this guide).

## Creating a Schema

Create a \`.ts\` file in \`config/schemas/\` that default-exports a \`cardSchema()\`:

\`\`\`typescript
import { body, cardSchema } from "beebox/cards";
import { z } from "zod";

export default cardSchema("my-type", {
  fields: {
    status: z.enum(["draft", "final"]).default("draft"),
    priority: z.enum(["low", "medium", "high"]).optional(),
    body: body(z.string()),  // omit this line if the card has no prose body
  },
  instructions: \\\`# My Type Cards

Instructions for the agent on how to handle this card type.
These appear in .claude/rules/ and _content/docs/generated/, and are loaded
when the agent reads or edits a matching card file.\\\`,
});
\`\`\`

The filename becomes the card type: \`config/schemas/task.ts\` → \`*.task.card\` files.

On disk, a card of this type is YAML frontmatter + markdown body:

\`\`\`
---
status: draft
priority: high
---
The markdown body (present only when the schema declares a \`body\` field).
\`\`\`

Key patterns:
- \`cardSchema(type, { fields, instructions? })\` is the entry point. \`fields\` is a flat object
  of Zod validators; nest with \`z.object\` / \`z.array\` as needed.
- \`body(z.string())\` declares the markdown body field — it must be named \`body\`. Omit it for a
  body-less card (then any non-empty body errors on load).
- \`type\` is the discriminator; don't list it under \`fields\`, and the on-disk YAML needn't carry
  it — the filename \`Foo.<type>.card\` supplies it.
- \`title\` and \`contains\` are available on every card type automatically.

## Validation beyond Zod — the \`validate\` hook

When a card type needs a rule Zod field types can't express — a cross-field
constraint, a format refinement, or checking the body's parsed structure — add a
\`validate\` hook to the schema. The rule lives **on the schema**, co-located with
the type it governs; \`bbx validate\` invokes it automatically.

\`\`\`typescript
import { cardSchema, type LintIssue } from "beebox/cards";
import { z } from "zod";

export default cardSchema("link", {
  validate: ({ fields }) => {
    const errors: LintIssue[] = [];
    const url = fields["url"];
    if (typeof url === "string" && !url.startsWith("https://")) {
      errors.push({ type: "validation", severity: "error", message: \`url must be https (got "\${url}")\` });
    }
    return errors;
  },
  fields: { url: z.string() },
});
\`\`\`

- The hook receives \`{ fields }\` — the parsed frontmatter, with the body at
  \`fields["body"]\` when the schema has one. Narrow values yourself (\`typeof\`).
- It is **self-contained**: it sees only this card's own data, never other cards
  or the box. Broken-ref checking is handled for you and is not its job.
- Return \`LintIssue[]\` (\`severity: "error"\` blocks; \`[]\` means clean).

## How the card appears in a list — the \`summarize\` hook

Every list in the box — search results, a directory listing, a todo list's
card headers — shows a card through its summary. By default that is the
card's \`title\` (or its filename), its \`contains\` sentence, and its mark.
Add \`summarize\` when the type can say something better about itself:

\`\`\`typescript
export default cardSchema("plant", {
  fields: { species: z.string(), lastWatered: z.string().optional() },
  summarize: (card, base) => ({
    ...base,
    detail: card.lastWatered === undefined ? "never watered" : \`watered \${card.lastWatered}\`,
  }),
});
\`\`\`

- \`card\` is this card's parsed fields, typed from your own \`fields\`.
- \`base\` is the standard summary (\`title\`, \`contains\`, \`symbol\`). Spread it
  and add \`detail\` — a short second line — or replace \`title\` outright.
- It runs only on a card that passed validation; one that failed keeps the
  filename summary.

## Available Imports

From \`beebox/cards\`:
- \`cardSchema(type, config)\` — define a frontmatter card schema
- \`body(zodSchema)\` — declare the single markdown body field
- \`summarize\` — the config hook above, for how the card reads in a list
- \`type LintIssue\` — the issue type a \`validate\` hook returns (see above)

From \`zod\`:
- \`z\` — Zod schema builder (z.string(), z.enum(), z.array(), etc.)

## Optional: Templates

Export a \`template\` to enable \`bbx create\` for your card type. For frontmatter schemas,
\`generate\` returns the card text — a YAML frontmatter block built with \`stringify\` from \`yaml\`:

\`\`\`typescript
import { cardSchema } from "beebox/cards";
import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";

export const template = {
  name: "task",
  description: "A task card",
  argsSchema: z.object({
    title: z.string().describe("Task title"),
    priority: z.enum(["low", "medium", "high"]).optional().describe("Priority level"),
  }),
  generate: (args: { title: string; priority?: string }) => {
    const fields: Record<string, unknown> = { status: "todo", title: args.title };
    if (args.priority !== undefined) fields.priority = args.priority;
    return "---\\n" + stringifyYaml(fields) + "---\\n";
  },
  cardTypes: ["task"],
  defaultForTypes: ["task"],
};

export default cardSchema("task", {
  // ... schema definition
});
\`\`\`

## After Adding or Modifying Schemas

Two independent things happen — don't conflate them:

**1. The card type works immediately.** Loading, validation, and rendering pick
up a new or edited schema on the next \`bbx\` command automatically, and the running
web server hot-reloads schema files on save too. You do **not** need to run
anything to "register" a schema — that was never what \`bbx engine init\` did.

**2. Regenerate the agent-facing docs from \`instructions\`** — this is what
\`bbx engine init\` is for:

\`\`\`bash
bbx engine init .
\`\`\`

This regenerates, from each schema's \`instructions\`:
- \`.claude/rules/card-<type>.md\` (auto-loaded when you edit a matching card)
- \`_content/docs/generated/card-<type>.md\`
and registers any \`template\` exports for \`bbx create\`. Run it after you add or
change a schema's \`instructions\` so the guidance an agent reads stays current. It
does not touch the running server's schema registration (a fresh \`bbx\` process
can't — and doesn't need to).

## Tips

- Keep schema files focused — one card type per file
- Always include \`instructions\` so the agent knows how to handle the card type
- Test with \`bbx validate\` after creating cards of the new type
`;

/**
 * v2 (package-layout) variant of the schemas guide: schemas live at
 * `src/schemas/` (the package root), not `config/schemas/` (the box root).
 * Derived by substitution rather than duplicated by hand so the two stay in
 * lockstep — everything else about writing a schema is identical.
 *
 * A box's schemas dir resolves only `beebox/*` specifiers, via the
 * package's own `node_modules` — bare `import ... from "zod"` / `from "yaml"`
 * don't resolve there, so those lines and the "Available Imports" section are
 * rewritten to the `beebox/schema` re-export instead.
 */
export const SCHEMAS_CLAUDE_MD_V2 = SCHEMAS_CLAUDE_MD.replaceAll("config/schemas/", "src/schemas/")
  .replaceAll("import { z } from \"zod\";", "import { z } from \"beebox/schema\";")
  .replace(
    "import { stringify as stringifyYaml } from \"yaml\";\nimport { z } from \"beebox/schema\";",
    "import { stringifyYaml, z } from \"beebox/schema\";"
  )
  .replace(
    "From `zod`:\n- `z` — Zod schema builder (z.string(), z.enum(), z.array(), etc.)",
    "From `beebox/schema`:\n" +
      "- `z` — Zod schema builder (z.string(), z.enum(), z.array(), etc.)\n" +
      "- `parseYaml`/`stringifyYaml` — YAML (de)serialization, e.g. for a `template.generate`"
  );
