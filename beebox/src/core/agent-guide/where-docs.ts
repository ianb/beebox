/**
 * "Where the docs are" — the one place the always-loaded guide tells an agent
 * where beebox's reference docs live and how to find the right one. The docs
 * themselves ship in the installed package (`package-docs.ts`), so this section
 * is a pointer, not a summary: the index file is what to open.
 */

import { BOX_PACKAGE_DOCS, DOCS_DIR } from "../docs-gen/shared.js";

export function whereTheDocsAreSection({ engineSourcePresent }: { engineSourcePresent: boolean }): string {
  const source = engineSourcePresent ?
    " When a doc doesn't settle it, the engine's source is at `node_modules/beebox/src/`." :
    "";
  return `## Where the docs are

Reference docs about beebox itself — every card type, the \`bbx\` command reference, connectors, views, procedures, triage, chat voice — are in the installed package at \`${BOX_PACKAGE_DOCS}/\`. Start with \`${BOX_PACKAGE_DOCS}/README.md\`: one line per doc saying when to read it. Read the doc before answering a question about how something works or before working with a type you don't know; don't reconstruct a mechanism from memory.${source} Docs compiled from this box's own content — its guides, personality, and box-local card types — are in \`${DOCS_DIR}/\`.`;
}
