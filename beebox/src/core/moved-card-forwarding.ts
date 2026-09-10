import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { simpleGit } from "simple-git";

import { resolveBoxNamespacePathOnDisk } from "../lib/box-namespace-resolve.js";
import { childProcessEnv } from "../lib/env.js";
import { errorMessage } from "../lib/error-guards.js";
import type { MovedCardRecovery } from "./moved-card-recovery.js";

export type { MovedCardRecovery } from "./moved-card-recovery.js";

const MAX_MOVE_HOPS = 16;
const BOX_PATHSPEC = ".";

export type MovedCardResolution =
  | MovedCardRecovery
  | { kind: "not-moved" };

interface RenameRecord {
  from: string;
  to: string;
}

class GitRenameOutputError extends Error {
  constructor() {
    super("Git returned malformed name-status output");
    this.name = "GitRenameOutputError";
  }
}

/** Parse `git --name-status -z`, retaining only rename records. */
export function parseGitRenameRecords(raw: string): RenameRecord[] | null {
  const fields = raw.split("\0");
  if (fields.at(-1) === "") fields.pop();
  const records: RenameRecord[] = [];

  for (let index = 0; index < fields.length;) {
    const status = fields[index];
    index += 1;
    if (status === undefined || !/^[A-Z](?:\d{1,3})?$/.test(status)) return null;

    const pathsInRecord = status.startsWith("R") || status.startsWith("C") ? 2 : 1;
    const firstPath = fields[index];
    const secondPath = pathsInRecord === 2 ? fields[index + 1] : undefined;
    if (firstPath === undefined || (pathsInRecord === 2 && secondPath === undefined)) return null;
    index += pathsInRecord;

    if (status.startsWith("R") && secondPath !== undefined) {
      records.push({ from: firstPath, to: secondPath });
    }
  }

  return records;
}

function uniqueRenameDestination(records: RenameRecord[], source: string): string | null {
  const destinations = new Set(records.filter(record => record.from === source).map(record => record.to));
  return destinations.size === 1 ? [...destinations][0] ?? null : null;
}

async function workingTreeRenames(boxRoot: string): Promise<RenameRecord[]> {
  const normalGit = simpleGit(boxRoot);
  const rawObjectsPath = (await normalGit.revparse(["--git-path", "objects"])).trim();
  const realObjectsPath = isAbsolute(rawObjectsPath) ? rawObjectsPath : resolve(boxRoot, rawObjectsPath);
  const scratchRoot = await mkdtemp(join(tmpdir(), "bbx-move-index-"));
  const scratchObjects = join(scratchRoot, "objects");
  await mkdir(scratchObjects);

  try {
    // A separate index lets Git see unstaged filesystem renames without
    // touching the person's real index. A separate object directory also
    // keeps blobs written by `git add` ephemeral.
    const git = simpleGit(boxRoot).env(childProcessEnv({
      GIT_INDEX_FILE: join(scratchRoot, "index"),
      GIT_OBJECT_DIRECTORY: scratchObjects,
      GIT_ALTERNATE_OBJECT_DIRECTORIES: realObjectsPath,
    }));
    await git.raw(["read-tree", "HEAD"]);
    await git.raw(["add", "-A", "--", BOX_PATHSPEC]);
    const raw = await git.raw([
      "diff",
      "--cached",
      "--name-status",
      "-z",
      "--find-renames",
      "--relative",
      "HEAD",
      "--",
      BOX_PATHSPEC,
    ]);
    const records = parseGitRenameRecords(raw);
    if (records === null) throw new GitRenameOutputError();
    return records;
  } finally {
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
  const records = parseGitRenameRecords(raw);
  if (records === null) throw new GitRenameOutputError();
  return uniqueRenameDestination(records, source);
}

async function existingSafeFile(boxRoot: string, candidate: string): Promise<string | null> {
  const resolved = await resolveBoxNamespacePathOnDisk({ boxRoot, rawPath: candidate, mode: "read" });
  if (!resolved.ok) return null;
  try {
    return (await stat(resolved.resolved)).isFile() ? resolved.relativePath : null;
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
