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
 * between runs is the embedding cache under `.issues-index/` (gitignored) —
 * see `bin/lib/issues-index.ts`.
 */

import { parseArgs } from "node:util";

import {
  GROUP_KEYS, REPO_ROOT, emptyFilters, filterIssues, groupIssues, loadIssueEntries,
  matchesFilters, normalizeWorkstreamName,
  type GroupKey, type IssueEntry, type IssueFilters,
} from "./lib/issues-model.js";
import {
  DOCS_SUBDIR, EMBEDDING_KEY_VARS, issueDocument, loadDocDocuments, manifestPaths, refreshIndex,
  resolveEmbeddingsService, runSearch,
  type IndexDocument, type IndexHit, type IndexScope, type SearchMode,
} from "./lib/issues-index.js";

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

Embeddings key, first match wins: CALLBACK_OPENAI_API_KEY, THINKING_OPENAI_API_KEY,
SKE_OPENAI_API_KEY. Without one, only --mode text works (and it never uses the network).
--visibility public never reads private-issues at all, so nothing private is embedded.
`;

const RESEARCH_STATES = ["awaiting", "researched", "none"] as const;
const SEARCH_MODES = ["text", "hybrid", "semantic"] as const;

class UsageError extends Error {}

function oneOf<T extends string>(value: string, allowed: readonly T[], flag: string): T {
  const match = allowed.find((candidate) => candidate === value);
  if (match === undefined) throw new UsageError(`${flag} must be one of: ${allowed.join(", ")}`);
  return match;
}

// ─── Argument parsing ────────────────────────────────────────────────────────

const options = {
  json: { type: "boolean" },
  all: { type: "boolean" },
  closed: { type: "boolean" },
  rebuild: { type: "boolean" },
  docs: { type: "boolean" },
  help: { type: "boolean", short: "h" },
  by: { type: "string" },
  min: { type: "string" },
  limit: { type: "string" },
  mode: { type: "string" },
  since: { type: "string" },
  research: { type: "string" },
  visibility: { type: "string" },
  category: { type: "string", multiple: true },
  area: { type: "string", multiple: true },
  label: { type: "string", multiple: true },
  workstream: { type: "string", multiple: true },
  "discovered-in": { type: "string", multiple: true },
  needs: { type: "string", multiple: true },
  priority: { type: "string", multiple: true },
  "next-action": { type: "string", multiple: true },
} as const;

/** The shape `options` above produces — spelled out so the rest of the file is plainly typed. */
interface ParsedValues {
  json?: boolean | undefined;
  all?: boolean | undefined;
  closed?: boolean | undefined;
  rebuild?: boolean | undefined;
  docs?: boolean | undefined;
  help?: boolean | undefined;
  by?: string | undefined;
  min?: string | undefined;
  limit?: string | undefined;
  mode?: string | undefined;
  since?: string | undefined;
  research?: string | undefined;
  visibility?: string | undefined;
  category?: string[] | undefined;
  area?: string[] | undefined;
  label?: string[] | undefined;
  workstream?: string[] | undefined;
  "discovered-in"?: string[] | undefined;
  needs?: string[] | undefined;
  priority?: string[] | undefined;
  "next-action"?: string[] | undefined;
}

function buildFilters(values: ParsedValues): IssueFilters {
  const filters = emptyFilters();
  if (values.all === true) filters.status = "all";
  else if (values.closed === true) filters.status = "closed";
  filters.category = values.category ?? [];
  filters.area = values.area ?? [];
  filters.labels = values.label ?? [];
  filters.needs = values.needs ?? [];
  filters.priority = values.priority ?? [];
  filters.nextAction = values["next-action"] ?? [];
  filters.workstream = (values.workstream ?? []).map(normalizeWorkstreamName);
  filters.discoveredIn = (values["discovered-in"] ?? []).map(normalizeWorkstreamName);
  if (values.since !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(values.since)) throw new UsageError("--since must be YYYY-MM-DD");
    filters.since = values.since;
  }
  if (values.research !== undefined) filters.research = oneOf(values.research, RESEARCH_STATES, "--research");
  if (values.visibility !== undefined) {
    filters.visibility = oneOf(values.visibility, ["public", "private"] as const, "--visibility");
  }
  return filters;
}

/** True when a filter narrows by something a design doc cannot have. */
function narrowsToIssues(filters: IssueFilters): boolean {
  return filters.category.length > 0 || filters.area.length > 0 || filters.labels.length > 0
    || filters.needs.length > 0 || filters.priority.length > 0 || filters.nextAction.length > 0
    || filters.workstream.length > 0 || filters.discoveredIn.length > 0
    || filters.since !== null || filters.research !== null || filters.visibility !== null;
}

/**
 * How many ranked hits to ask the index for, given that some filters are applied
 * afterwards in JS. A page-sized request would be consumed entirely by hits the
 * post-filter then drops (a narrow `--since` over a common term returned nothing
 * at all before this), so a narrowing filter asks for the whole corpus and lets
 * the post-filter choose the page out of it.
 */
const WIDE_BUDGET = 1000;

function resultBudget(filters: IssueFilters, limit: number): number {
  return narrowsToIssues(filters) ? WIDE_BUDGET : limit;
}

function positiveInt(raw: string | undefined, fallback: number, flag: string): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new UsageError(`${flag} must be a non-negative integer`);
  return value;
}

// ─── Human output ────────────────────────────────────────────────────────────

function truncate(text: string, width: number): string {
  return text.length <= width ? text : `${text.slice(0, width - 1)}…`;
}

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}

function issueLine(entry: IssueEntry): string {
  const marks = [
    entry.priority === "important" ? "!" : "",
    entry.visibility === "private" ? "P" : "",
    entry.nextAction === null ? "" : "?",
  ].join("");
  return [
    pad(entry.date ?? "----------", 10),
    pad(entry.category, 15),
    pad(marks, 3),
    pad(truncate(entry.title, 58), 58),
    entry.path,
  ].join(" ");
}

function hitLine(hit: IndexHit): string {
  return `${hit.score.toFixed(3).padStart(7)}  ${pad(hit.path, 58)} ${hit.title}`;
}

function emitJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

// ─── Index plumbing ──────────────────────────────────────────────────────────

/**
 * `--visibility public` selects the public-only cache, so the private queue is
 * never read, indexed, or embedded for that run. Every other run uses the full
 * one; `--visibility private` still narrows by filter, since the private issues
 * have to be loaded to be returned at all.
 */
function scopeFor(filters: IssueFilters): IndexScope {
  return filters.visibility === "public" ? "public" : "all";
}

function publicOnly(filters: IssueFilters): { publicOnly: boolean } {
  return { publicOnly: filters.visibility === "public" };
}

async function buildDocuments(input: {
  entries: IssueEntry[];
  includeDocs: boolean;
  scope: IndexScope;
}): Promise<IndexDocument[]> {
  const documents = input.entries.map((entry) => issueDocument(entry));
  // Once `--docs` has pulled the design docs in, keep refreshing them: dropping
  // the corpus would discard vectors already paid for.
  const indexed = await manifestPaths(REPO_ROOT, input.scope);
  const alreadyIndexed = indexed.some((entryPath) => entryPath.startsWith(`${DOCS_SUBDIR}/`));
  if (input.includeDocs || alreadyIndexed) documents.push(...(await loadDocDocuments(REPO_ROOT)));
  return documents;
}

/** Orama `where:` for the enum/enum[] fields; the rest is post-filtered exactly. */
function whereClause(filters: IssueFilters, includeDocs: boolean): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  const enumIn = (field: string, values: string[]): void => {
    if (values.length > 0) where[field] = { in: values };
  };
  if (filters.status !== "all") where["status"] = { eq: filters.status };
  enumIn("category", filters.category);
  enumIn("area", filters.area);
  enumIn("workstream", filters.workstream);
  enumIn("discoveredInWorkstream", filters.discoveredIn);
  enumIn("priority", filters.priority);
  enumIn("nextAction", filters.nextAction);
  if (filters.research !== null) where["research"] = { eq: filters.research };
  if (filters.visibility !== null) where["visibility"] = { eq: filters.visibility };
  if (filters.labels.length > 0) where["labels"] = { containsAll: filters.labels };
  // enum[] has no "contains any", so only a single --needs maps to a clause;
  // several are left to the post-filter (and the wider fetch budget).
  if (filters.needs.length === 1) where["needs"] = { containsAll: filters.needs };
  if (!includeDocs) where["kind"] = { eq: "issue" };
  // A doc has none of the issue facets, so any narrowing filter would exclude
  // it anyway — but `status` alone must not, since docs index as "open".
  if (includeDocs && narrowsToIssues(filters)) where["kind"] = { eq: "issue" };
  return where;
}

/**
 * Recheck each hit against the exact JS predicate. Orama's `where:` covers the
 * enum fields; `--needs` with several values (OR over an enum[]) and `--since`
 * (a range over a string field) have no `where:` equivalent, and a hit that only
 * survived because of that gap must not reach the output.
 */
function acceptHit(input: { hit: IndexHit; byPath: Map<string, IssueEntry>; filters: IssueFilters }): boolean {
  const { hit, byPath, filters } = input;
  const entry = byPath.get(hit.path);
  if (entry === undefined) return hit.kind === "doc" && !narrowsToIssues(filters);
  return matchesFilters(entry, filters);
}

interface IndexContext {
  entries: IssueEntry[];
  byPath: Map<string, IssueEntry>;
  refreshed: Awaited<ReturnType<typeof refreshIndex>>;
  mode: SearchMode;
}

async function openIndex(input: {
  values: ParsedValues;
  requestedMode: SearchMode | null;
  includeDocs: boolean;
  filters: IssueFilters;
  /** False for `similar`, whose ranking cannot fall back to BM25. */
  textFallbackOffered?: boolean;
}): Promise<IndexContext> {
  const { values, requestedMode, includeDocs, filters } = input;
  const scope = scopeFor(filters);
  const entries = await loadIssueEntries(REPO_ROOT, { publicOnly: scope === "public" });
  const documents = await buildDocuments({ entries, includeDocs, scope });

  // Mode resolution, in one place. An EXPLICIT --mode hybrid|semantic is a
  // statement that BM25 will not do, so it fails loudly rather than quietly
  // answering a different question; only the unspecified default degrades, and
  // it says so on stderr. --mode text never resolves a key and never embeds.
  const service = requestedMode === "text" ? null : resolveEmbeddingsService();
  // `similar` asks for semantic ranking itself, so "use --mode text instead" is
  // advice only the person who typed --mode can take.
  const textIsAnOption = input.textFallbackOffered !== false;
  if (requestedMode !== null && requestedMode !== "text" && service === null) {
    throw new UsageError(
      `${requestedMode} ranking needs an embeddings key (set one of ${EMBEDDING_KEY_VARS.join(", ")})`
      + (textIsAnOption ? "; --mode text ranks with BM25 and never uses the network" : ""),
    );
  }
  let mode: SearchMode = service === null ? "text" : (requestedMode ?? "hybrid");
  if (service === null && requestedMode === null) {
    process.stderr.write(
      `issues: no embeddings key set (${EMBEDDING_KEY_VARS.join(", ")}); falling back to --mode text\n`,
    );
  }

  const refreshed = await refreshIndex({
    repoRoot: REPO_ROOT,
    documents,
    scope,
    embeddings: service,
    ...(values.rebuild === true ? { rebuild: true } : {}),
  });
  for (const warning of refreshed.warnings) process.stderr.write(`issues: ${warning}\n`);
  if (refreshed.embeddedThisRun > 0) {
    process.stderr.write(`issues: embedded ${String(refreshed.embeddedThisRun)} changed document(s)\n`);
  }

  // Vector ranking over a half-embedded corpus ranks against placeholder
  // vectors (hybrid) or silently omits documents (semantic) — either way the
  // result is not the search that was asked for.
  const missing = documents.length - refreshed.embedded.size;
  if (mode !== "text" && missing > 0) {
    const detail = `${String(missing)} of ${String(documents.length)} document(s) are not embedded`;
    if (requestedMode !== null) {
      throw new UsageError(`${requestedMode} ranking needs the whole corpus embedded — ${detail}. `
        + "Re-run to finish embedding (stderr above says why it stopped)"
        + (textIsAnOption ? ", or use --mode text" : ""));
    }
    process.stderr.write(`issues: ${detail}; falling back to --mode text\n`);
    mode = "text";
  }

  return { entries, byPath: new Map(entries.map((entry) => [entry.path, entry])), refreshed, mode };
}

function resolveEntry(entries: IssueEntry[], needle: string): IssueEntry {
  const exact = entries.find((entry) => entry.path === needle);
  if (exact) return exact;
  const stripped = needle.replace(/^\.?\/*/u, "");
  for (const candidates of [
    entries.filter((entry) => entry.path === stripped || entry.relPath === stripped),
    entries.filter((entry) => entry.path.endsWith(`/${stripped}`)),
    entries.filter((entry) => entry.slug === stripped || entry.slug === stripped.replace(/\.md$/u, "")),
  ]) {
    const only = candidates[0];
    if (candidates.length === 1 && only !== undefined) return only;
    if (candidates.length > 1) {
      throw new UsageError(`"${needle}" matches ${String(candidates.length)} issues; be more specific`);
    }
  }
  throw new UsageError(`no issue matches "${needle}"`);
}

// ─── Subcommands ─────────────────────────────────────────────────────────────

async function commandList(values: ParsedValues): Promise<void> {
  const filters = buildFilters(values);
  const entries = filterIssues(await loadIssueEntries(REPO_ROOT, publicOnly(filters)), filters)
    .toSorted((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || a.path.localeCompare(b.path));
  const limit = positiveInt(values.limit, 0, "--limit");
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
  if (values.by === undefined) throw new UsageError(`groups needs --by ${GROUP_KEYS.join("|")}`);
  const by: GroupKey = oneOf(values.by, GROUP_KEYS, "--by");
  const min = positiveInt(values.min, 2, "--min");
  const filters = buildFilters(values);
  const loaded = await loadIssueEntries(REPO_ROOT, publicOnly(filters));
  const groups = groupIssues(filterIssues(loaded, filters), by, min);
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
  if (term === "") throw new UsageError("search needs a query");
  const requestedMode = values.mode === undefined ? null : oneOf(values.mode, SEARCH_MODES, "--mode");
  const includeDocs = values.docs === true;
  const filters = buildFilters(values);
  const context = await openIndex({ values, requestedMode, includeDocs, filters });
  const limit = positiveInt(values.limit, 20, "--limit");
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

async function requireQueryVector(text: string): Promise<number[]> {
  const service = resolveEmbeddingsService();
  if (service === null) throw new UsageError("no embeddings key in the environment (see --help)");
  const [vector] = await service.embed([text]);
  if (vector === undefined) throw new UsageError("the embeddings service returned no vector for the query");
  return vector;
}

async function commandSimilar(values: ParsedValues, positionals: string[]): Promise<void> {
  const needle = positionals[0];
  if (needle === undefined) throw new UsageError("similar needs an issue path");
  const includeDocs = values.docs === true;
  const filters = buildFilters(values);
  // `similar` is semantic by construction, so it takes the explicit path: no
  // key, or a half-embedded corpus, is an error rather than a BM25 answer.
  const context = await openIndex({
    values, requestedMode: "semantic", includeDocs, filters, textFallbackOffered: false,
  });
  const target = resolveEntry(context.entries, needle);
  const vector = context.refreshed.vectors.get(target.path);
  if (vector === undefined) throw new UsageError(`${target.path} has no stored embedding`);
  const limit = positiveInt(values.limit, 20, "--limit");
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

function reportHits(input: {
  hits: IndexHit[];
  values: ParsedValues;
  mode: SearchMode;
  byPath: Map<string, IssueEntry>;
}): void {
  const { hits, values, mode, byPath } = input;
  if (values.json === true) {
    emitJson({
      mode,
      hits: hits.map((hit) => ({ ...hit, category: byPath.get(hit.path)?.category ?? null })),
    });
    return;
  }
  for (const hit of hits) process.stdout.write(`${hitLine(hit)}\n`);
  process.stdout.write(`${String(hits.length)} hit(s) [${mode}]\n`);
}

const SHOW_BODY_LINES = 40;

async function commandShow(values: ParsedValues, positionals: string[]): Promise<void> {
  const needle = positionals[0];
  if (needle === undefined) throw new UsageError("show needs an issue path");
  const entry = resolveEntry(await loadIssueEntries(REPO_ROOT), needle);
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
    default: throw new UsageError(`unknown subcommand "${command}"`);
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
