/**
 * Static scaffold files installed into a box on init.
 *
 * These are the box-local guide/scaffold documents whose content is a large
 * embedded string (tricks scaffolding, the schemas authoring guide, the views
 * authoring guide). The tricks and views installers are "create if missing"
 * no-ops on re-run; the schemas guide goes through the template tracker
 * (refresh-if-unmodified, park-if-edited) so its frontmatter-first rewrite
 * reaches boxes that still carry the old XML-only version. Either way, `bbx
 * init` can run repeatedly without clobbering user edits.
 */

import { BOX_PACKAGE_DOCS } from "../docs-gen/shared.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { installTemplateFile } from "../install-template-file.js";
import { TEMPLATE_STOCK_HASHES } from "../template-stock-hashes.js";
import { boxCodePaths, getBoxShape } from "../../lib/box-shape.js";
import { createBriefingTemplate } from "../../schemas/briefing.js";
import { SCHEMAS_CLAUDE_MD_V2 } from "./schemas-guide.js";

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
      secrets.json     <- optional declared credentials for this trick
      index.ts        <- bbx trick clean-inbox
    summarize/
      index.ts        <- bbx trick summarize
\`\`\`

**Every trick must be a directory** -- never put a \`.ts\` file directly in \`tricks/scripts/\`.

## Script Interface

Tricks are standalone TypeScript programs. Environment variables provide context:

- \`BBX_BOX_ROOT\` -- absolute path to the box root
- \`BBX_TRICK_NAME\` -- the trick name (e.g. "clean-inbox"), useful for usage/help output
- declared secrets are injected only into this trick's child process environment
- \`process.argv.slice(2)\` -- extra arguments after the trick name

\`\`\`typescript
import * as fs from "node:fs/promises";
import * as path from "node:path";

export const description = "Short description shown in bbx trick list";

const boxRoot = process.env.BBX_BOX_ROOT!;
const trickName = process.env.BBX_TRICK_NAME!;
const args = process.argv.slice(2);

const inboxDir = path.join(boxRoot, "_content/inbox");
console.log("Done!");
\`\`\`

The \`export const description\` line is parsed (not executed) by \`bbx trick\` for the listing.

If the trick needs a credential, add a \`secrets.json\` beside \`index.ts\`:

\`\`\`json
[{"name":"openai-images","reason":"image-generation","env":"OPENAI_API_KEY"}]
\`\`\`

The boxholder must supply and grant the secret. \`bbx trick <name>\` resolves
declared secrets at launch and injects them only into that trick process. Never
write a resolved value to a file, argument, or log.

## Running

- \`bbx trick\` -- list all tricks with descriptions
- \`bbx trick <name>\` -- run a trick
- \`bbx trick <name> arg1 arg2\` -- pass arguments

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
- Use \`bbx\` commands (via \`child_process\`) for card operations
- The subprocess cwd is \`tricks/\`, so package resolution works naturally
`;

/**
 * v2 (package-layout) variant of the tricks guide: tricks live at
 * `src/tricks/` (the package root), not `tricks/` (the box root). Derived by
 * substitution so the two stay in lockstep.
 */
const TRICKS_CLAUDE_MD_V2 = TRICKS_CLAUDE_MD
  .replaceAll("tricks/", "src/tricks/")
  .replace("cd tricks &&", "cd src/tricks &&")
  .replace("into the tricks directory", "into the src/tricks directory");

const VIEWS_CLAUDE_MD = `# Views Directory

This directory contains agent-generated React components (.tsx files) that render in the browser. **Every view is attached to a card type** via \`rendersCardTypes\` — it becomes that type's interface on card pages, in chat embeds, and in the companion pane. There is no card-less standalone view.

**IMPORTANT: Read \`${BOX_PACKAGE_DOCS}/views.md\` before creating or modifying views.** It documents the required file format, the ViewProps API, dependency globs, and embedding syntax. Do not guess the format — read the doc.

## Quick Reference

Each view must export:
- \`name\` (string) — display name
- \`description\` (string) — what the view shows
- \`dependencies\` (string[]) — glob patterns for cards that affect rendering
- \`modes\` (string[]) — \`"page"\`, \`"chat"\`, or both
- \`rendersCardTypes\` (string[]) — the card type(s) this view renders
- \`default\` function component receiving \`{ cards, navigate, boxSlug, params, viewHistory }\` (\`params.path\` is the card being rendered; \`viewHistory\` explicitly preserves JSON-safe navigation state)

React is provided automatically — do not import it.

To link or embed another card, import \`CardLink\`/\`CardRef\` from
\`beebox/view-widgets\` (point at cards with \`cardRef="/_content/…"\`, not a
hand-rolled \`<a>\`) — see the "Card-aware widgets" section in the doc.

After writing or changing a view, render-test it: \`bbx view test <slug>\` (loads
the real cards, renders once, prints the output or a source-mapped error).

Full documentation: \`${BOX_PACKAGE_DOCS}/views.md\`
`;

