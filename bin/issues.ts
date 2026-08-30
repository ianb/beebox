/**
 * `bin/issues` — a stateless CLI over the issue queue (`issues/`, plus
 * `private-issues/` when that mount exists).
 *
 * The queue is ~900 markdown files, which is past the size where grep answers
 * "what is already filed about this?" and well past the size where a human can
 * see its clusters. So: `list` and `groups` for the structural view, `search`
 * and `similar` for the semantic one, `show` so a hit can be read without
 * leaving the shell.
 *
 * Stateless means every run re-reads every issue file. The only thing carried
 * between runs is the embedding cache under `.issues-index/` (gitignored). The
 * index itself lives in `workstreams-app/src/server/issue-index.ts`, next to
 * `issue-domain.ts` — the dev issue browser's "Related" list is the same
 * ranking over the same cache, so there is one implementation and two callers.
 *
 * This file is the subcommand layer only. Its siblings hold the rest, split for
 * size: `issues-args.ts` (flags → filters), `issues-context.ts` (the index),
 * `issues-output.ts` (printing), `issues-errors.ts` (every refusal).
 */

import { parseArgs } from "node:util";

import {
  GROUP_KEYS, REPO_ROOT, filterIssues, groupIssues, loadIssueEntries,
  type GroupKey,
} from "../workstreams-app/src/server/issue-search-model.js";
import { DOCS_SUBDIR } from "../workstreams-app/src/server/issue-index-documents.js";
import { runSearch } from "../workstreams-app/src/server/issue-index-query.js";
import {
  SEARCH_MODES, buildFilters, oneOf, options, positiveInt, resultBudget,
  type ParsedValues,
} from "./issues-args.js";
import {
  acceptHit, openIndex, publicOnly, requireQueryVector, resolveEntry, whereClause,
} from "./issues-context.js";
import {
  MissingGroupKeyError, MissingSearchQueryError, MissingShowPathError,
  MissingSimilarPathError, NoStoredEmbeddingError, UnknownSubcommandError, UsageError,
} from "./issues-errors.js";
import { emitJson, issueLine, reportHits } from "./issues-output.js";

const USAGE = `bin/issues — survey and search the issue queue

  issues list [filters]                    matching issues, newest first
  issues groups --by <key> [filters]       clusters by a shared field
  issues search <text> [filters]           keyword / semantic search
  issues similar <issue-path> [filters]    issues (and docs) like this one
  issues show <issue-path>                 frontmatter + the top of the body

Status (every subcommand):  default open only, --closed only closed, --all both.
Filters: --category --area --label --workstream --discovered-in --needs
         --priority --next-action --since YYYY-MM-DD --research <awaiting|researched|none>
         --visibility <public|private>
  Repeats mean OR within a filter and AND across filters; --label repeats mean AND.
groups:  --by ${GROUP_KEYS.join("|")}  --min N (default 2)
search:  --mode text|hybrid|semantic — text is BM25 and offline; hybrid and semantic
         need a key AND a fully embedded corpus, and ERROR when either is missing.
         With no --mode, hybrid is tried and falls back to text with a stderr notice.
similar: --docs  also rank ${DOCS_SUBDIR}/**/*.md as prior art
Common:  --json  --limit N  --rebuild (discard .issues-index/ first)

Embeddings key, first match wins: BBX_OPENAI_API_KEY, THINKING_OPENAI_API_KEY,
SKE_OPENAI_API_KEY. Without one, only --mode text works (and it never uses the network).
--visibility public never reads private-issues at all, so nothing private is embedded.
`;

// ─── Subcommands ─────────────────────────────────────────────────────────────

