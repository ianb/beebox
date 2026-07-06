/**
 * Shared leaf helpers and constants for doc generation.
 *
 * Lives below both `generate-docs.ts` (orchestration) and
 * `generate-docs-compile.ts` (compile/scan helpers) so both can depend on it
 * without forming an import cycle.
 */

export const AGENT_GUIDE_DIR = ".callback-box";
export const AGENT_GUIDE_FILE = "agent-guide.md";
export const DOCS_DIR = "docs/generated";

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
 * Uses the relative path from box root, e.g. "DOCID:docs/generated/card-question.md"
 */
export function withDocId(params: WithDocIdParams): string {
  const { relativePath, content, debug } = params;
  if (!debug) return content;
  return `<!-- DOCID:${relativePath} -->\n${content}`;
}
