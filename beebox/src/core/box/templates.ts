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

const TRICKS_PACKAGE_JSON = JSON.stringify(
  {
    name: "tricks",
    private: true,
    type: "module",
  },
  null,
  2
) + "\n";

/**
 * The schemas guide. How to write a box-local schema (cardSchema, the
 * validate and summarize hooks, imports, templates, regenerating docs) lives
 * in the package doc `schemas.md` (`docs/box/schemas.md`); this guide holds
 * the pointer, the frontmatter-form default, and the box's own conventions.
 */
const SCHEMAS_CLAUDE_MD_V2 = `# Writing Box-Local Schemas

Read \`${BOX_PACKAGE_DOCS}/schemas.md\` before adding or changing a schema in this directory.

**Default to the frontmatter form** (\`cardSchema\`): it produces standard cards —
YAML frontmatter plus a markdown body.

## This box's schemas

Add conventions this box's schemas share (naming, which card types exist and
why) here.
`;

/**
 * The tricks guide. Engine facts about tricks (script interface, how the engine
 * runs and commits a trick, secrets, dependencies) live in the package doc
 * `tricks.md` (`docs/box/tricks.md`); this guide holds the pointer, the
 * directory layout, and the box's own conventions.
 */
const TRICKS_CLAUDE_MD_V2 = `# Writing Tricks

Read \`${BOX_PACKAGE_DOCS}/tricks.md\` before writing, changing, or debugging a trick.

## Structure

\`\`\`
src/tricks/
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

## This box's tricks

Add conventions this box's tricks share (naming, shared helpers in \`lib/\`,
what each trick is for) here.
`;

/**
 * The views guide. The view API (exports, props, widgets, testing) lives in the
 * generated package doc `views.md` (`generateViewsDoc`); this guide holds the
 * attach-to-a-card-type rule, the pointer, and the box's own conventions.
 */
const VIEWS_CLAUDE_MD = `# Views Directory

This directory contains agent-generated React components (.tsx files) that render in the browser. **Every view is attached to a card type** via \`rendersCardTypes\`; there is no card-less standalone view.

**IMPORTANT: Read \`${BOX_PACKAGE_DOCS}/views.md\` before creating or modifying views.** It documents the required file format, the ViewProps API, dependency globs, and embedding syntax. Do not guess the format — read the doc.

## This box's views

Add conventions this box's views share (layout, shared components, which card
types have views) here.
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
  { name: "agent-feedback-guide", content: FEEDBACK_CLAUDE_MD },
  { name: "tricks-guide-v2", content: TRICKS_CLAUDE_MD_V2 },
  // The root briefing seed, installed by `installBriefing`. Unlike the guides
  // it is a card template (`createBriefingTemplate`), but it has the same
  // rollout problem: when the stock openers change, a box still carrying the
  // untouched previous seed must take the update rather than park it.
  { name: "briefing-seed", content: createBriefingTemplate() },
];
