import { randomUUID } from "node:crypto";
import type { BigIntStats } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { execa } from "execa";

import {
  parseIssueFile,
  setIssueNextAction,
  setIssuePriority,
  type IssueRecord,
  type Visibility,
} from "./issue-domain.js";
import {
  collectOverlay,
  type OverlayEntry,
  type OverlayResult,
} from "./issue-overlay.js";
import type { IssueChange } from "../shared/documents.js";

const MAX_CHANGES = 1_000;

export class IssueMutationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IssueMutationError";
  }
}

function mutationError(reason: string, issue: string): IssueMutationError {
  const messages: Record<string, string> = {
    "too-many": "too many issue changes",
    duplicate: `duplicate issue change: ${issue}`,
    "changed-read": `issue changed while being read: ${issue}`,
    "changed-save": `issue changed while being saved: ${issue}`,
    "priority-conflict": `issue priority changed since the page loaded: ${issue}`,
    "action-conflict": `issue next action changed since the page loaded: ${issue}`,
    "new-issue": `commit this new issue before changing its priority: ${issue}`,
    "other-edits": `issue has other uncommitted edits: ${issue}`,
    "staged-edits": `issue has staged edits: ${issue}`,
    "inspect-failed": `could not inspect issue state: ${issue}`,
  };
  return new IssueMutationError(messages[reason] ?? "issue update failed");
}

function overlayMap(overlay: OverlayResult, visibility: Visibility): Map<string, OverlayEntry[]> {
  return visibility === "private" ? overlay.byPathPrivate : overlay.byPath;
}

async function readWorktreeIssue(options: {
  root: string;
  relPath: string;
  visibility: Visibility;
}): Promise<IssueRecord | null> {
  const { root, relPath, visibility } = options;
  const target = path.join(root, visibility === "private" ? "private-issues" : "issues", relPath);
  try {
    return parseIssueFile({ relPath, source: await fs.readFile(target, "utf8"), visibility });
  } catch (_error) {
    return null;
  }
}

function preferredCandidate<T extends { issue: IssueRecord; worktree: string }>(records: T[]): T | undefined {
  const sorted = records.toSorted((a, b) => a.worktree.localeCompare(b.worktree));
  return sorted.find(({ issue, worktree }) => issue.frontmatter.workstream === worktree) ?? sorted[0];
}

export async function resolveIssueTarget(options: {
  relPath: string;
  visibility: Visibility;
  mainRoot: string;
  overlay: OverlayResult;
}): Promise<string> {
  const entries = overlayMap(options.overlay, options.visibility).get(options.relPath) ?? [];
  const worktrees = [...new Set(entries.map((entry) => entry.worktree))].toSorted();
  const candidates = await Promise.all(worktrees.map(async (worktree) => {
    const root = options.overlay.worktreeRoots.get(worktree);
    if (!root) return null;
    const issue = await readWorktreeIssue({ root, relPath: options.relPath, visibility: options.visibility });
    return issue ? { issue, root, worktree } : null;
  }));
  const selected = preferredCandidate(candidates.filter((candidate) => candidate !== null));
  const documentsDir = options.visibility === "private" ? "private-issues" : "issues";
  const root = selected
    ? path.join(selected.root, documentsDir)
    : path.join(options.mainRoot, documentsDir);
  return path.join(root, options.relPath);
}

async function assertMetadataOnly(options: {
  target: string;
  source: string;
  issue: IssueRecord;
}): Promise<void> {
  const { target, source, issue } = options;
  const canonicalTarget = await fs.realpath(target);
  const { stdout: rootOutput } = await execa("git", ["rev-parse", "--show-toplevel"], {
    cwd: path.dirname(canonicalTarget),
  });
  const repoRoot = rootOutput.trim();
  const repoPath = path.relative(repoRoot, canonicalTarget);
  const head = await execa("git", ["show", `HEAD:${repoPath}`], {
    cwd: repoRoot,
    reject: false,
    stripFinalNewline: false,
  });
  if (head.exitCode !== 0) throw mutationError("new-issue", issue.relPath);
  const normalizedHead = setIssueNextAction(
    setIssuePriority(head.stdout, issue.frontmatter.priority),
    issue.frontmatter.nextAction,
  );
  if (normalizedHead !== source) throw mutationError("other-edits", issue.relPath);
  const staged = await execa("git", ["diff", "--cached", "--quiet", "--", repoPath], {
    cwd: repoRoot,
    reject: false,
  });
  if (staged.exitCode === 1) throw mutationError("staged-edits", issue.relPath);
  if (staged.exitCode !== 0) throw mutationError("inspect-failed", issue.relPath);
}