/**
 * Install tricks scaffold files (package.json, CLAUDE.md) if they don't
 * exist. A box's tricks live at `boxRoot/src/tricks/` (`boxCodePaths`
 * resolves it).
 */
/** Write `content` to `filePath` only if nothing is there yet (ENOENT is the
 *  expected, silent "scaffold it" case — the error itself carries no
 *  actionable info). */
async function writeFileIfMissing(filePath: string, content: string): Promise<void> {
  try {
    await fs.access(filePath);
  } catch (_e) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content);
  }
}

export async function installTricksFiles(boxRoot: string): Promise<void> {
  const shape = await getBoxShape(boxRoot);
  const tricksDir = boxCodePaths(shape).tricksDir;

  await writeFileIfMissing(path.join(tricksDir, "package.json"), TRICKS_PACKAGE_JSON);

  // The CLAUDE.md guide goes through the template tracker like the
  // schemas/views guides, so `bbx upgrade` can roll out future guide changes
  // without clobbering a customized copy.
  await installTemplateFile({
    boxRoot,
    relPath: "src/tricks/scripts/CLAUDE.md",
    templateContent: TRICKS_CLAUDE_MD_V2,
    priorStockHashes: TEMPLATE_STOCK_HASHES["tricks-guide-v2"].superseded,
  });
}

/**
 * The template files that ship with a `priorStockHashes` allowlist — the
 * box-local CLAUDE.md guides an agent reads. Each maps a ledger key
 * (`TEMPLATE_STOCK_HASHES`) to its live content. Kept as a registry so the
 * forcing-function test and `pnpm template-stock:update` can iterate them: the
 * test fails if any content's hash drifts from the ledger's `current`, which is
 * what keeps every superseded hash recorded (and thus rollouts non-parking).
 */
export const MANAGED_STOCK_TEMPLATES: ReadonlyArray<{
  name: keyof typeof TEMPLATE_STOCK_HASHES;
  relPath: string;
  content: string;
}> = [
  // Under `src/` at the (one) box root. Separate ledger entries so a future
  // divergence in any one guide never has to be threaded through a shared
  // entry.
  { name: "schemas-guide-v2", relPath: "src/schemas/CLAUDE.md", content: SCHEMAS_CLAUDE_MD_V2 },
  { name: "views-guide-v2", relPath: "src/views/CLAUDE.md", content: VIEWS_CLAUDE_MD },
  { name: "tricks-guide-v2", relPath: "src/tricks/scripts/CLAUDE.md", content: TRICKS_CLAUDE_MD_V2 },
  // The root briefing seed. Unlike the guides it lives under `_content/`
  // (it's a card template, `createBriefingTemplate`), but it has the same
  // rollout problem: when the stock openers change, a box still carrying the
  // untouched previous seed must take the update rather than park it.
  { name: "briefing-seed", relPath: "_content/briefing.briefing.card", content: createBriefingTemplate() },
];

/**
 * Install (or refresh) the box-local schemas guide.
 *
 * Goes through the template tracker: refreshed when unmodified, parked under
 * `_config/_template-updates/` when the boxholder has customized it (prior
 * stock hashes come from the ledger so a box on any shipped version overwrites
 * cleanly). The copy lives at `src/schemas/CLAUDE.md` — tracker coverage from
 * a fresh `bbx engine init` is what lets `bbx upgrade` (Track E) roll out guide
 * updates later without clobbering a customized copy.
 */
export async function installSchemasGuide(boxRoot: string): Promise<void> {
  await installTemplateFile({
    boxRoot,
    relPath: "src/schemas/CLAUDE.md",
    templateContent: SCHEMAS_CLAUDE_MD_V2,
    priorStockHashes: TEMPLATE_STOCK_HASHES["schemas-guide-v2"].superseded,
  });
}

/**
 * Install (or refresh) the box-local views guide. Same template-tracker path as
 * `installSchemasGuide` above; the guide's text needs no path substitution
 * (it never names its own directory).
 */
export async function installViewsGuide(boxRoot: string): Promise<void> {
  await installTemplateFile({
    boxRoot,
    relPath: "src/views/CLAUDE.md",
    templateContent: VIEWS_CLAUDE_MD,
    priorStockHashes: TEMPLATE_STOCK_HASHES["views-guide-v2"].superseded,
  });
}
