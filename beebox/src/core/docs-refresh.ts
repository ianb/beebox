/**
 * Refresh generated docs as ordinary box work. Docs refresh never takes box
 * maintenance: it writes engine output that chat agents do not edit, the same
 * generator runs unguarded at every chat start, and closing the box for it
 * ended running chats (docs/plans/maintenance-live-tasks.md, Track 1).
 */
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { withBoxWork } from "../lib/box-maintenance/admission.js";
import { getBoxShape } from "../lib/box-shape.js";
import { errorMessage } from "../shared/error-guards.js";
import { generateDocs, generatedDocsAreCurrent, GENERATE_MARKER, readGenerateMarker } from "./docs-gen/generate/core.js";
import { ensureEngineDocs } from "./docs-gen/box-docs.js";

export interface DocsRefreshResult { readonly status: "current" | "refreshed" }
class DocsRefreshError extends Error {
  constructor(cause: unknown) {
    super(`Docs refresh failed: ${errorMessage(cause)}. Generated output is left uncommitted; the next refresh regenerates and commits it.`, { cause });
    this.name = "DocsRefreshError";
  }
}

/** A read, not a decision: stale generated output means work. */
export async function docsRefreshHasWork(boxRoot: string): Promise<boolean> {
  return !(await generatedDocsAreCurrent(boxRoot));
}

/**
 * Admitted as box work, so a caller inside maintenance (the sweep's
 * `maintenance.run`, deploy's `BBX_BOX_WORK`) joins its owner's permit.
 */
export async function refreshGeneratedDocs(opts: { boxRoot: string }): Promise<DocsRefreshResult> {
  const shape = await getBoxShape(opts.boxRoot);
  await ensureEngineDocs();
  return withBoxWork({ boxRoot: shape.boxRoot, reason: "docs refresh" }, async (): Promise<DocsRefreshResult> => {
    if (!(await docsRefreshHasWork(shape.boxRoot))) return { status: "current" };
    const before = await readGenerateMarker(opts.boxRoot);
    try {
      await generateDocs(opts.boxRoot, { commit: { message: "Refresh generated docs", trailers: { "Created-By": "docs-refresh" } } });
    } catch (error) {
      // A missing marker keeps the box stale, so the next refresh retries.
      await rm(join(opts.boxRoot, GENERATE_MARKER), { force: true });
      throw new DocsRefreshError(error);
    }
    return { status: (await readGenerateMarker(opts.boxRoot)) === before ? "current" : "refreshed" };
  });
}
