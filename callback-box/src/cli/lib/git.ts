/**
 * Git operations for callback box.
 *
 * Git is the state engine - a change hasn't "happened" until it's committed.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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
 * Run a git command in the given directory.
 */
async function git(
  cwd: string,
  args: string[]
): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileAsync("git", args, { cwd });
  } catch (error: unknown) {
    const execError = error as { stderr?: string; stdout?: string; message: string };
    const stderr = execError.stderr ?? "";
    const stdout = execError.stdout ?? "";
    throw new Error(`Git error: ${stderr || stdout || execError.message}`);
  }
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
  await git(boxRoot, ["init", "-b", initialBranch]);
}

/**
 * Check if a directory is a git repository.
 */
export async function isRepo(dir: string): Promise<boolean> {
  try {
    await git(dir, ["rev-parse", "--git-dir"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the status of the repository.
 */
export async function getStatus(boxRoot: string): Promise<GitStatus> {
  const { stdout } = await git(boxRoot, ["status", "--porcelain"]);

  const staged: string[] = [];
  const modified: string[] = [];
  const untracked: string[] = [];

  for (const line of stdout.split("\n")) {
    if (!line) continue;

    const indexStatus = line[0];
    const workingStatus = line[1];
    const filePath = line.slice(3);

    // Staged changes (index has changes)
    if (indexStatus && indexStatus !== " " && indexStatus !== "?") {
      staged.push(filePath);
    }

    // Working tree changes
    if (workingStatus === "M" || workingStatus === "D") {
      modified.push(filePath);
    }

    // Untracked files
    if (indexStatus === "?" && workingStatus === "?") {
      untracked.push(filePath);
    }
  }

  return {
    staged,
    modified,
    untracked,
    clean: staged.length === 0 && modified.length === 0 && untracked.length === 0,
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
  await git(boxRoot, ["add", "--", ...paths]);
}

/**
 * Stage all changes.
 */
export async function stageAll(boxRoot: string): Promise<void> {
  await git(boxRoot, ["add", "-A"]);
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

  const commitArgs = ["commit", "-m", message];
  if (options.amend) {
    commitArgs.push("--amend");
  }
  await git(boxRoot, commitArgs);

  // Get the commit hash
  const { stdout } = await git(boxRoot, ["rev-parse", "HEAD"]);
  return stdout.trim();
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
  const format = "%H%x00%aI%x00%s%x00%b%x00";

  try {
    const { stdout } = await git(boxRoot, [
      "log",
      `-${count}`,
      `--format=${format}`,
    ]);

    const entries: GitLogEntry[] = [];
    const commits = stdout.split(String.fromCodePoint(0) + "\n").filter(Boolean);

    for (const commitText of commits) {
      const parts = commitText.split("\u0000");
      if (parts.length < 3) continue;

      const [hash, date, subject, body] = parts;

      // Parse trailers from body
      const trailers: Record<string, string> = {};
      if (body) {
        const lines = body.trim().split("\n");
        for (const line of lines) {
          const match = line.match(/^([A-Za-z-]+):\s*(.+)$/);
          if (match) {
            trailers[match[1]!] = match[2]!;
          }
        }
      }

      entries.push({
        hash: hash!,
        date: date!,
        subject: subject!,
        body: body?.trim() || undefined,
        trailers: Object.keys(trailers).length > 0 ? trailers : undefined,
      });
    }

    return entries;
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
  const args = staged ? ["diff", "--cached"] : ["diff"];
  const { stdout } = await git(boxRoot, args);
  return stdout;
}

/**
 * Get the current branch name.
 */
export async function getCurrentBranch(boxRoot: string): Promise<string> {
  const { stdout } = await git(boxRoot, ["branch", "--show-current"]);
  return stdout.trim();
}

/**
 * Check if there are any commits in the repository.
 */
export async function hasCommits(boxRoot: string): Promise<boolean> {
  try {
    await git(boxRoot, ["rev-parse", "HEAD"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create and switch to a new branch.
 */
export async function createBranch(boxRoot: string, name: string): Promise<void> {
  await git(boxRoot, ["checkout", "-b", name]);
}

/**
 * Switch to an existing branch.
 */
export async function checkoutBranch(boxRoot: string, name: string): Promise<void> {
  await git(boxRoot, ["checkout", name]);
}

/**
 * Create a lightweight tag.
 */
export async function createTag(boxRoot: string, name: string): Promise<void> {
  await git(boxRoot, ["tag", name]);
}

/**
 * Extended log entry with multi-value trailer support.
 */
export interface GitLogEntryExtended {
  hash: string;
  date: string;
  subject: string;
  body?: string | undefined;
  trailers?: Record<string, string | string[]> | undefined;
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
  const format = "%H%x00%aI%x00%s%x00%b%x00";

  try {
    const args = [
      "log",
      `-${count}`,
      `--format=${format}`,
    ];
    if (offset > 0) {
      args.push(`--skip=${offset}`);
    }

    const { stdout } = await git(boxRoot, args);

    const entries: GitLogEntryExtended[] = [];
    const commits = stdout.split(String.fromCodePoint(0) + "\n").filter(Boolean);

    for (const commitText of commits) {
      const parts = commitText.split("\u0000");
      if (parts.length < 3) continue;

      const [hash, date, subject, body] = parts;

      // Parse trailers from body, collecting multi-value keys
      const trailers: Record<string, string | string[]> = {};
      if (body) {
        const lines = body.trim().split("\n");
        for (const line of lines) {
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
      }

      entries.push({
        hash: hash!,
        date: date!,
        subject: subject!,
        body: body?.trim() || undefined,
        trailers: Object.keys(trailers).length > 0 ? trailers : undefined,
      });
    }

    return entries;
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
  try {
    // Try normal diff against parent, with low rename threshold
    // to detect moves even when content changes significantly (e.g. analyze phase)
    const { stdout } = await git(boxRoot, ["diff", "-M10", `${hash}~1`, hash]);
    return stdout;
  } catch {
    // Probably the initial commit with no parent
    try {
      const { stdout } = await git(boxRoot, ["show", "-M10", "--format=", hash]);
      return stdout;
    } catch {
      return "";
    }
  }
}
