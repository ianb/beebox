/**
 * Shared leaf helpers and constants for doc generation.
 *
 * Lives below both `generate-docs.ts` (orchestration) and
 * `generate-docs-compile.ts` (compile/scan helpers) so both can depend on it
 * without forming an import cycle.
 */

export const AGENT_GUIDE_DIR = ".beebox";
export const AGENT_GUIDE_FILE = "agent-guide.md";
/** Box-relative dir for docs compiled from THIS box's content (guides,
 *  personality, box-local card types). Engine docs are not here — see
 *  BOX_PACKAGE_DOCS. */
export const DOCS_DIR = "_content/docs/generated";

/** Name of the engine-docs directory inside the beebox package root. */
export const PACKAGE_DOCS_DIR_NAME = "box-docs";

/**
 * Box-relative path of the engine docs — the reference docs about beebox
 * itself (card types, `bbx` commands, connectors, views, …). They live in the
 * installed package, not the box, so they can never lag the engine that
 * reads them; every pointer an agent sees is built from this constant.
 * Mechanism: `package-docs.ts`.
 */
export const BOX_PACKAGE_DOCS = `node_modules/beebox/${PACKAGE_DOCS_DIR_NAME}`;

/**
 * Parameters for withDocId
 */
interface WithDocIdParams {
  relativePath: string;
  content: string;
  debug: boolean;
}

/**
 * Optionally prepend a DOCID marker comment to content.
 * Uses the relative path from box root, e.g. "DOCID:.beebox/agent-guide.md"
 */
export function withDocId(params: WithDocIdParams): string {
  const { relativePath, content, debug } = params;
  if (!debug) return content;
  return `<!-- DOCID:${relativePath} -->\n${content}`;
}
