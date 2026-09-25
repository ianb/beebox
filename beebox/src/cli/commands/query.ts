/**
 * `bbx query <collection>` — the agent's read surface over a collection
 * (`docs/plans/todo-collection.md`, Track 4).
 *
 * The web list and this command answer the same question through the same
 * runner, so what an agent is told matches what the boxholder sees. What
 * differs is only the rendering: here a row is a header line plus indented
 * item lines, with the section path called out when it changes and an
 * annotation on its own line, because that is what makes an undated todo
 * legible in a terminal.
 *
 * Read-only. Changing a todo is editing the card it was written in.
 */

import { Command } from "commander";
import { requireBoxRoot } from "../../lib/paths.js";
import { TodoParamsSchema } from "../../core/todo/collection.js";
import { runTodoQuery, type TodoQueryResult } from "../../core/todo/query.js";
import { errorMessage } from "../../lib/error-guards.js";
import { formatTodoRows, formatIssues } from "./query-format.js";

/** Every collection `bbx query` knows. One today; the error message lists whatever is here. */
const COLLECTIONS: readonly string[] = ["todos"];

interface QueryCliOptions {
  here?: string;
  glob?: string;
  group?: string;
  referring?: boolean;
  json?: boolean;
  status?: string[];
  assigned?: string;
  onPlate?: boolean;
}

export const queryCommand = new Command("query")
  .argument("<collection>", `Collection to query (${COLLECTIONS.join(", ")})`)
  .description("Query a collection over the box's cards, scoped to a place")
  .option("--here <path>", "The place to ask about: a directory, a card, or omitted for the whole box")
  .option("--glob <pattern>", "Override the scope glob that --here implies")
  .option("--group <name>", "Grouping: place (default) or plate")
  .option("--no-referring", "Skip items written elsewhere that link into --here")
  .option("--json", "The full CollectionResult as JSON")
  .option("--status <status...>", "Todo status filter: open, done, dropped, parked (default: open, parked)")
  .option("--assigned <name>", "Filter by the `assigned` attribute (exact match)")
  .option("--on-plate", "Only escalated / on-plate todos (excludes quiet)")
  .action(async (collection: string, options: QueryCliOptions) => {
    try {
      const boxRoot = await requireBoxRoot();
      await runQueryForBox(boxRoot, { collection, options });
    } catch (error) {
      console.error(`Error: ${errorMessage(error)}`);
      process.exit(1);
    }
  });

/**
 * The command's logic, taking `boxRoot` directly rather than resolving it from
 * `process.cwd()` — the seam the doctest drives, same approach as
 * `runTodosForBox`.
 */
export async function runQueryForBox(
  boxRoot: string,
  input: { collection: string; options: QueryCliOptions },
): Promise<void> {
  const { collection, options } = input;
  if (!isKnownCollection(collection)) {
    console.error(`Error: unknown collection "${collection}" — valid names: ${COLLECTIONS.join(", ")}`);
    process.exit(1);
  }

  const params = TodoParamsSchema.safeParse({
    // The agent's own surface: it must see every todo it always has,
    // agent-assigned included, regardless of the boxholder-scope default
    // (Track 1).
    scope: "all",
    ...(options.status !== undefined && { status: options.status }),
    ...(options.assigned !== undefined && { assigned: options.assigned }),
    ...(options.onPlate === true && { onPlate: true }),
  });
  if (!params.success) {
    console.error(`Error: ${params.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
    console.error("--status must be one or more of: open, done, dropped, parked");
    process.exit(1);
  }

  const result = await runTodoQuery(boxRoot, {
    query: {
      here: options.here ?? "",
      ...(options.glob !== undefined && { glob: options.glob }),
      ...(options.group !== undefined && { group: options.group }),
      // Commander turns `--no-referring` into `referring: false`; absent means
      // the runner's own default, which is on unless `here` is the box.
      ...(options.referring === false && { includeReferring: false }),
      params: params.data,
    },
    since: null,
  });

  if (options.json === true) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  printResult(result);
}

function isKnownCollection(name: string): boolean {
  return COLLECTIONS.includes(name);
}

function printResult(result: TodoQueryResult): void {
  const lines: string[] = [];
  for (const group of result.groups) {
    // `place` is one group whose label would only repeat the command; `plate`
    // names a real distinction, so only it gets a heading.
    if (result.query.group !== "place") {
      const total = group.reduction.open + group.reduction.parked + group.reduction.done + group.reduction.dropped;
      lines.push(`${group.label} (${String(total)})`);
    }
    lines.push(...formatTodoRows(group.rows));
  }
  if (lines.length === 0) {
    console.log("No todos match.");
  } else {
    for (const line of lines) console.log(line);
  }
  for (const line of formatIssues(result.issues)) console.log(line);
}
