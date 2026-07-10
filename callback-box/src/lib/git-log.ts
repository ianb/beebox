/**
 * Paginated / filtered git-log history and trailer-facet aggregation.
 *
 * This is the data layer behind the History browse UI: it reads `git log`
 * with custom record-separated formats, recovers per-commit file stats in a
 * second pass, parses multi-value trailers, and collects distinct trailer
 * values for the filter bar. Depends only on leaf modules (git-internal,
 * git-trailers) and simple-git — no value cycle back to git.ts.
 */

import { simpleGit } from "simple-git";

import type { GitLogFormat } from "./git-internal.js";
import { LOG_FORMAT } from "./git-internal.js";
import { CONNECTOR_TRAILER_KEYS, parseTrailersMulti } from "./git-trailers.js";
import { invariant } from "./invariant.js";

/**
 * Extended log entry with multi-value trailer support.
 */
export interface FileStat {
  added: number;
  modified: number;
  deleted: number;
  renamed: number;
  insertions: number;
  deletions: number;
}

export interface GitLogEntryExtended {
  hash: string;
  date: string;
  subject: string;
  body?: string | undefined;
  trailers?: Record<string, string | string[]> | undefined;
  fileStat?: FileStat | undefined;
}

/**
 * Parameters for getLogPaginated
 */
export interface GetLogPaginatedParams {
  boxRoot: string;
  count?: number | undefined;
  offset?: number | undefined;
  filter?: LogFilter | undefined;
}

/**
 * Filter criteria applied server-side via `git log --grep --all-match`.
 * Each grep regex must match (AND across axes); alternation within a single
 * grep expresses OR within an axis.
 */
export interface LogFilter {
  greps?: string[];
}

/**
 * Aggregated distinct trailer values used by the history browse UI.
 */
export interface TrailerFacets {
  connectors: string[];
  workflows: string[];
}

/** Build a zeroed file-stat accumulator. */
function emptyFileStat(): FileStat {
  return { added: 0, modified: 0, deleted: 0, renamed: 0, insertions: 0, deletions: 0 };
}

/** Tally a `--name-status` status character into a file stat. */
function applyNameStatus(stat: FileStat, status: string | undefined): void {
  if (status === "A") stat.added++;
  else if (status === "M") stat.modified++;
  else if (status === "D") stat.deleted++;
  else if (status === "R") stat.renamed++;
}

/** Accumulate `--numstat` insertion/deletion columns into a file stat. */
function applyNumstat(stat: FileStat, lines: string[]): void {
  for (const line of lines) {
    const [insCol, delCol] = line.split("\t");
    if (insCol !== undefined && delCol !== undefined && insCol !== "-") {
      stat.insertions += parseInt(insCol, 10) || 0;
      stat.deletions += parseInt(delCol, 10) || 0;
    }
  }
}

/**
 * Parse git log output grouped by commit hash.
 * Expects format: hash line, then data lines, then next hash, etc.
 */
function parseHashGrouped(raw: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  let currentHash: string | null = null;
  let lines: string[] = [];
  for (const line of raw.split("\n")) {
    if (/^[\da-f]{40}$/.test(line)) {
      if (currentHash) map.set(currentHash, lines);
      currentHash = line;
      lines = [];
    } else if (currentHash && line.length > 0) {
      lines.push(line);
    }
  }
  if (currentHash) map.set(currentHash, lines);
  return map;
}

/**
 * Compute per-commit file stats for an unfiltered page via `--name-status`
 * (A/M/D/R) and `--numstat` (line counts). Returns an empty map (and logs)
 * if the stat passes fail — stats are decorative.
 */
async function fetchPageStats(
  git: ReturnType<typeof simpleGit>,
  page: { count: number; offset: number }
): Promise<Map<string, FileStat>> {
  const { count, offset } = page;
  const statMap = new Map<string, FileStat>();
  try {
    const skipArgs = offset > 0 ? ["--skip", String(offset)] : [];
    const baseArgs = ["log", `--max-count=${count}`, ...skipArgs, "--format=%H"];

    const statusByHash = parseHashGrouped(await git.raw([...baseArgs, "--name-status"]));
    const numstatByHash = parseHashGrouped(await git.raw([...baseArgs, "--numstat"]));

    for (const [hash, lines] of statusByHash) {
      const stat = emptyFileStat();
      for (const line of lines) applyNameStatus(stat, line[0]);
      applyNumstat(stat, numstatByHash.get(hash) || []);
      statMap.set(hash, stat);
    }
  } catch (e) {
    // File stats are decorative — log-history still renders without them.
    console.warn("Failed to compute commit file stats; continuing without them:", e);
  }
  return statMap;
}

/**
 * Get paginated commits from the log with multi-value trailer support.
 *
 * @param params - Parameters object
 * @returns Array of log entries
 */
export async function getLogPaginated(
  params: GetLogPaginatedParams
): Promise<GitLogEntryExtended[]> {
  const { boxRoot, count = 50, offset = 0, filter } = params;

  if (filter && filter.greps && filter.greps.length > 0) {
    return getLogFiltered({ boxRoot, count, offset, greps: filter.greps });
  }

  try {
    const logOptions: Record<string, unknown> = {
      maxCount: count,
      format: LOG_FORMAT,
    };
    if (offset > 0) {
      logOptions["--skip"] = offset;
    }

    const git = simpleGit(boxRoot);
    const result = await git.log<GitLogFormat>(logOptions);
    const statMap = await fetchPageStats(git, { count, offset });

    return result.all.map((entry) => {
      const body = entry.body.trim() || undefined;
      const trailers = parseTrailersMulti(body);

      return {
        hash: entry.hash,
        date: entry.date,
        subject: entry.subject,
        body,
        trailers: Object.keys(trailers).length > 0 ? trailers : undefined,
        fileStat: statMap.get(entry.hash),
      };
    });
  } catch (_e) {
    // log() throws on a repo with no commits yet — an empty page is the
    // expected, non-error result here.
    return [];
  }
}

