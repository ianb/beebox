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
 * index itself lives in `workstreams-app/src/server/main/issue-index.ts`, next to
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
  type GroupKey, type IssueEntry,
} from "../workstreams-app/src/server/main/issue-search-model.js";
import { DOCS_SUBDIR } from "../workstreams-app/src/server/main/issue-index-documents.js";
import { runSearch } from "../workstreams-app/src/server/main/issue-index-query.js";
import {
  SEARCH_MODES, buildFilters, oneOf, options, positiveInt, resultBudget,
  type ParsedValues,
} from "./issues-args.js";
import {
  acceptHit, openIndex, publicOnly, requireQueryVector, resolveEntry, whereClause,
} from "./issues-context.js";
import {
  ConflictingNextActionError, InvalidNextActionValueError, MissingGroupKeyError, MissingSearchQueryError,
  MissingShowPathError, MissingSimilarPathError, NoNextActionStoreError, NoStoredEmbeddingError,
  UnknownSubcommandError, UsageError,
} from "./issues-errors.js";
import { issueNextActionSchema, type IssueNextActionState } from "../workstreams-app/src/shared/documents.js";
import {
  nextActionKey, nextActionsRoot, readNextActions, writeNextAction, type NextActionRequest,
} from "../workstreams-app/src/server/main/issue-next-actions.js";
import { emitJson, issueLine, reportHits } from "./issues-output.js";
import { activateDueRepositories } from "./deferred-issues.js";

const USAGE = `bin/issues — survey and search the issue queue

  issues list [filters]                    matching issues, newest first
  issues groups --by <key> [filters]       clusters by a shared field
  issues search <text> [filters]           keyword / semantic search
  issues similar <issue-path> [filters]    issues (and docs) like this one
  issues show <issue-path>                 frontmatter + the top of the body
  issues activate-due [--apply]            preview, or move due deferred issues into their categories
  issues next-action                       every pending request from the developer
  issues next-action <issue>               one issue's request
  issues next-action <issue> <value> [--message <text>] | --message <text>
                                           set a request (replaces any existing one)
  issues next-action <issue> --clear       remove it after acting on it

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
next-action: requests live in a local store outside git (dev-issue-actions/
         beside the main checkout; BBX_ISSUE_ACTIONS_ROOT overrides). Values:
         ${issueNextActionSchema.options.join(" ")}
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

async function commandActivateDue(values: ParsedValues): Promise<void> {
  const visibilityFilter = values.visibility === undefined
    ? null
    : oneOf({ value: values.visibility, allowed: ["public", "private"] as const, flag: "--visibility" });
  const result = await activateDueRepositories({
    repoRoot: REPO_ROOT,
    dryRun: values.apply !== true,
    visibility: visibilityFilter,
  });
  if (values.json === true) {
    emitJson(result);
    return;
  }
  for (const [visibility, moves] of Object.entries(result)) {
    for (const move of moves) process.stdout.write(`${visibility}: ${move.source} -> ${move.destination}\n`);
  }
}

function describeNextAction(state: IssueNextActionState | null): string {
  if (state === null) return "no next action";
  return `${state.action ?? "message"}${state.message === undefined ? "" : ` — “${state.message}”`}`;
}

async function listNextActions(values: ParsedValues, entries: IssueEntry[]): Promise<void> {
  const stored = await readNextActions(await nextActionsRoot(REPO_ROOT));
  const wanted = values["next-action"] ?? [];
  const byKey = new Map(entries.map((entry) => [nextActionKey(entry.visibility, entry.slug), entry]));
  // A request whose issue is gone is still the developer's words: listed, never dropped.
  const rows = [...stored.entries()]
    .filter(([, state]) => wanted.length === 0 || (state.action !== undefined && wanted.includes(state.action)))
    .map(([key, state]) => ({ key, path: byKey.get(key)?.path ?? null, title: byKey.get(key)?.title ?? null, ...state }));
  if (values.json === true) {
    emitJson(rows);
    return;
  }
  for (const row of rows) {
    process.stdout.write(`${(row.action ?? "message").padEnd(19)} ${row.path ?? `(no such issue: ${row.key})`}  ${row.title ?? ""}\n`);
    if (row.message !== undefined) process.stdout.write(`${" ".repeat(20)}“${row.message}”\n`);
  }
  process.stdout.write(`${String(rows.length)} request(s)\n`);
}

/** The request a write asks for; null clears. */
function requestedNextAction(values: ParsedValues, value: string | undefined): NextActionRequest | null {
  if (values.clear === true) {
    if (value !== undefined || values.message !== undefined) throw new ConflictingNextActionError();
    return null;
  }
  const action = value === undefined ? null : issueNextActionSchema.safeParse(value);
  if (action !== null && !action.success) throw new InvalidNextActionValueError(issueNextActionSchema.options);
  return { action: action?.data ?? null, message: values.message ?? null };
}

async function commandNextAction(values: ParsedValues, positionals: string[]): Promise<void> {
  const [needle, value] = positionals;
  const entries = await loadIssueEntries({ repoRoot: REPO_ROOT });
  if (needle === undefined) {
    await listNextActions(values, entries);
    return;
  }
  const entry = resolveEntry(entries, needle);
  const key = nextActionKey(entry.visibility, entry.slug);
  const root = await nextActionsRoot(REPO_ROOT);
  let state: IssueNextActionState | null;
  if (values.clear === true || value !== undefined || values.message !== undefined) {
    const request = requestedNextAction(values, value);
    if (root === null) throw new NoNextActionStoreError();
    state = await writeNextAction({ root, key, request });
  } else {
    state = (await readNextActions(root)).get(key) ?? null;
  }
  if (values.json === true) emitJson({ key, path: entry.path, nextAction: state });
  else process.stdout.write(`${entry.path}: ${describeNextAction(state)}\n`);
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
    case "activate-due": return commandActivateDue(values);
    case "next-action": return commandNextAction(values, rest);
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
