/**
 * Template bodies for the box's tracked guidance, and the tricks code scaffold.
 *
 * The nested CLAUDE.md guides and the briefing seed live in
 * `MANAGED_STOCK_TEMPLATES`, the content source for the registry's tracked
 * rows (`guidance-surfaces.ts`); `syncBoxGuidance` installs them through the
 * template tracker. The tricks `package.json` is code, not guidance, so
 * `initBox` seeds it once and never refreshes it.
 */

import { BOX_PACKAGE_DOCS } from "../docs-gen/shared.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { TEMPLATE_STOCK_HASHES } from "../template-stock-hashes.js";
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

To show a card's text, render its body with \`Markdown\` from
\`beebox/view-widgets\`: \`{card.body ? <Markdown card={card}>{card.body}</Markdown> : null}\`.
Any other rendering of card text (\`<p>{card.body}</p>\`, splitting the body,
a Markdown library) is a validation error; if \`Markdown\` lacks something the
view needs, say so in \`_config/feedback/\`.

After writing or changing a view, render-test it: \`bbx view test <slug>\` (loads
the real cards, renders once, prints the output or a source-mapped error).

Full documentation: \`${BOX_PACKAGE_DOCS}/views.md\`
`;

export const PUBLICATIONS_CLAUDE_MD = `# Publication Sites

Before creating, preparing, or changing a site, read \`${BOX_PACKAGE_DOCS}/publishing.md\`.

Independent publication sources live in child folders here. Read the shared
\`NOTES.md\` and apply only the \`All sites\`, matching \`Site: <name>\`, and
matching \`Path: <site>/<relative-path>\` notes. Keep source/build code and
private notes out of published output. A prepared site does not become live
until a signed-in member of this box enables it in the app; audience or
destination changes need fresh member approval.
`;

export const PUBLICATIONS_NOTES = `# Publication Notes

Private, box-owned notes for authoring the sites in this directory. These notes
are never part of a published release. Keep the headings and add only durable
lessons that help future work.

## All sites

Shared defaults and reusable lessons for every publication.

## Site: <name>

Decisions that apply only to one named publication.

## Path: <site>/<relative-path>

Notes for one part of a site. For example: \`field-guide/site/styles/\` in static
mode or \`field-guide/project/src/components/\` in project mode.
`;

export const FEEDBACK_CLAUDE_MD = `# Feedback about the Bee Box system

Use this directory only for observations about Bee Box itself: its commands,
interface, generated guidance, sync, or agent instructions. A problem with an
individual card's contents, the boxholder's project, or ordinary work in this
box belongs in that work, not here. A system behavior can qualify even when you
noticed it while handling a card.

Record a system observation here as a \`.doc.card\`. Use a specific title and a \`contains:\` summary so a
developer can find and understand it. Describe what happened, what you expected,
and why the difference matters. Include the relevant error or exchange under a
short **Context** heading, in your own words; link an earlier card for follow-ups.
Include a session ID only when you know which session it identifies. Use
box-relative paths such as \`/_config/box.json\` instead of machine paths.
Commit the card with your normal work.

These observations go from the agent to Bee Box developers.
\`.feedback.card\` is the boxholder's response to something the box surfaced.
`;

/** Write `content` to `filePath` only if nothing is there yet (ENOENT is the
 *  expected, silent "scaffold it" case — the error itself carries no
 *  actionable info). */
export async function writeFileIfMissing(filePath: string, content: string): Promise<void> {
  try {
    await fs.access(filePath);
  } catch (_e) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content);
  }
}

/**
 * Seed the tricks `package.json` if it is missing. A box's tricks live at
 * `boxRoot/src/tricks/` (`boxCodePaths` resolves it).
 */
export async function installTricksPackageJson(boxRoot: string): Promise<void> {
  const shape = await getBoxShape(boxRoot);
  await writeFileIfMissing(path.join(boxCodePaths(shape).tricksDir, "package.json"), TRICKS_PACKAGE_JSON);
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
  content: string;
}> = [
  // Each guide's box path is its row in GUIDANCE_SURFACES. Separate ledger
  // entries so a future divergence in any one guide never has to be threaded
  // through a shared entry.
  { name: "schemas-guide-v2", content: SCHEMAS_CLAUDE_MD_V2 },
  { name: "views-guide-v2", content: VIEWS_CLAUDE_MD },
  { name: "publications-guide-v1", content: PUBLICATIONS_CLAUDE_MD },
  { name: "agent-feedback-guide", content: FEEDBACK_CLAUDE_MD },
  { name: "tricks-guide-v2", content: TRICKS_CLAUDE_MD_V2 },
  // The root briefing seed, installed by `installBriefing`. Unlike the guides
  // it is a card template (`createBriefingTemplate`), but it has the same
  // rollout problem: when the stock openers change, a box still carrying the
  // untouched previous seed must take the update rather than park it.
  { name: "briefing-seed", content: createBriefingTemplate() },
];
