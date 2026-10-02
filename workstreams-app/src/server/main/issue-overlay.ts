import fs from "node:fs/promises";
import path from "node:path";

import { execa } from "execa";

import { ISSUE_CATEGORIES } from "./issue-domain.js";

export type OverlayStatus = "added" | "modified" | "deleted" | "renamed";
export interface OverlayEntry {
  worktree: string;
  status: OverlayStatus;
  committed: boolean;
  oldPath?: string;
}
export interface OverlayResult {
  byPath: Map<string, OverlayEntry[]>;
  byPathPrivate: Map<string, OverlayEntry[]>;
  worktreeRoots: Map<string, string>;
}

interface NameStatusRecord {
  code: "A" | "M" | "D" | "R";
  path: string;
  oldPath?: string;
}

export function parseNameStatusZ(stdout: string): NameStatusRecord[] {
  const tokens = stdout.split("\0").filter(Boolean);
  const records: NameStatusRecord[] = [];
  let index = 0;
  while (index < tokens.length) {
    const code = tokens[index++];
    const letter = code?.[0];
    if (letter === "R" || letter === "C") {
      const oldPath = tokens[index++];
      const newPath = tokens[index++];
      if (oldPath && newPath) records.push({ code: "R", path: newPath, oldPath });
    } else if (letter === "A" || letter === "M" || letter === "D") {
      const entryPath = tokens[index++];
      if (entryPath) records.push({ code: letter, path: entryPath });
    } else {
      index++;
    }
  }
  return records;
}

function status(code: NameStatusRecord["code"]): OverlayStatus {
  if (code === "A") return "added";
  if (code === "D") return "deleted";
  if (code === "R") return "renamed";
  return "modified";
}

function relativeIssuePath(entryPath: string): string {
  return entryPath.startsWith("issues/") ? entryPath.slice("issues/".length) : entryPath;
}

export function mergeOverlaySources(options: {
  worktree: string;
  committed: string;
  uncommitted: string;
  untracked: string;
}): Map<string, OverlayEntry[]> {
  const { worktree, committed, uncommitted, untracked } = options;
  const result = new Map<string, OverlayEntry[]>();
  const add = (relPath: string, entry: OverlayEntry): void => {
    const current = result.get(relPath) ?? [];
    current.push(entry);
    result.set(relPath, current);
  };
  const mergeStatuses = (stdout: string, isCommitted: boolean): void => {
    for (const record of parseNameStatusZ(stdout)) {
      const relPath = relativeIssuePath(record.path);
      const entry: OverlayEntry = {
        worktree, status: status(record.code), committed: isCommitted,
        ...(record.oldPath ? { oldPath: relativeIssuePath(record.oldPath) } : {}),
      };
      add(relPath, entry);
      if (record.code === "R" && record.oldPath) add(relativeIssuePath(record.oldPath), { ...entry });
    }
  };
  mergeStatuses(committed, true);
  mergeStatuses(uncommitted, false);
  for (const entryPath of untracked.split("\0").filter(Boolean)) {
    add(relativeIssuePath(entryPath), { worktree, status: "added", committed: false });
  }
  return result;
}

async function hasGitMarker(directory: string): Promise<boolean> {
  try {
    await fs.stat(path.join(directory, ".git"));
    return true;
  } catch (_error) {
    return false;
  }
}

function merge(target: Map<string, OverlayEntry[]>, source: Map<string, OverlayEntry[]>): void {
  for (const [relPath, entries] of source) target.set(relPath, [...(target.get(relPath) ?? []), ...entries]);
}

async function publicOverlay(worktree: string, root: string): Promise<Map<string, OverlayEntry[]>> {
  const run = (args: string[]) => execa("git", args, { cwd: root });
  const [committed, uncommitted, untracked] = await Promise.all([
    run(["diff", "--name-status", "-z", "main...HEAD", "--", "issues/"]),
    run(["diff", "--name-status", "-z", "HEAD", "--", "issues/"]),
    run(["ls-files", "--others", "--exclude-standard", "-z", "--", "issues/*.md", "issues/**/*.md"]),
  ]);
  return mergeOverlaySources({
    worktree,
    committed: committed.stdout,
    uncommitted: uncommitted.stdout,
    untracked: untracked.stdout,
  });
}

function privatePathspecs(): string[] {
  return ISSUE_CATEGORIES.flatMap((category) => [
    `:(glob)${category}/*.md`, `:(glob)closed/${category}/*.md`,
  ]);
}

async function privateOverlay(worktree: string, root: string): Promise<Map<string, OverlayEntry[]>> {
  const privateRoot = path.join(root, "private-issues");
  if (!(await hasGitMarker(privateRoot))) return new Map();
  const paths = privatePathspecs();
  const run = (args: string[]) => execa("git", args, { cwd: privateRoot });
  const [committed, uncommitted, untracked] = await Promise.all([
    run(["diff", "--name-status", "-z", "main...HEAD", "--", ...paths]),
    run(["diff", "--name-status", "-z", "HEAD", "--", ...paths]),
    run(["ls-files", "--others", "--exclude-standard", "-z", "--", ...paths]),
  ]);
  return mergeOverlaySources({
    worktree,
    committed: committed.stdout,
    uncommitted: uncommitted.stdout,
    untracked: untracked.stdout,
  });
}

export async function collectOverlay(worktreesRoot: string): Promise<OverlayResult> {
  const result: OverlayResult = { byPath: new Map(), byPathPrivate: new Map(), worktreeRoots: new Map() };
  let names: string[];
  try {
    names = (await fs.readdir(worktreesRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch (_error) {
    return result;
  }
  await Promise.all(names.map(async (name) => {
    const root = path.join(worktreesRoot, name);
    if (!(await hasGitMarker(root))) return;
    result.worktreeRoots.set(name, root);
    try {
      merge(result.byPath, await publicOverlay(name, root));
    } catch (error) {
      console.error(`[issues] skipping worktree overlay for ${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      merge(result.byPathPrivate, await privateOverlay(name, root));
    } catch (_error) {
      // The private mount is optional.
    }
  }));
  return result;
}
