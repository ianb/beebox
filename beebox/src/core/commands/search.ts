/**
 * search command — full-text search over the box's cards.
 *
 * Human output: `path — title` plus an excerpt per hit. Structured data
 * (for --json and API consumers) is the full envelope from searchBox.
 */

import { z } from "zod";
import {
  registerCommand,
  parseCommandArgs,
  type CommandContext,
  type CommandResult,
} from "../command-runner.js";
import {
  searchBox,
  UnknownKindError,
  HybridUnavailableError,
  type SearchBoxOptions,
} from "../search/query.js";
import { EmbeddingsKeyError } from "../search/embeddings-key.js";

/**
 * Arguments for the search command. `query` is optional here because the
 * command owns its presence check (friendlier error than a schema failure);
 * everything else is a type boundary — wrong-typed values fail loudly as
 * CommandArgsError instead of being silently dropped.
 */
const SearchArgsSchema = z.object({
  /** The search query */
  query: z.string().optional(),
  /** Restrict to these card types */
  kinds: z.array(z.string()).optional(),
  /** Restrict to paths starting with this box-relative prefix */
  path: z.string().optional(),
  /** Maximum results to return */
  limit: z.number().optional(),
  /** Discard and rebuild the index before searching */
  rebuild: z.boolean().optional(),
  /** Force text ranking, or force hybrid (fails loudly when unavailable) */
  mode: z.enum(["text", "hybrid"]).optional(),
});

async function executeSearch(
  ctx: CommandContext,
  args: Record<string, unknown>
): Promise<CommandResult> {
  const parsed = parseCommandArgs(args, SearchArgsSchema);
  const query = parsed.query ?? "";
  if (query.trim() === "") {
    return { success: false, error: 'a search query is required — e.g. bbx search "dentist appointment"' };
  }

  const options: SearchBoxOptions = {
    query,
    onProgress: (message) => ctx.writeLine(message),
  };
  if (parsed.kinds !== undefined) options.kinds = parsed.kinds;
  if (parsed.path !== undefined && parsed.path !== "") options.pathPrefix = parsed.path;
  if (parsed.limit !== undefined) options.limit = parsed.limit;
  if (parsed.rebuild === true) options.rebuild = true;
  if (parsed.mode !== undefined) options.mode = parsed.mode;

  let result;
  try {
    result = await searchBox(ctx.boxRoot, options);
  } catch (e) {
    if (e instanceof UnknownKindError) {
      return {
        success: false,
        error: `${e.message}\n  e.g. bbx search "${query}" --kind ${e.validKinds[0] ?? "memo"}`,
      };
    }
    // Config/mode errors surface as clean CLI errors, not stack traces.
    if (e instanceof HybridUnavailableError || e instanceof EmbeddingsKeyError) {
      return { success: false, error: e.message };
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
    { name: "mode", description: "Ranking mode: hybrid or text (default auto)", required: false, type: "string" },
  ],
  execute: executeSearch,
});

