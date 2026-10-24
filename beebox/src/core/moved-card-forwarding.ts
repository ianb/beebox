import { copyFile, lstat, mkdir, mkdtemp, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { isAbsolute, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { simpleGit } from "simple-git";

import { resolveBoxNamespacePathOnDisk } from "../lib/box-namespace-resolve.js";
import { childProcessEnv } from "../lib/env.js";
import { isTrashedCard } from "../lib/paths/core.js";
import { attachDirFor } from "../shared/attach-path.js";
import { cardTypeFromName } from "../shared/card-name.js";
import { errorMessage } from "../shared/error-guards.js";
import type { MovedCardRecovery } from "./moved-card-recovery.js";

export type { MovedCardRecovery } from "./moved-card-recovery.js";

const MAX_MOVE_HOPS = 16;
const BOX_PATHSPEC = ".";
const execFileAsync = promisify(execFile);

export type MovedCardResolution =
  | MovedCardRecovery
  | { kind: "not-moved" };

interface RenameRecord {
  from: string;
  to: string;
}

/** One `--name-status` entry: its status letter and its one or two paths. */
export interface NameStatusRecord {
  status: string;
  paths: string[];
}

class GitRenameOutputError extends Error {
  constructor() {
    super("Git returned malformed name-status output");
    this.name = "GitRenameOutputError";
  }
}

/** Parse `git --name-status -z`, retaining only rename records. */
export function parseGitRenameRecords(raw: string): RenameRecord[] | null {
  const records = parseGitNameStatus(raw);
  return records === null ? null : renameRecords(records);
}

function renameRecords(records: NameStatusRecord[]): RenameRecord[] {
  return records.flatMap(({ status, paths: [from, to] }) =>
    status === "R" && from !== undefined && to !== undefined ? [{ from, to }] : []);
}

/** Parse `git --name-status -z` into every record, or null when malformed. */
function parseGitNameStatus(raw: string): NameStatusRecord[] | null {
  const fields = raw.split("\0");
  if (fields.at(-1) === "") fields.pop();
  const records: NameStatusRecord[] = [];

  for (let index = 0; index < fields.length;) {
    const status = fields[index];
    index += 1;
    if (status === undefined || !/^[A-Z](?:\d{1,3})?$/.test(status)) return null;

    const pathsInRecord = status.startsWith("R") || status.startsWith("C") ? 2 : 1;
    const firstPath = fields[index];
    const secondPath = pathsInRecord === 2 ? fields[index + 1] : undefined;
    if (firstPath === undefined || (pathsInRecord === 2 && secondPath === undefined)) return null;
    index += pathsInRecord;

    records.push({ status: status.charAt(0), paths: secondPath === undefined ? [firstPath] : [firstPath, secondPath] });
  }

  return records;
}

/**
 * The card a commit's delete of `source` most plausibly became, when Git saw
 * no rename. A move plus an edit in one commit can fall below Git's rename
 * similarity, so it reads as a delete and an add. Cards of one type share
 * their frontmatter keys, so similarity alone would pair unrelated cards;
 * pair only when the commit added exactly one live card of the same type, or
 * when exactly one such card received the files from the source's `.attach`
 * folder.
 */
export function pairedSuccessor(records: NameStatusRecord[], source: string): string | null {
  const type = cardTypeFromName(source);
  if (type === undefined) return null;
  if (!records.some(({ status, paths }) => status === "D" && paths[0] === source)) return null;
  if (trashedInCommit(records, source)) return null;

  const added = records
    .filter(({ status }) => status === "A")
    .map(({ paths }) => paths[0])
    .filter((path): path is string => path !== undefined && cardTypeFromName(path) === type && !isTrashedCard(path));
  if (added.length === 1) return added[0] ?? null;
  if (added.length === 0) return null;

  const sourceAttach = `${attachDirFor(source)}/`;
  const leftAttach = records.some(({ status, paths }) =>
    (status === "R" || status === "D") && paths[0]?.startsWith(sourceAttach) === true);
  if (!leftAttach) return null;
  const arrivals = records.flatMap(({ status, paths }) =>
    status === "R" ? [paths[1]] : status === "A" ? [paths[0]] : []);
  const withAttach = added.filter(card => {
    const attach = `${attachDirFor(card)}/`;
    return arrivals.some(path => path?.startsWith(attach) === true);
  });
  return withAttach.length === 1 ? withAttach[0] ?? null : null;
}

/**
 * Whether this commit moved `source` into trash: an add under
 * `_bookkeeping/trash/` with the source's file name, or a rename from it into
 * trash. A trashed card has no successor, whatever else the commit added.
 */
function trashedInCommit(records: NameStatusRecord[], source: string): boolean {
  const name = source.slice(source.lastIndexOf("/") + 1);
  return records.some(({ status, paths: [first, second] }) =>
    (status === "A" && first !== undefined && isTrashedCard(first) && first.slice(first.lastIndexOf("/") + 1) === name)
    || (status === "R" && first === source && second !== undefined && isTrashedCard(second)));
}

function uniqueRenameDestination(records: RenameRecord[], source: string): string | null {
  const destinations = new Set(records.filter(record => record.from === source).map(record => record.to));
  return destinations.size === 1 ? [...destinations][0] ?? null : null;
}

async function workingTreeRenames(boxRoot: string): Promise<RenameRecord[]> {
  const normalGit = simpleGit(boxRoot);
  const repoRoot = (await normalGit.revparse(["--show-toplevel"])).trim();
  const head = (await normalGit.revparse(["HEAD"])).trim();
  const annexBranch = (await normalGit.raw([
    "for-each-ref",
    "--format=%(objectname)",
    "refs/heads/git-annex",
  ])).trim();
  const rawObjectsPath = (await normalGit.revparse(["--git-path", "objects"])).trim();
  const realObjectsPath = isAbsolute(rawObjectsPath) ? rawObjectsPath : resolve(repoRoot, rawObjectsPath);
  const rawIndexPath = (await normalGit.revparse(["--git-path", "index"])).trim();
  const realIndexPath = isAbsolute(rawIndexPath) ? rawIndexPath : resolve(repoRoot, rawIndexPath);
  const rawConfigPath = (await normalGit.revparse(["--git-path", "config"])).trim();
  const realConfigPath = isAbsolute(rawConfigPath) ? rawConfigPath : resolve(repoRoot, rawConfigPath);
  const rawAttributesPath = (await normalGit.revparse(["--git-path", "info/attributes"])).trim();
  const realAttributesPath = isAbsolute(rawAttributesPath) ? rawAttributesPath : resolve(repoRoot, rawAttributesPath);
  const scratchRoot = await mkdtemp(join(tmpdir(), "bbx-move-index-"));
  const scratchGitDir = join(scratchRoot, "git");

  try {
    await simpleGit().raw(["init", "--bare", "--quiet", scratchGitDir]);
    await copyFile(realConfigPath, join(scratchGitDir, "config"));
    await copyFile(realIndexPath, join(scratchGitDir, "index"));
    await mkdir(join(scratchGitDir, "info"), { recursive: true });
    try {
      await copyFile(realAttributesPath, join(scratchGitDir, "info", "attributes"));
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? error.code : null;
      if (code !== "ENOENT") throw error;
    }

    // A separate Git directory lets Git see unstaged filesystem renames
    // without touching the person's real index, object store, or filter state
    // (notably `.git/annex`). It reads committed objects through an alternate.
    const git = simpleGit(boxRoot).env(childProcessEnv({
      GIT_DIR: scratchGitDir,
      GIT_WORK_TREE: repoRoot,
      GIT_ALTERNATE_OBJECT_DIRECTORIES: realObjectsPath,
    }));
    await git.raw(["config", "core.bare", "false"]);
    await git.raw(["config", "core.worktree", repoRoot]);
    if (annexBranch !== "") await git.raw(["update-ref", "refs/heads/git-annex", annexBranch]);
    await git.raw(["add", "-A", "--", BOX_PATHSPEC]);
    const raw = await git.raw([
      "diff",
      "--cached",
      "--name-status",
      "-z",
      "--find-renames",
      "--relative",
      head,
      "--",
      BOX_PATHSPEC,
    ]);
    const records = parseGitRenameRecords(raw);
    if (records === null) throw new GitRenameOutputError();
    return records;
  } finally {
    try {
      await execFileAsync("chmod", ["-R", "u+w", scratchRoot]);
    } catch (_e) {
      /* ignore: best-effort; rm reports anything that actually prevents cleanup */
    }
    await rm(scratchRoot, { recursive: true, force: true });
  }
}

async function committedRename(boxRoot: string, source: string): Promise<string | null> {
  const raw = await simpleGit(boxRoot).raw([
    "log",
    "-1",
    "--format=",
    "--full-diff",
    "--name-status",
    "-z",
    "--find-renames",
    "--relative",
    "--",
    source,
  ]);
  const records = parseGitNameStatus(raw);
  if (records === null) throw new GitRenameOutputError();
  return uniqueRenameDestination(renameRecords(records), source) ?? pairedSuccessor(records, source);
}

async function existingSafeFile(boxRoot: string, candidate: string): Promise<string | null> {
  const resolved = await resolveBoxNamespacePathOnDisk({ boxRoot, rawPath: candidate, mode: "read" });
  if (!resolved.ok) return null;
  try {
    return (await lstat(resolved.resolved)).isFile() ? resolved.relativePath : null;
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : null;
    if (code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Best-effort recovery for a card read that has already returned ENOENT.
 * Never call this before the normal read: Git work belongs only on the miss.
 */
export async function resolveMovedCardPath({
  boxRoot,
  missingPath,
  warn,
}: {
  boxRoot: string;
  missingPath: string;
  warn?: ((message: string) => void) | undefined;
}): Promise<MovedCardResolution> {
  const reportWarning = warn ?? console.warn;
  let warningReported = false;
  try {
    if (await existingSafeFile(boxRoot, missingPath)) return { kind: "not-moved" };
    let uncommittedRenames: RenameRecord[] = [];
    try {
      uncommittedRenames = await workingTreeRenames(boxRoot);
    } catch (error) {
      reportWarning(`Could not inspect uncommitted moved cards for ${missingPath}: ${errorMessage(error)}`);
      warningReported = true;
    }
    const visited = new Set<string>();
    let candidate = missingPath;

    for (let hop = 0; hop < MAX_MOVE_HOPS; hop += 1) {
      if (visited.has(candidate)) return { kind: "not-moved" };
      visited.add(candidate);

      const next = uniqueRenameDestination(uncommittedRenames, candidate)
        ?? await committedRename(boxRoot, candidate);
      if (next === null || next === candidate) return { kind: "not-moved" };

      const existing = await existingSafeFile(boxRoot, next);
      if (existing !== null) {
        // The source may have been recreated while Git was running. A real file
        // at the requested path always wins over historical recovery.
        if (await existingSafeFile(boxRoot, missingPath)) return { kind: "not-moved" };
        return { kind: "moved", path: existing };
      }
      candidate = next;
    }

    return { kind: "not-moved" };
  } catch (error) {
    if (!warningReported) reportWarning(`Could not resolve moved card ${missingPath}: ${errorMessage(error)}`);
    return { kind: "not-moved" };
  }
}
