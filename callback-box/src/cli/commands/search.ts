/**
 * cb search - Full-text search over the box's cards.
 *
 * Thin wrapper around the core search command. With --json, the structured
 * envelope ({results, total, truncated, hint, warnings, stale}) prints
 * instead of the human listing.
 */

import { Command } from "commander";
import { requireBoxRoot } from "../../lib/paths.js";
import {
  runCommand,
  createCliContext,
  createCollectorContext,
} from "../../core/commands/index.js";
import { errorMessage } from "../../lib/error-guards.js";

interface SearchCliOptions {
  kind?: string[];
  path?: string;
  limit?: string;
  json?: boolean;
  rebuild?: boolean;
  mode?: string;
}

export const searchCommand = new Command("search")
  .description("Full-text search over the box's cards")
  .argument("<query>", "Search terms")
  .option("--kind <type...>", "Restrict to one or more card types")
  .option("--path <prefix>", "Restrict to a box-relative path prefix")
  .option("--limit <n>", "Maximum results (default 10)")
  .option("--json", "Output the structured result envelope as JSON")
  .option("--rebuild", "Rebuild the index from scratch before searching")
  .option("--mode <mode>", "Ranking mode: hybrid (semantic + text) or text; omitted = auto")
  .action(async (query: string, options: SearchCliOptions) => {
    try {
      const boxRoot = await requireBoxRoot();
      const limit = options.limit === undefined ? undefined : Number.parseInt(options.limit, 10);
      if (limit !== undefined && (Number.isNaN(limit) || limit < 1)) {
        console.error(`Error: --limit must be a positive integer (got: "${options.limit ?? ""}")`);
        process.exit(1);
      }

      const args = {
        query,
        kinds: options.kind,
        path: options.path,
        limit,
        rebuild: options.rebuild,
        mode: options.mode,
      };

      if (options.json === true) {
        const { ctx } = createCollectorContext(boxRoot);
        const result = await runCommand({ name: "search", args, ctx });
        if (!result.success) {
          console.error(`Error: ${result.error}`);
          process.exit(1);
        }
        console.log(JSON.stringify(result.data, null, 2));
        return;
      }

      const result = await runCommand({
        name: "search",
        args,
        ctx: createCliContext(boxRoot),
      });
      if (!result.success) {
        console.error(`Error: ${result.error}`);
        process.exit(1);
      }
    } catch (error) {
      console.error(`Error: ${errorMessage(error)}`);
      process.exit(1);
    }
  });
