/**
 * Git operations for callback box.
 *
 * Git is the state engine - a change hasn't "happened" until it's committed.
 */

import { simpleGit, CleanOptions } from "simple-git";

/**
 * A git command failed with an error we don't specifically handle (i.e. not an
 * index.lock collision). Wraps the underlying cause so callers get a typed,
 * programmatically-distinguishable error while the original message is
 * preserved.
 */
class GitCommandError extends Error {
  readonly cause: unknown;
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "GitCommandError";
    this.cause = cause;
  }
}

/**
 * A git operation was called with no paths where at least one is required.
 */
class NoPathsError extends Error {
  constructor() {
    super("commitPaths requires at least one path");
    this.name = "NoPathsError";
  }
}

/**
 * Check if a git error is an index.lock collision. These happen when LFS
 * post-commit hooks or filter-process operations overlap with the next
 * git command — common when boxes track large binary files via LFS.
 */
function isIndexLockError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes("index.lock");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Shape of our custom git log format. */
interface GitLogFormat {
  hash: string;
  date: string;
  subject: string;
  body: string;
}

const LOG_FORMAT: GitLogFormat = {
  hash: "%H",
  date: "%aI",
  subject: "%s",
  body: "%b",
};

export interface GitCommitOptions {
  message: string;
  trailers?: Record<string, string>;
  amend?: boolean;
}

export interface GitPathCommitOptions extends GitCommitOptions {
  paths: string[];
}

export interface GitLogEntry {
  hash: string;
  date: string;
  subject: string;
  body?: string | undefined;
  trailers?: Record<string, string> | undefined;
}

export interface GitStatus {
  staged: string[];
  modified: string[];
  untracked: string[];
  clean: boolean;
}

/**
 * Initialize a new git repository.
 *
 * @param boxRoot - Directory to initialize
 * @param initialBranch - Name of the initial branch (default: "main")
 */
export async function initRepo(
  boxRoot: string,
  initialBranch?: string
): Promise<void> {
  initialBranch = initialBranch ?? "main";
  await simpleGit(boxRoot).raw(["init", "-b", initialBranch]);
}

/**
 * Check if a directory is a git repository.
 */
export async function isRepo(dir: string): Promise<boolean> {
  try {
    return await simpleGit(dir).checkIsRepo();
  } catch (_e) {
    // checkIsRepo throws when dir is not a git repo — that's the answer we want.
    return false;
  }
}

/**
 * Get the status of the repository.
 */
export async function getStatus(boxRoot: string): Promise<GitStatus> {
  const status = await simpleGit(boxRoot).status();

  // simple-git separates modified and deleted; our GitStatus combines
  // all working-tree changes (modifications + deletions) into `modified`
  // to match the original porcelain parsing behavior.
  const modified = [...status.modified, ...status.deleted.filter((f) => !status.staged.includes(f))];

  return {
    staged: status.staged,
    modified,
    untracked: status.not_added,
    clean: status.isClean(),
  };
}

/**
 * Stage files for commit.
 *
 * @param boxRoot - Repository root
 * @param paths - Files to stage (relative to boxRoot)
 */
export async function stageFiles(boxRoot: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  try {
    await simpleGit(boxRoot).add(paths);
  } catch (err) {
    if (isIndexLockError(err)) {
      await sleep(2000);
      await simpleGit(boxRoot).add(paths);
    } else {
      throw new GitCommandError(err);
    }
  }
}

/**
 * Check whether any of the given paths have tracked or untracked changes.
 *
 * @param boxRoot - Repository root
 * @param paths - Paths to inspect (relative to boxRoot)
 */
export async function pathsHaveChanges(boxRoot: string, paths: string[]): Promise<boolean> {
  if (paths.length === 0) return false;
  const output = await simpleGit(boxRoot).raw(["status", "--short", "--", ...paths]);
  return output.trim().length > 0;
}

/**
 * Stage all changes. Retries once on index.lock errors, which occur when
 * git-lfs post-commit hooks or filter-process operations overlap with the
 * next git operation — common in boxes that track images/audio via LFS.
 */
export async function stageAll(boxRoot: string): Promise<void> {
  try {
    await simpleGit(boxRoot).raw(["add", "-A"]);
  } catch (err) {
    if (isIndexLockError(err)) {
      await sleep(2000);
      await simpleGit(boxRoot).raw(["add", "-A"]);
    } else {
      throw new GitCommandError(err);
    }
  }
}

/**
 * Create a commit with the given message and optional trailers.
 *
 * @param boxRoot - Repository root
 * @param options - Commit options
 * @returns The commit hash
 */
