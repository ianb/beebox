/**
 * Static scaffold files installed into a box on init.
 *
 * These are the box-local guide/scaffold documents whose content is a large
 * embedded string (tricks scaffolding, the schemas authoring guide, the views
 * authoring guide). The tricks and views installers are "create if missing"
 * no-ops on re-run; the schemas guide goes through the template tracker
 * (refresh-if-unmodified, park-if-edited) so its frontmatter-first rewrite
 * reaches boxes that still carry the old XML-only version. Either way, `cb
 * init` can run repeatedly without clobbering user edits.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { installTemplateFile } from "./install-template-file.js";

const SCHEMAS_CLAUDE_MD = `# Writing Box-Local Schemas

Box-local schemas let you define new card types inside your box. Each schema is a \`.ts\` file
in \`config/schemas/\` that uses the same tools as built-in schemas.

**Default to the frontmatter form** (\`cardSchema\`) shown below: it produces standard cards —
YAML frontmatter plus a markdown body. Reach for the legacy \`element()\` / XML form only when
your card needs Markdoc-shaped inline content (see the end of this guide).

## Creating a Schema

Create a \`.ts\` file in \`config/schemas/\` that default-exports a \`cardSchema()\`:

\`\`\`typescript
import { body, cardSchema } from "callback-box/cards";
import { z } from "zod";

export default cardSchema("my-type", {
  fields: {
    status: z.enum(["draft", "final"]).default("draft"),
    priority: z.enum(["low", "medium", "high"]).optional(),
    body: body(z.string()),  // omit this line if the card has no prose body
  },
  instructions: \\\`# My Type Cards

Instructions for the agent on how to handle this card type.
These appear in .claude/rules/ and docs/generated/, and are loaded
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

## Available Imports

From \`callback-box/cards\`:
- \`cardSchema(type, config)\` — define a frontmatter card schema (the default)
- \`body(zodSchema)\` — declare the single markdown body field

From \`cardworks\` (legacy — only for \`element()\` XML schemas, see below):
- \`element(tagName, config)\` — define a legacy XML schema
- \`escapeText(str)\` / \`escapeAttr(str)\` — XML-escape helpers

From \`zod\`:
- \`z\` — Zod schema builder (z.string(), z.enum(), z.array(), etc.)

## Optional: Templates

Export a \`template\` to enable \`cb create\` for your card type. For frontmatter schemas,
\`generate\` returns the card text — a YAML frontmatter block built with \`stringify\` from \`yaml\`:

\`\`\`typescript
import { cardSchema } from "callback-box/cards";
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

Run \`cb init\` to regenerate rules and documentation:

\`\`\`bash
cb init .
\`\`\`

This will:
- Generate \`.claude/rules/card-<type>.md\` (if the schema has \`instructions\`)
- Generate \`docs/generated/card-<type>.md\`
- Register any templates for \`cb create\`

Schema changes are picked up on the next \`cb\` invocation; a running dev server needs a restart.

## Legacy: XML / \`element()\` schemas

Use \`element()\` only when the card body is Markdoc-shaped inline content — nested, attributed
inline structure that doesn't fit YAML frontmatter. This is why the built-in \`guide\` and
\`capture-session\` types still use it. For everything else, prefer \`cardSchema\` above.

\`\`\`typescript
import { element } from "cardworks";
import { z } from "zod";

export default element("note", {
  attrs: {
    status: z.enum(["draft", "final"]).default("draft"),
  },
  children: z.array(z.unknown()),
  instructions: \\\`# Note Cards

Instructions for the agent on how to handle this card type.\\\`,
});
\`\`\`

A legacy template's \`generate\` emits XML instead of YAML, using \`escapeText\` / \`escapeAttr\` for
interpolated values. See the built-in XML schemas in callback-box's \`src/schemas/\` for examples.

## Tips

- Keep schema files focused — one card type per file
- Always include \`instructions\` so the agent knows how to handle the card type
- Test with \`cb validate\` after creating cards of the new type
`;

const TRICKS_PACKAGE_JSON = JSON.stringify(
  {
    name: "tricks",
    private: true,
    type: "module",
  },
  null,
  2
) + "\n";

const TRICKS_CLAUDE_MD = `# Writing Tricks

Tricks are custom TypeScript scripts that extend your box's capabilities.
Each trick runs as a standalone subprocess via tsx with its own package context,
so you can install and import npm packages.

## Structure

Each trick is a directory under \`tricks/scripts/\` with an \`index.ts\` entry point:

\`\`\`
tricks/
  package.json        <- npm dependencies for tricks
  node_modules/       <- installed packages (gitignored)
  lib/                <- Shared utilities (import with relative paths)
  scripts/
    CLAUDE.md         <- This file
    clean-inbox/
      index.ts        <- cb trick clean-inbox
    summarize/
      index.ts        <- cb trick summarize
\`\`\`

**Every trick must be a directory** -- never put a \`.ts\` file directly in \`tricks/scripts/\`.

## Script Interface

Tricks are standalone TypeScript programs. Environment variables provide context:

- \`CB_BOX_ROOT\` -- absolute path to the box root
- \`CB_TRICK_NAME\` -- the trick name (e.g. "clean-inbox"), useful for usage/help output
- \`process.argv.slice(2)\` -- extra arguments after the trick name

\`\`\`typescript
import * as fs from "node:fs/promises";
import * as path from "node:path";

export const description = "Short description shown in cb trick list";

const boxRoot = process.env.CB_BOX_ROOT!;
const trickName = process.env.CB_TRICK_NAME!;
const args = process.argv.slice(2);

const inboxDir = path.join(boxRoot, "box/inbox");
console.log("Done!");
\`\`\`

The \`export const description\` line is parsed (not executed) by \`cb trick\` for the listing.

## Running

- \`cb trick\` -- list all tricks with descriptions
- \`cb trick <name>\` -- run a trick
- \`cb trick <name> arg1 arg2\` -- pass arguments

## Dependencies

Install packages into the tricks directory:

\`\`\`bash
cd tricks && pnpm add <package>
\`\`\`

These are available to all tricks via normal imports.

## Shared Code

Put reusable utilities in \`tricks/lib/\` and import them with relative paths:

\`\`\`typescript
import { helper } from "../../lib/helper.js";
\`\`\`

## Tips

- Use \`node:fs/promises\` and \`node:path\` for file operations
- Tricks run via tsx as subprocesses -- no build step needed
- Keep tricks focused on a single task
- Use \`cb\` commands (via \`child_process\`) for card operations
- The subprocess cwd is \`tricks/\`, so package resolution works naturally
`;

const VIEWS_CLAUDE_MD = `# Views Directory

This directory contains agent-generated React components (.tsx files) that render in the browser.

**IMPORTANT: Read \`docs/generated/views.md\` before creating or modifying views.** It documents the required file format, the ViewProps API, dependency globs, and embedding syntax. Do not guess the format — read the doc.

## Quick Reference

Each view must export:
- \`name\` (string) — display name
- \`description\` (string) — what the view shows
- \`dependencies\` (string[]) — glob patterns for cards that affect rendering
- \`modes\` (string[]) — \`"page"\`, \`"chat"\`, or both
- \`default\` function component receiving \`{ cards, navigate, boxSlug, params }\`

React is provided automatically — do not import it.

Full documentation: \`docs/generated/views.md\`
`;

/**
 * Install tricks scaffold files (package.json, CLAUDE.md) if they don't exist.
 */