async function commandList(values: ParsedValues): Promise<void> {
  const filters = buildFilters(values);
  const entries = filterIssues(await loadIssueEntries({ repoRoot: REPO_ROOT, ...publicOnly(filters) }), filters)
    .toSorted((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || a.path.localeCompare(b.path));
  const limit = positiveInt(values.limit, { fallback: 0, flag: "--limit" });
  const shown = limit > 0 ? entries.slice(0, limit) : entries;
  if (values.json === true) {
    emitJson(shown.map((entry) => ({ ...entry, body: undefined, absPath: undefined })));
    return;
  }
  for (const entry of shown) process.stdout.write(`${issueLine(entry)}\n`);
  const suffix = shown.length < entries.length ? ` (of ${String(entries.length)})` : "";
  process.stdout.write(`${String(shown.length)} issue(s)${suffix}\n`);
}

async function commandGroups(values: ParsedValues): Promise<void> {
  if (values.by === undefined) throw new MissingGroupKeyError(GROUP_KEYS.join("|"));
  const by: GroupKey = oneOf({ value: values.by, allowed: GROUP_KEYS, flag: "--by" });
  const min = positiveInt(values.min, { fallback: 2, flag: "--min" });
  const filters = buildFilters(values);
  const loaded = await loadIssueEntries({ repoRoot: REPO_ROOT, ...publicOnly(filters) });
  const groups = groupIssues(filterIssues(loaded, filters), { by, min });
  if (values.json === true) {
    emitJson({ by, min, groups });
    return;
  }
  for (const group of groups) {
    process.stdout.write(`${String(group.count).padStart(4)}  ${group.key}\n`);
    for (const memberPath of group.paths) process.stdout.write(`        ${memberPath}\n`);
  }
  process.stdout.write(`${String(groups.length)} group(s) with >= ${String(min)} member(s)\n`);
}

async function commandSearch(values: ParsedValues, positionals: string[]): Promise<void> {
  const term = positionals.join(" ").trim();
  if (term === "") throw new MissingSearchQueryError();
  const requestedMode = values.mode === undefined
    ? null
    : oneOf({ value: values.mode, allowed: SEARCH_MODES, flag: "--mode" });
  const includeDocs = values.docs === true;
  const filters = buildFilters(values);
  const context = await openIndex({ values, requestedMode, includeDocs, filters });
  const limit = positiveInt(values.limit, { fallback: 20, flag: "--limit" });
  const queryVector = context.mode === "text"
    ? undefined
    : (await requireQueryVector(term));
  const hits = (await runSearch({
    db: context.refreshed.db,
    mode: context.mode,
    term,
    vector: queryVector,
    where: whereClause(filters, includeDocs),
    limit: resultBudget(filters, limit),
    ...(context.mode === "semantic" ? { eligible: context.refreshed.embedded } : {}),
  })).filter((hit) => acceptHit({ hit, byPath: context.byPath, filters })).slice(0, limit);
  reportHits({ hits, values, mode: context.mode, byPath: context.byPath });
}

async function commandSimilar(values: ParsedValues, positionals: string[]): Promise<void> {
  const needle = positionals[0];
  if (needle === undefined) throw new MissingSimilarPathError();
  const includeDocs = values.docs === true;
  const filters = buildFilters(values);
  // `similar` is semantic by construction, so it takes the explicit path: no
  // key, or a half-embedded corpus, is an error rather than a BM25 answer.
  const context = await openIndex({
    values, requestedMode: "semantic", includeDocs, filters, textFallbackOffered: false,
  });
  const target = resolveEntry(context.entries, needle);
  const vector = context.refreshed.vectors.get(target.path);
  if (vector === undefined) throw new NoStoredEmbeddingError(target.path);
  const limit = positiveInt(values.limit, { fallback: 20, flag: "--limit" });
  const hits = (await runSearch({
    db: context.refreshed.db,
    mode: "semantic",
    vector,
    where: whereClause(filters, includeDocs),
    limit: resultBudget(filters, limit),
    exclude: new Set([target.path]),
    eligible: context.refreshed.embedded,
  })).filter((hit) => acceptHit({ hit, byPath: context.byPath, filters })).slice(0, limit);
  if (values.json !== true) process.stdout.write(`query: ${target.path} — ${target.title}\n`);
  reportHits({ hits, values, mode: "semantic", byPath: context.byPath });
}

const SHOW_BODY_LINES = 40;

async function commandShow(values: ParsedValues, positionals: string[]): Promise<void> {
  const needle = positionals[0];
  if (needle === undefined) throw new MissingShowPathError();
  const entry = resolveEntry(await loadIssueEntries({ repoRoot: REPO_ROOT }), needle);
  const lines = entry.body.split("\n");
  const head = lines.slice(0, SHOW_BODY_LINES);
  const frontmatter = { ...entry, body: undefined, absPath: undefined };
  if (values.json === true) {
    emitJson({ ...frontmatter, bodyHead: head.join("\n"), bodyTruncated: lines.length > head.length });
    return;
  }
  emitJson(frontmatter);
  process.stdout.write(`\n${head.join("\n")}\n`);
  if (lines.length > head.length) {
    process.stdout.write(`\n… ${String(lines.length - head.length)} more line(s) in ${entry.path}\n`);
  }
}

// ─── Entry point ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2), options, allowPositionals: true,
  });
  const [command, ...rest] = positionals;
  if (values.help === true || command === undefined || command === "help") {
    process.stdout.write(USAGE);
    return;
  }
  switch (command) {
    case "list": return commandList(values);
    case "groups": return commandGroups(values);
    case "search": return commandSearch(values, rest);
    case "similar": return commandSimilar(values, rest);
    case "show": return commandShow(values, rest);
    default: throw new UnknownSubcommandError(command);
  }
}

try {
  await main();
} catch (error) {
  if (error instanceof UsageError) {
    process.stderr.write(`issues: ${error.message}\n`);
    process.exitCode = 2;
  } else {
    throw error;
  }
}