export async function commit(
  boxRoot: string,
  options: GitCommitOptions
): Promise<string> {
  const message = buildCommitMessage(options);

  const git = simpleGit(boxRoot);
  const commitArgs = options.amend ? ["--amend"] : [];
  try {
    await git.commit(message, commitArgs);
  } catch (err) {
    if (isIndexLockError(err)) {
      await sleep(2000);
      await git.commit(message, commitArgs);
    } else {
      throw new GitCommandError(err);
    }
  }

  // Get the commit hash
  const hash = await git.revparse(["HEAD"]);
  return hash.trim();
}

/**
 * Commit only the given paths, ignoring unrelated staged changes.
 *
 * @param boxRoot - Repository root
 * @param paths - Paths to commit (relative to boxRoot)
 * @param options - Commit options
 * @returns The commit hash
 */
export async function commitPaths(
  boxRoot: string,
  options: GitPathCommitOptions,
): Promise<string> {
  const { paths } = options;
  if (paths.length === 0) {
    throw new NoPathsError();
  }

  const message = buildCommitMessage(options);
  const git = simpleGit(boxRoot);
  const commitArgs = ["commit", "-m", message];
  if (options.amend) {
    commitArgs.push("--amend");
  }
  commitArgs.push("--", ...paths);

  try {
    await git.raw(commitArgs);
  } catch (err) {
    if (isIndexLockError(err)) {
      await sleep(2000);
      await git.raw(commitArgs);
    } else {
      throw new GitCommandError(err);
    }
  }

  const hash = await git.revparse(["HEAD"]);
  return hash.trim();
}

function buildCommitMessage(options: GitCommitOptions): string {
  let message = options.message;

  if (options.trailers && Object.keys(options.trailers).length > 0) {
    message += "\n";
    for (const [key, value] of Object.entries(options.trailers)) {
      message += `\n${key}: ${value}`;
    }
  }

  return message;
}

/**
 * Get recent commits from the log.
 *
 * @param boxRoot - Repository root
 * @param count - Number of commits to retrieve
 * @returns Array of log entries
 */
export async function getLog(
  boxRoot: string,
  count?: number
): Promise<GitLogEntry[]> {
  count = count ?? 10;
  if (count === 0) return [];

  try {
    const result = await simpleGit(boxRoot).log<GitLogFormat>({
      maxCount: count,
      format: LOG_FORMAT,
    });

    return result.all.map((entry) => {
      const body = entry.body?.trim() || undefined;
      const trailers = parseTrailers(body);

      return {
        hash: entry.hash,
        date: entry.date,
        subject: entry.subject,
        body,
        trailers: Object.keys(trailers).length > 0 ? trailers : undefined,
      };
    });
  } catch (_e) {
    // log() throws on a repo with no commits yet — an empty history is the
    // expected, non-error result here.
    return [];
  }
}

/**
 * Get the diff of uncommitted changes.
 *
 * @param boxRoot - Repository root
 * @param staged - If true, show staged changes; if false, show unstaged
 * @returns The diff output
 */
export async function getDiff(
  boxRoot: string,
  staged?: boolean
): Promise<string> {
  staged = staged ?? false;
  const args = staged ? ["--cached"] : [];
  return await simpleGit(boxRoot).diff(args);
}

/**
 * Get the current branch name.
 */
export async function getCurrentBranch(boxRoot: string): Promise<string> {
  const branch = await simpleGit(boxRoot).branch();
  return branch.current;
}

/**
 * Check if there are any commits in the repository.
 */
export async function hasCommits(boxRoot: string): Promise<boolean> {
  try {
    await simpleGit(boxRoot).revparse(["HEAD"]);
    return true;
  } catch (_e) {
    // revparse HEAD fails when there are no commits yet — that means false.
    return false;
  }
}

/**
 * Result of a pushToRemote attempt. Designed to carry all information a
 * caller needs to log without re-throwing — push is expected to fail
 * intermittently (network, auth, upstream race) and callers should treat
 * errors as non-fatal.
 */
export interface PushResult {
  /** True when nothing was attempted (no remote, already up-to-date, no tracking). */
  skipped: boolean;
  /** Human-readable reason when skipped. */
  reason?: string;
  /** Number of commits that were pushed (0 when skipped). */
  commitsPushed: number;
  /** Error message when the push attempt itself failed. */
  error?: string;
}

/**
 * Push committed changes to the current branch's upstream, if configured
 * and ahead. Returns a structured result rather than throwing, so wakeup
 * and tick callers can log the outcome without blowing up the cycle.
 */
