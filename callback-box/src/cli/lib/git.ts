/**
 * Git operations for callback box.
 *
 * Git is the state engine - a change hasn't "happened" until it's committed.
 */

import { simpleGit, CleanOptions } from "simple-git";

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
  initialBranch = "main"
): Promise<void> {
  await simpleGit(boxRoot).raw(["init", "-b", initialBranch]);
}

/**
 * Check if a directory is a git repository.
 */
export async function isRepo(dir: string): Promise<boolean> {
  try {
    return await simpleGit(dir).checkIsRepo();
  } catch {
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
  await simpleGit(boxRoot).add(paths);
}

/**
 * Stage all changes.
 */
export async function stageAll(boxRoot: string): Promise<void> {
  await simpleGit(boxRoot).raw(["add", "-A"]);
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
  let message = options.message;

  // Add trailers if provided
  if (options.trailers && Object.keys(options.trailers).length > 0) {
    message += "\n";
    for (const [key, value] of Object.entries(options.trailers)) {
      message += `\n${key}: ${value}`;
    }
  }

  const git = simpleGit(boxRoot);
  const commitArgs = options.amend ? ["--amend"] : [];
  await git.commit(message, commitArgs);

  // Get the commit hash
  const hash = await git.revparse(["HEAD"]);
  return hash.trim();
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
  count = 10
): Promise<GitLogEntry[]> {
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
  } catch {
    // No commits yet
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
  staged = false
): Promise<string> {
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
  } catch {
    return false;
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
  count?: number;
  offset?: number;
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
  const { boxRoot, count = 50, offset = 0 } = params;

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

    // Fetch file stats (A/M/D counts) via --name-status
    const statMap = new Map<string, FileStat>();
    try {
      const skipArgs = offset > 0 ? ["--skip", String(offset)] : [];
      const raw = await git.raw([
        "log", `--max-count=${count}`, ...skipArgs,
        "--format=%H", "--name-status",
      ]);
      let currentHash: string | null = null;
      let stat: FileStat = { added: 0, modified: 0, deleted: 0 };
      for (const line of raw.split("\n")) {
        if (/^[\da-f]{40}$/.test(line)) {
          if (currentHash) statMap.set(currentHash, stat);
          currentHash = line;
          stat = { added: 0, modified: 0, deleted: 0 };
        } else if (currentHash && line.length > 0) {
          const status = line[0];
          if (status === "A") stat.added++;
          else if (status === "M") stat.modified++;
          else if (status === "D") stat.deleted++;
          else if (status === "R") { stat.added++; stat.deleted++; }
        }
      }
      if (currentHash) statMap.set(currentHash, stat);
    } catch {
      // stat data is optional — ignore failures
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
  } catch {
    // No commits yet
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
  } catch {
    // Probably the initial commit with no parent
    try {
      return await git.raw(["show", "-M10", "--format=", hash]);
    } catch {
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
  opts: { gitignored?: boolean; directories?: boolean } = {}
): Promise<void> {
  const modes: CleanOptions[] = [CleanOptions.FORCE];
  if (opts.gitignored) modes.push(CleanOptions.IGNORED_ONLY);
  if (opts.directories) modes.push(CleanOptions.RECURSIVE);
  await simpleGit(boxRoot).clean(modes);
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
