/**
 * search command — full-text search over the box's cards.
 *
 * Human output: `path — title` plus an excerpt per hit. Structured data
 * (for --json and API consumers) is the full envelope from searchBox.
 */

import {
  registerCommand,
  type CommandContext,
  type CommandResult,
} from "../command-runner.js";
import { searchBox, UnknownKindError, type SearchBoxOptions } from "../search/query.js";

async function executeSearch(
  ctx: CommandContext,
  args: Record<string, unknown>
): Promise<CommandResult> {
  const query = typeof args["query"] === "string" ? args["query"] : "";
  if (query.trim() === "") {
    return { success: false, error: 'a search query is required — e.g. cb search "dentist appointment"' };
  }

  const options: SearchBoxOptions = {
    query,
    onProgress: (message) => ctx.writeLine(message),
  };
  if (Array.isArray(args["kinds"])) {
    options.kinds = args["kinds"].filter((k): k is string => typeof k === "string");
  }
  if (typeof args["path"] === "string" && args["path"] !== "") {
    options.pathPrefix = args["path"];
  }
  if (typeof args["limit"] === "number") options.limit = args["limit"];
  if (args["rebuild"] === true) options.rebuild = true;

  let result;
  try {
    result = await searchBox(ctx.boxRoot, options);
  } catch (e) {
    if (e instanceof UnknownKindError) {
      return {
        success: false,
        error: `${e.message}\n  e.g. cb search "${query}" --kind ${e.validKinds[0] ?? "memo"}`,
      };
    }
    throw e;
  }

  for (const warning of result.warnings) {
    ctx.writeLine(`warning: ${warning}`);
  }
  if (result.results.length === 0) {
    ctx.writeLine(`No results for "${query}".`);
  }
  for (const hit of result.results) {
    const where = hit.fragment === "" ? hit.path : `${hit.path}#${hit.fragment}`;
    ctx.writeLine(`${where} — ${hit.title}`);
    if (hit.contains !== "") ctx.writeLine(`    contains: ${hit.contains}`);
    if (hit.excerpt !== "") ctx.writeLine(`    ${hit.excerpt}`);
  }
  if (result.truncated) {
    ctx.writeLine(`(${String(result.results.length)} of ${String(result.total)} — ${result.hint ?? ""})`);
  }

  return { success: true, data: result };
}

registerCommand({
  name: "search",
  description: "Full-text search over the box's cards",
  args: [
    { name: "query", description: "Search terms", required: true, type: "string" },
    { name: "kinds", description: "Restrict to card types", required: false, type: "string[]" },
    { name: "path", description: "Restrict to a box-relative path prefix", required: false, type: "string" },
    { name: "limit", description: "Maximum results (default 10)", required: false, type: "number" },
    { name: "rebuild", description: "Rebuild the index from scratch", required: false, type: "boolean" },
  ],
  execute: executeSearch,
});

export { executeSearch };