/**
 * Scan every commit's trailer block and collect distinct values for the
 * axes that populate the History filter bar. The output is sorted for
 * stable UI ordering.
 */
export async function getTrailerFacets(boxRoot: string): Promise<TrailerFacets> {
  const connectorKeys = new Set<string>(CONNECTOR_TRAILER_KEYS);
  const connectors = new Set<string>();
  const workflows = new Set<string>();

  try {
    const raw = await simpleGit(boxRoot).raw([
      "log",
      "--format=%(trailers:only,unfold)%x00",
    ]);

    for (const commitBlock of raw.split("\u0000")) {
      for (const line of commitBlock.split("\n")) {
        const match = line.match(/^([A-Za-z-]+):\s*(.+)$/);
        if (!match) continue;
        const [, key, rawValue] = match;
        invariant(key !== undefined && rawValue !== undefined, "regex capture groups missing on a successful match");
        const value = rawValue.trim();
        if (!value) continue;
        if (connectorKeys.has(key)) {
          connectors.add(value);
        } else if (key === "Workflow") {
          workflows.add(value);
        }
      }
    }
  } catch (e) {
    // A repo with no commits yields empty facets legitimately; any other
    // git failure is worth surfacing rather than silently showing no filters.
    console.warn("Failed to scan trailer facets; returning empty facets:", e);
  }

  return {
    connectors: [...connectors].toSorted(),
    workflows: [...workflows].toSorted(),
  };
}

/**
 * Filtered git log using `--grep --all-match --extended-regexp`. Parses a
 * custom record-separated format to recover hash/date/subject/body plus
 * file stats in two passes.
 */
interface GetLogFilteredParams {
  boxRoot: string;
  count: number;
  offset: number;
  greps: string[];
}

/** Attach per-commit file stats (filtered page) to the given entries. */
async function attachFilteredStats(
  git: ReturnType<typeof simpleGit>,
  { logArgs, entries }: { logArgs: string[]; entries: GitLogEntryExtended[] }
): Promise<void> {
  try {
    const statusByHash = parseHashGrouped(
      await git.raw(["log", ...logArgs, "--format=%H", "--name-status"])
    );
    const numstatByHash = parseHashGrouped(
      await git.raw(["log", ...logArgs, "--format=%H", "--numstat"])
    );
    for (const entry of entries) {
      const stat = emptyFileStat();
      for (const line of statusByHash.get(entry.hash) || []) applyNameStatus(stat, line[0]);
      applyNumstat(stat, numstatByHash.get(entry.hash) || []);
      entry.fileStat = stat;
    }
  } catch (e) {
    // File stats are decorative — the filtered history still renders the
    // entries without per-commit stat counts.
    console.warn("Failed to compute filtered commit file stats; continuing without them:", e);
  }
}

async function getLogFiltered(
  params: GetLogFilteredParams
): Promise<GitLogEntryExtended[]> {
  const { boxRoot, count, offset, greps } = params;
  const git = simpleGit(boxRoot);

  const grepArgs = [
    "--extended-regexp",
    "--all-match",
    ...greps.map((g) => `--grep=${g}`),
  ];
  const pageArgs = [
    `--max-count=${count}`,
    ...(offset > 0 ? [`--skip=${offset}`] : []),
  ];

  // ASCII record/field separators keep the format unambiguous against
  // commit messages that contain newlines, colons, or arbitrary text.
  const RS = "\u001E";
  const FS = "\u001F";

  let raw: string;
  try {
    raw = await git.raw([
      "log",
      ...grepArgs,
      ...pageArgs,
      `--format=${FS}%H${FS}%aI${FS}%s${FS}%b${RS}`,
    ]);
  } catch (_e) {
    // A filtered log over a repo with no matching/any commits throws — an
    // empty result set is the expected, non-error outcome here.
    return [];
  }

  const entries: GitLogEntryExtended[] = [];
  for (const record of raw.split(RS)) {
    if (!record.trim()) continue;
    const parts = record.split(FS);
    if (parts.length < 5) continue;
    const [, rawHash, rawDate, rawSubject, rawBody] = parts;
    invariant(
      rawHash !== undefined && rawDate !== undefined && rawSubject !== undefined && rawBody !== undefined,
      "record has fewer than 5 fields despite the length check above"
    );
    const hash = rawHash.trim();
    if (!/^[\da-f]{40}$/.test(hash)) continue;
    const body = rawBody.trim() || undefined;
    const trailers = parseTrailersMulti(body);
    entries.push({
      hash,
      date: rawDate.trim(),
      subject: rawSubject.trim(),
      body,
      trailers: Object.keys(trailers).length > 0 ? trailers : undefined,
    });
  }

  // Stats fetch applies the same grep filter + pagination so the hashes
  // line up with `entries`.
  await attachFilteredStats(git, { logArgs: [...grepArgs, ...pageArgs], entries });

  return entries;
}
