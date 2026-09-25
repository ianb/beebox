/** Explicit generated-guidance convergence, sharing migration admission and Git recovery. */
import { Command } from "commander";
import { requireBoxRoot } from "../../lib/paths.js";
import { refreshGeneratedDocs } from "../../core/docs-refresh.js";
import { errorMessage } from "../../lib/error-guards.js";

interface RefreshOptions {
  json?: boolean;
  withinMaintenance?: boolean;
}

export const docsCommand = new Command("docs")
  .description("Generated agent documentation for this box")
  .addCommand(
    new Command("refresh")
      .description(
        "Refresh stale docs, card rules, and box skills, preserving dirty input in Git",
      )
      .option("--json", "Report the result as JSON")
      .option(
        "--within-maintenance",
        "Join the invoking maintenance controller",
      )
      .action(async (options: RefreshOptions) => {
        try {
          const result = await refreshGeneratedDocs({
            boxRoot: await requireBoxRoot(),
            withinMaintenance: options.withinMaintenance === true,
          });
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