export async function pushToRemote(boxRoot: string): Promise<PushResult> {
  const git = simpleGit(boxRoot);

  const remotes = await git.getRemotes();
  if (remotes.length === 0) {
    return { skipped: true, reason: "no remote configured", commitsPushed: 0 };
  }

  const status = await git.status();
  if (!status.tracking) {
    return { skipped: true, reason: "no upstream tracking branch", commitsPushed: 0 };
  }
  if (status.ahead === 0) {
    return { skipped: true, reason: "already up to date", commitsPushed: 0 };
  }

  try {
    await git.push();
    return { skipped: false, commitsPushed: status.ahead };
  } catch (err) {
    return { skipped: false, commitsPushed: 0, error: (err as Error).message };
  }
}

/**
 * Create and switch to a new branch.
 */
export async function createBranch(boxRoot: string, name: string): Promise<void> {
  await simpleGit(boxRoot).checkoutLocalBranch(name);
}

/**
 * Switch to an existing branch.
 */
export async function checkoutBranch(boxRoot: string, name: string): Promise<void> {
  await simpleGit(boxRoot).checkout(name);
}

/**
 * Create a lightweight tag.
 */
export async function createTag(boxRoot: string, name: string): Promise<void> {
  await simpleGit(boxRoot).tag([name]);
}

/**
 * Delete a tag.
 */
export async function deleteTag(boxRoot: string, name: string): Promise<void> {
  await simpleGit(boxRoot).tag(["-d", name]);
}

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
 * Trailer keys that name a connector performing some action on a card.
 * For the browse UI these are treated as a single axis — selecting a
 * connector matches any of these trailers with that value.
 */
export const CONNECTOR_TRAILER_KEYS = [
  "Pulled-By",
  "Created-By",
  "Fetched-By",
  "Pushed-By",
  "Sent-By",
] as const;

/**
 * Trailer keys indicating a user-facing touchpoint (webapp, API call, voice/text input).
 */
export const TOUCHPOINT_TRAILER_KEYS = ["Source", "Endpoint", "Type"] as const;

/**
 * Trailer keys indicating feedback signal on a brief or card.
 */
export const FEEDBACK_TRAILER_KEYS = [
  "Thumbs",
  "Reactions",
  "Rating",
  "Feedback-Source",
] as const;

