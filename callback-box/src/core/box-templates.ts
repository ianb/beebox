/**
 * Static scaffold files installed into a box on init.
 *
 * These are the box-local guide/scaffold documents whose content is a large
 * embedded string (tricks scaffolding, the schemas authoring guide, the views
 * authoring guide). Each installer is a "create if missing" no-op on re-run, so
 * `cb init` can safely run repeatedly without clobbering user edits.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

const SCHEMAS_CLAUDE_MD = `# Writing Box-Local Schemas

Box-local schemas let you define new card types inside your box. Each schema is a \`.ts\` file
in \`config/schemas/\` that uses the same tools as built-in schemas.

## Creating a Schema

Create a \`.ts\` file in \`config/schemas/\` that exports a default \`ElementSchema\`:

\`\`\`typescript
import { element } from "cardworks";
import { z } from "zod";

export default element("my-type", {
  attrs: {
    status: z.enum(["draft", "final"]).default("draft"),
    priority: z.enum(["low", "medium", "high"]).optional(),
  },
  children: z.array(z.unknown()),
  instructions: \\\`# My Type Cards

Instructions for the agent on how to handle this card type.
These appear in .claude/rules/ and are loaded when the agent
reads or edits a matching card file.\\\`,
});
\`\`\`

The filename becomes the card type: \`config/schemas/task.ts\` → \`*.task.card\` files.

## Available Imports

From \`cardworks\`:
- \`element(tagName, config)\` — define a schema
- \`escapeText(str)\` — XML-escape text content
- \`escapeAttr(str)\` — XML-escape attribute values

From \`zod\`:
- \`z\` — Zod schema builder (z.string(), z.enum(), z.array(), etc.)

## Optional: Templates

Export a \`template\` to enable \`cb create\` support for your card type:

\`\`\`typescript
import { element, escapeText } from "cardworks";
import { z } from "zod";

export const template = {
  name: "task",
  description: "A task card",
  argsSchema: z.object({
    title: z.string().describe("Task title"),
    priority: z.enum(["low", "medium", "high"]).optional().describe("Priority level"),
  }),
  generate: (args: { title: string; priority?: string }) => {
    const now = new Date().toISOString();
    return \\\`<task status="todo"\${args.priority ? \\\` priority="\${args.priority}"\\\` : ""}>
  <created>\${now}</created>
  <title>\${escapeText(args.title)}</title>
  <description></description>
</task>
\\\`;
  },
  cardTypes: ["task"],
  defaultForTypes: ["task"],
};

export default element("task", {
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
- Update the agent guide with the new card type
- Register any templates for \`cb create\`

## Tips

- Keep schema files focused — one card type per file
- Always include \`instructions\` so the agent knows how to handle the card type
- Use \`z.unknown()\` for children if the card can contain arbitrary XML elements
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
 * Install schemas CLAUDE.md guide if it doesn't exist.
 */
export async function installSchemasGuide(boxRoot: string): Promise<void> {
  const claudeMdPath = path.join(boxRoot, "config/schemas/CLAUDE.md");
  try {
    await fs.access(claudeMdPath);
  } catch (_e) {
    // No schemas guide yet (fs.access throws ENOENT) — install it. The
    // error carries no actionable info; absence is the normal path.
    await fs.mkdir(path.join(boxRoot, "config/schemas"), { recursive: true });
    await fs.writeFile(claudeMdPath, SCHEMAS_CLAUDE_MD);
  }
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