async function commitTargets(targets: string[]): Promise<void> {
  const byRepo = new Map<string, string[]>();
  for (const target of targets) {
    const canonicalTarget = await fs.realpath(target);
    const { stdout } = await execa("git", ["rev-parse", "--show-toplevel"], {
      cwd: path.dirname(canonicalTarget),
    });
    const repoRoot = stdout.trim();
    const current = byRepo.get(repoRoot) ?? [];
    current.push(path.relative(repoRoot, canonicalTarget));
    byRepo.set(repoRoot, current);
  }
  for (const [repoRoot, repoTargets] of byRepo) {
    await execa("git", ["add", "--", ...repoTargets], { cwd: repoRoot });
    const staged = await execa("git", ["diff", "--cached", "--quiet", "--", ...repoTargets], {
      cwd: repoRoot,
      reject: false,
    });
    if (staged.exitCode === 0) continue;
    if (staged.exitCode !== 1) throw mutationError("inspect-failed", repoTargets[0] ?? "issue");
    await execa("git", ["commit", "--only", "-m", "Update issue metadata", "--", ...repoTargets], {
      cwd: repoRoot,
    });
  }
}

interface PreparedChange {
  change: IssueChange;
  target: string;
  source: string;
  updated: string;
  stat: BigIntStats;
}

async function prepareChange(
  change: IssueChange,
  options: { mainRoot: string; overlay: OverlayResult },
): Promise<PreparedChange> {
  const target = await resolveIssueTarget({
    relPath: change.relPath,
    visibility: change.visibility,
    mainRoot: options.mainRoot,
    overlay: options.overlay,
  });
  const before = await fs.stat(target, { bigint: true });
  const source = await fs.readFile(target, "utf8");
  const afterRead = await fs.stat(target, { bigint: true });
  if (before.ino !== afterRead.ino || before.mtimeNs !== afterRead.mtimeNs || before.size !== afterRead.size) {
    throw mutationError("changed-read", change.relPath);
  }
  const issue = parseIssueFile({ relPath: change.relPath, source, visibility: change.visibility });
  if (change.originalPriority !== issue.frontmatter.priority) {
    throw mutationError("priority-conflict", change.relPath);
  }
  if (change.originalNextAction !== (issue.frontmatter.nextAction ?? null)) {
    throw mutationError("action-conflict", change.relPath);
  }
  await assertMetadataOnly({ target, source, issue });
  const updated = setIssueNextAction(
    setIssuePriority(source, change.priority),
    change.nextAction ?? undefined,
  );
  return { change, target, source, updated, stat: afterRead };
}

async function writeChanges(changed: PreparedChange[]): Promise<void> {
  const temporaries = new Map<string, string>();
  try {
    for (const item of changed) {
      const temporary = `${item.target}.priority-${randomUUID()}.tmp`;
      await fs.writeFile(temporary, item.updated, { mode: Number(item.stat.mode & 0o777n) });
      temporaries.set(item.target, temporary);
    }
    for (const item of changed) {
      const current = await fs.stat(item.target, { bigint: true });
      if (current.ino !== item.stat.ino || current.mtimeNs !== item.stat.mtimeNs || current.size !== item.stat.size) {
        throw mutationError("changed-save", item.change.relPath);
      }
    }
    const renamed: PreparedChange[] = [];
    try {
      for (const item of changed) {
        const temporary = temporaries.get(item.target);
        if (!temporary) throw mutationError("inspect-failed", item.change.relPath);
        await fs.rename(temporary, item.target);
        renamed.push(item);
      }
    } catch (error) {
      await Promise.all(renamed.map((item) => fs.writeFile(item.target, item.source, {
        mode: Number(item.stat.mode & 0o777n),
      })));
      throw error;
    }
  } finally {
    await Promise.all([...temporaries.values()].map(async (temporary) => {
      await fs.unlink(temporary).catch(() => {});
    }));
  }
}

export async function saveIssueChanges(options: {
  changes: IssueChange[];
  mainRoot: string;
  worktreesRoot: string;
}): Promise<number> {
  if (options.changes.length > MAX_CHANGES) throw mutationError("too-many", "");
  const keys = new Set<string>();
  for (const change of options.changes) {
    const key = `${change.visibility}:${change.relPath}`;
    if (keys.has(key)) throw mutationError("duplicate", change.relPath);
    keys.add(key);
  }
  const overlay = await collectOverlay(options.worktreesRoot);
  const prepared = await Promise.all(options.changes.map((change) =>
    prepareChange(change, { mainRoot: options.mainRoot, overlay })));
  const changed = prepared.filter((item) => item.source !== item.updated);
  await writeChanges(changed);
  await commitTargets(changed.map((item) => item.target));
  return changed.length;
}