/**
 * Get paginated commits from the log with multi-value trailer support.
 *
 * @param params - Parameters object
 * @returns Array of log entries
 */
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

    // Fetch file stats via --name-status (A/M/D) and --numstat (line counts)
    const statMap = new Map<string, FileStat>();
    try {
      const skipArgs = offset > 0 ? ["--skip", String(offset)] : [];
      const baseArgs = ["log", `--max-count=${count}`, ...skipArgs, "--format=%H"];

      // File statuses
      const statusRaw = await git.raw([...baseArgs, "--name-status"]);
      const statusByHash = parseHashGrouped(statusRaw);

      // Line counts
      const numstatRaw = await git.raw([...baseArgs, "--numstat"]);
      const numstatByHash = parseHashGrouped(numstatRaw);

      for (const [hash, lines] of statusByHash) {
        const stat: FileStat = { added: 0, modified: 0, deleted: 0, renamed: 0, insertions: 0, deletions: 0 };
        for (const line of lines) {
          const status = line[0];
          if (status === "A") stat.added++;
          else if (status === "M") stat.modified++;
          else if (status === "D") stat.deleted++;
          else if (status === "R") stat.renamed++;
        }
        // Sum line changes from numstat for modified files
        const numLines = numstatByHash.get(hash) || [];
        for (const nl of numLines) {
          const parts = nl.split("\t");
          if (parts.length >= 2 && parts[0] !== "-") {
            stat.insertions += parseInt(parts[0]!, 10) || 0;
            stat.deletions += parseInt(parts[1]!, 10) || 0;
          }
        }
        statMap.set(hash, stat);
      }
    } catch (e) {
      // File stats are decorative — log-history still renders without them.
      console.warn("Failed to compute commit file stats; continuing without them:", e);
    }

    return result.all.map((entry) => {
      const body = entry.body?.trim() || undefined;
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
 * Get the diff for a specific commit.
 *
 * @param boxRoot - Repository root
 * @param hash - Commit hash
 * @returns The diff output
 */
export async function getCommitDiff(
  boxRoot: string,
  hash: string
): Promise<string> {
  const git = simpleGit(boxRoot);
  try {
    // Try normal diff against parent, with low rename threshold
    return await git.diff(["-M10", `${hash}~1`, hash]);
  } catch (_e) {
    // Diff against parent fails for the initial commit (no `${hash}~1`).
    // Fall back to `show`, which renders the initial commit's contents.
    try {
      return await git.raw(["show", "-M10", "--format=", hash]);
    } catch (e) {
      // Even `show` failed — likely a bad/unknown hash. Surface it and
      // fall back to an empty diff so the caller still renders.
      console.warn(`Failed to get diff for commit ${hash}; returning empty diff:`, e);
      return "";
    }
  }
}

/**
 * Get the current HEAD commit hash.
 */
export async function getHead(boxRoot: string): Promise<string> {
  const hash = await simpleGit(boxRoot).revparse(["HEAD"]);
  return hash.trim();
}

/**
 * Remove untracked files from the working tree.
 */
export async function clean(
  boxRoot: string,
  opts?: { gitignored?: boolean; directories?: boolean }
): Promise<void> {
  opts = opts ?? {};
  const modes: CleanOptions[] = [CleanOptions.FORCE];
  if (opts.gitignored) modes.push(CleanOptions.IGNORED_ONLY);
  if (opts.directories) modes.push(CleanOptions.RECURSIVE);
  await simpleGit(boxRoot).clean(modes);
}

/**
 * Aggregated distinct trailer values used by the history browse UI.
 */
export interface TrailerFacets {
  connectors: string[];
  workflows: string[];
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
        const key = match[1]!;
        const value = match[2]!.trim();
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
    const hash = parts[1]!.trim();
    if (!/^[\da-f]{40}$/.test(hash)) continue;
    const body = parts[4]!.trim() || undefined;
    const trailers = parseTrailersMulti(body);
    entries.push({
      hash,
      date: parts[2]!.trim(),
      subject: parts[3]!.trim(),
      body,
      trailers: Object.keys(trailers).length > 0 ? trailers : undefined,
    });
  }

  // Stats fetch applies the same grep filter + pagination so the hashes
  // line up with `entries`.
  try {
    const statusRaw = await git.raw([
      "log",
      ...grepArgs,
      ...pageArgs,
      "--format=%H",
      "--name-status",
    ]);
    const numstatRaw = await git.raw([
      "log",
      ...grepArgs,
      ...pageArgs,
      "--format=%H",
      "--numstat",
    ]);
    const statusByHash = parseHashGrouped(statusRaw);
    const numstatByHash = parseHashGrouped(numstatRaw);
    for (const entry of entries) {
      const stat: FileStat = {
        added: 0,
        modified: 0,
        deleted: 0,
        renamed: 0,
        insertions: 0,
        deletions: 0,
      };
      for (const line of statusByHash.get(entry.hash) || []) {
        const status = line[0];
        if (status === "A") stat.added++;
        else if (status === "M") stat.modified++;
        else if (status === "D") stat.deleted++;
        else if (status === "R") stat.renamed++;
      }
      for (const line of numstatByHash.get(entry.hash) || []) {
        const cols = line.split("\t");
        if (cols.length >= 2 && cols[0] !== "-") {
          stat.insertions += parseInt(cols[0]!, 10) || 0;
          stat.deletions += parseInt(cols[1]!, 10) || 0;
        }
      }
      entry.fileStat = stat;
    }
  } catch (e) {
    // File stats are decorative — the filtered history still renders the
    // entries without per-commit stat counts.
    console.warn("Failed to compute filtered commit file stats; continuing without them:", e);
  }

  return entries;
}

// --- Internal helpers ---

/**
 * Parse git trailers from a commit body (single-value).
 */
function parseTrailers(body: string | undefined): Record<string, string> {
  const trailers: Record<string, string> = {};
  if (!body) return trailers;

  for (const line of body.split("\n")) {
    const match = line.match(/^([A-Za-z-]+):\s*(.+)$/);
    if (match) {
      trailers[match[1]!] = match[2]!;
    }
  }
  return trailers;
}

/**
 * Parse git trailers from a commit body (multi-value).
 */
function parseTrailersMulti(body: string | undefined): Record<string, string | string[]> {
  const trailers: Record<string, string | string[]> = {};
  if (!body) return trailers;

  for (const line of body.split("\n")) {
    const match = line.match(/^([A-Za-z-]+):\s*(.+)$/);
    if (match) {
      const key = match[1]!;
      const value = match[2]!;
      const existing = trailers[key];
      if (existing === undefined) {
        trailers[key] = value;
      } else if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        trailers[key] = [existing, value];
      }
    }
  }
  return trailers;
}