export async function installTricksFiles(boxRoot: string): Promise<void> {
  const packageJsonPath = path.join(boxRoot, "tricks/package.json");
  try {
    await fs.access(packageJsonPath);
  } catch (_e) {
    // No tricks package.json yet (fs.access throws ENOENT) — scaffold it.
    // The error carries no actionable info; absence is the normal path.
    await fs.mkdir(path.join(boxRoot, "tricks"), { recursive: true });
    await fs.writeFile(packageJsonPath, TRICKS_PACKAGE_JSON);
  }

  const claudeMdPath = path.join(boxRoot, "tricks/scripts/CLAUDE.md");
  try {
    await fs.access(claudeMdPath);
  } catch (_e) {
    // No tricks CLAUDE.md yet (fs.access throws ENOENT) — scaffold it. The
    // error carries no actionable info; absence is the normal path.
    await fs.mkdir(path.join(boxRoot, "tricks/scripts"), { recursive: true });
    await fs.writeFile(claudeMdPath, TRICKS_CLAUDE_MD);
  }
}

/**
 * sha256 of the pre-frontmatter, XML-only schemas guide shipped before the
 * guide adopted the template tracker. Every box installed by an older
 * callback-box has this exact file; recognizing it lets the new
 * frontmatter-first guide overwrite the stale one (which actively steers box
 * agents toward `element()`/XML) while still parking any guide a boxholder
 * has actually edited.
 */
const OLD_XML_SCHEMAS_GUIDE_SHA256 =
  "127bdcaa2598ad8664037bd01659e8f23d4fcd5af493788102b9387b090b5452";

/**
 * Install (or refresh) the box-local schemas guide. Uses the template tracker
 * so the stock guide is refreshed when unmodified and parked under
 * `config/_template-updates/` when the boxholder has customized it.
 */
export async function installSchemasGuide(boxRoot: string): Promise<void> {
  await installTemplateFile({
    boxRoot,
    relPath: "config/schemas/CLAUDE.md",
    templateContent: SCHEMAS_CLAUDE_MD,
    priorStockHashes: [OLD_XML_SCHEMAS_GUIDE_SHA256],
  });
}

/**
 * Install views CLAUDE.md guide if it doesn't exist.
 */
export async function installViewsGuide(boxRoot: string): Promise<void> {
  const claudeMdPath = path.join(boxRoot, "views/CLAUDE.md");
  try {
    await fs.access(claudeMdPath);
  } catch (_e) {
    // No views guide yet (fs.access throws ENOENT) — install it. The error
    // carries no actionable info; absence is the normal path.
    await fs.mkdir(path.join(boxRoot, "views"), { recursive: true });
    await fs.writeFile(claudeMdPath, VIEWS_CLAUDE_MD);
  }
}
