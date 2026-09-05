/**
 * `bbx docs refresh` — regenerate this box's generated docs, card rules, and
 * managed box skills if the engine that wrote them has moved on.
 *
 * Script plumbing, not a surface anyone browses to: `deploy/deploy.sh` runs it
 * per box after `bbx migrate --sweep` so a box nobody chats with still converges
 * onto the shipped engine's guidance. The policy lives in
 * `src/core/docs-refresh.ts`.
 */

import { Command } from "commander";
import { requireBoxRoot } from "../../lib/paths.js";
import { refreshGeneratedDocs, type DocsRefreshResult } from "../../core/docs-refresh.js";
import { assertNever } from "../../lib/invariant.js";
import { errorMessage } from "../../lib/error-guards.js";

/**
 * Report the outcome and pick an exit code.
 *
 * Quiet on the ordinary path — a box whose docs are current prints nothing,
 * since this runs across every box on every deploy and routine success is
 * noise. Non-zero means a human needs to look, which for `deploy.sh` is
 * something to report without failing the deploy.
 */
async function runDocsRefresh(boxRoot: string): Promise<number> {
  const result: DocsRefreshResult = await refreshGeneratedDocs({ boxRoot });
  switch (result.status) {
    case "current":
      return 0;
    case "refreshed":
      console.log("Regenerated agent docs, card rules, and box skills.");
      return 0;
    case "skipped-dirty":
      console.warn("Working tree is not clean; skipped the generated-docs refresh. Commit or stash, and the next deploy will retry.");
      return 1;
    default:
      return assertNever(result);
  }
}

export const docsCommand = new Command("docs")
  .description("Generated agent documentation for this box")
  .addCommand(
    new Command("refresh")
      .description("Regenerate generated docs, card rules, and box skills when the engine that wrote them has moved on. A no-op when they are current; skips a dirty box. Run per box by deploy.sh.")
      .action(async () => {
        // Same wrapper `bbx init` uses: this runs unattended into a deploy log,
        // where a raw unhandled rejection is a stack trace nobody reads. One
        // line and a non-zero exit is what the deploy step reports.
        try {
          process.exit(await runDocsRefresh(await requireBoxRoot()));
        } catch (error) {
          console.error(`Error: ${errorMessage(error)}`);
          process.exit(1);
        }
      }),
  );
