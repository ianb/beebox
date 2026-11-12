/** Explicit generated-guidance convergence, admitted as ordinary box work. */
import { Command } from "commander";
import { requireBoxRoot } from "../../lib/paths/core.js";
import { refreshGeneratedDocs } from "../../core/docs-refresh.js";
import { errorMessage } from "../../shared/error-guards.js";

interface RefreshOptions {
  json?: boolean;
}

export const docsCommand = new Command("docs")
  .description("Generated agent documentation for this box")
  .addCommand(
    new Command("refresh")
      .description(
        "Refresh stale docs, card rules, and box skills, leaving other uncommitted work alone",
      )
      .option("--json", "Report the result as JSON")
      .option(
        "--within-maintenance",
        "Accepted for older deploy scripts; the invoking permit admits the refresh either way",
      )
      .action(async (options: RefreshOptions) => {
        try {
          const result = await refreshGeneratedDocs({ boxRoot: await requireBoxRoot() });
          if (options.json) console.log(JSON.stringify(result));
          else if (result.status === "refreshed")
            console.log("Regenerated agent docs, card rules, and box skills.");
        } catch (error) {
          if (options.json)
            console.log(
              JSON.stringify({ status: "failed", error: errorMessage(error) }),
            );
          else console.error(`Error: ${errorMessage(error)}`);
          process.exitCode = 1;
        }
      }),
  );
