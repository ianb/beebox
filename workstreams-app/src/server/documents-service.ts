import fs from "node:fs/promises";
import path from "node:path";

import {
  listIssues,
  parseFrontmatter,
  parseIssueFile,
  type IssueRecord,
  type Visibility,
} from "./issue-domain.js";
import {
  collectOverlay,
  type OverlayEntry,
  type OverlayResult,
} from "./issue-overlay.js";
import type {
  Issue,
  Plan,
  TestingQueue,
} from "../shared/documents.js";
import type { WorkstreamIssue } from "../shared/workstreams.js";
import type { DocumentsService } from "./services.js";
import { resolveIssueTarget, saveIssueChanges } from "./issues-mutation-service.js";
import { resolveIssuePath } from "./issue-path.js";

const DOCUMENT_CACHE_MS = 60_000;

interface DocumentsSnapshot {
  issues: IssueRecord[];
  plans: Plan[];
  worktreeIssues: Array<{ worktree: string; issue: IssueRecord }>;
  overlay: OverlayResult;
}

function issueKey(issue: Pick<IssueRecord, "relPath" | "visibility">): string {
  return `${issue.visibility}:${issue.relPath}`;
}

function discoveredInWorkstream(issue: IssueRecord, workstream: string): boolean {
  const origin = /^(worktree-[\w-]+)(?:\s+—|\s+-|$)/u.exec(
    issue.frontmatter.discoveredIn ?? "",
  )?.[1];
  return origin === `worktree-${workstream}`;
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
  const documentsRoot = path.join(root, visibility === "private" ? "private-issues" : "issues");
  try {
    const target = await resolveIssuePath(documentsRoot, relPath);
    return parseIssueFile({ relPath, source: await fs.readFile(target, "utf8"), visibility });
  } catch (_error) {
    return null;
  }
}

function preferredCandidate<T extends { issue: IssueRecord; worktree: string }>(
  records: T[],
): T | undefined {
  const sorted = records.toSorted((a, b) => a.worktree.localeCompare(b.worktree));
  return sorted.find(({ issue, worktree }) => issue.frontmatter.workstream === worktree) ?? sorted[0];
}

async function authoritativeIssues(options: {
  main: IssueRecord[];
  overlay: OverlayResult;
  visibility: Visibility;
}): Promise<IssueRecord[]> {
  const { main, overlay, visibility } = options;
  const touched = new Set<string>();
  const candidates = new Map<string, Array<{ issue: IssueRecord; worktree: string }>>();
  for (const [relPath, entries] of overlayMap(overlay, visibility)) {
    for (const worktree of new Set(entries.map((entry) => entry.worktree))) {
      const root = overlay.worktreeRoots.get(worktree);
      if (!root) continue;
      const issue = await readWorktreeIssue({ root, relPath, visibility });
      if (!issue) continue;
      const key = issueKey(issue);
      touched.add(key);
      const current = candidates.get(key) ?? [];
      current.push({ issue, worktree });
      candidates.set(key, current);
    }
  }
  const selected = [...candidates.values()].flatMap((records) => {
    const candidate = preferredCandidate(records);
    return candidate ? [candidate.issue] : [];
  });
  return [...main.filter((issue) => !touched.has(issueKey(issue))), ...selected];
}

function publicIssue(issue: IssueRecord, entries?: OverlayEntry[] | undefined): Issue {
  return {
    ...issue,
    ...(entries && entries.length > 0 ? { overlay: entries } : {}),
  };
}

async function worktreeIssueChanges(overlay: OverlayResult): Promise<{
  worktreeIssues: Array<{ worktree: string; issue: IssueRecord }>;
}> {
  const worktreeIssues: Array<{ worktree: string; issue: IssueRecord }> = [];
  for (const [visibility, entriesByPath] of [
    ["public", overlay.byPath],
    ["private", overlay.byPathPrivate],
  ] as const) {
    for (const [relPath, entries] of entriesByPath) {
      for (const worktree of new Set(entries.map((entry) => entry.worktree))) {
        const root = overlay.worktreeRoots.get(worktree);
        if (!root) continue;
        const issue = await readWorktreeIssue({ root, relPath, visibility });
        if (!issue) continue;
        worktreeIssues.push({ worktree, issue });
      }
    }
  }
  return { worktreeIssues };
}

export function workstreamIssueIndicators(options: {
  workstream: string;
  issue: IssueRecord;
  main?: IssueRecord | undefined;
  changedHere: boolean;
}): Omit<WorkstreamIssue, "issue"> {
  const { workstream, issue, main, changedHere } = options;
  let activity: WorkstreamIssue["activity"];
  if (changedHere) {
    if (main?.closed && !issue.closed) activity = "reopened";
    else if (!main) activity = "opened";
    else if (!main.closed && issue.closed) activity = "closed";
    else activity = "updated";
  }
  return {
    owned: issue.frontmatter.workstream === workstream,
    discovered: discoveredInWorkstream(issue, workstream),
    ...(activity ? { activity } : {}),
  };
}

async function listPlans(mainRoot: string): Promise<Plan[]> {
  const records: Plan[] = [];
  for (const dir of ["plans", "implemented-plans", "unimplemented-plans"]) {
    const root = path.join(mainRoot, "callback-box", "docs", dir);
    const names = await fs.readdir(root).catch(() => []);
    for (const name of names) {
      if (!name.endsWith(".md") || name === "README.md" || name.endsWith(".review.md")) continue;
      const relPath = `callback-box/docs/${dir}/${name}`;
      const { data } = parseFrontmatter(await fs.readFile(path.join(root, name), "utf8"));
      records.push({
        title: typeof data.title === "string" ? data.title : name.replace(/\.md$/u, ""),
        status: typeof data.status === "string" ? data.status : "unknown",
        workstream: typeof data.workstream === "string" ? data.workstream : "unknown",
        relPath,
      });
    }
  }
  return records.toSorted((a, b) => a.title.localeCompare(b.title));
}

export interface DocumentsServiceOptions {
  mainRoot: string;
  worktreesRoot: string;
  now?: () => number;
}

export function createDocumentsService(options: DocumentsServiceOptions): DocumentsService {
  const now = options.now ?? Date.now;
  let cache: { at: number; value: DocumentsSnapshot } | null = null;

  async function snapshot(): Promise<DocumentsSnapshot> {
    if (cache && now() - cache.at < DOCUMENT_CACHE_MS) return cache.value;
    const [publicIssues, privateIssues, plans, overlay] = await Promise.all([
      listIssues(path.join(options.mainRoot, "issues"), "public"),
      listIssues(path.join(options.mainRoot, "private-issues"), "private"),
      listPlans(options.mainRoot),
      collectOverlay(options.worktreesRoot),
    ]);
    const changes = await worktreeIssueChanges(overlay);
    const value = {
      issues: [...publicIssues, ...privateIssues],
      plans,
      overlay,
      ...changes,
    };
    cache = { at: now(), value };
    return value;
  }

  async function currentIssues(state: DocumentsSnapshot): Promise<IssueRecord[]> {
    const [publicIssues, privateIssues] = await Promise.all([
      authoritativeIssues({
        main: state.issues.filter((issue) => issue.visibility === "public"),
        overlay: state.overlay,
        visibility: "public",
      }),
      authoritativeIssues({
        main: state.issues.filter((issue) => issue.visibility === "private"),
        overlay: state.overlay,
        visibility: "private",
      }),
    ]);
    return [...publicIssues, ...privateIssues];
  }

  return {
    async listIssues(): Promise<Issue[]> {
      const state = await snapshot();
      return (await currentIssues(state)).map((issue) =>
        publicIssue(issue, overlayMap(state.overlay, issue.visibility).get(issue.relPath)),
      );
    },
    async issueDetail(relPath, visibility): Promise<Issue> {
      const state = await snapshot();
      const target = await resolveIssueTarget({
        relPath,
        visibility,
        mainRoot: options.mainRoot,
        overlay: state.overlay,
      });
      const source = await fs.readFile(target, "utf8");
      const issue = parseIssueFile({ relPath, source, visibility });
      return { ...publicIssue(issue, overlayMap(state.overlay, visibility).get(relPath)), body: parseFrontmatter(source).body };
    },
    async listPlans(): Promise<Plan[]> {
      return (await snapshot()).plans;
    },
    async testingQueue(): Promise<TestingQueue> {
      const state = await snapshot();
      const changedPaths = new Set(state.worktreeIssues.map(({ issue }) => issueKey(issue)));
      return {
        landed: state.issues.filter((issue) =>
          issue.visibility === "public" && !changedPaths.has(issueKey(issue)) && !issue.closed && issue.frontmatter.needs.includes("manual-testing"),
        ).map((issue) => publicIssue(issue)),
        pending: state.worktreeIssues.filter(({ issue }) =>
          !issue.closed && issue.frontmatter.needs.includes("manual-testing"),
        ).map(({ worktree, issue }) => ({ worktree, issue: publicIssue(issue) })),
      };
    },
    async issuesForWorkstream(name): Promise<WorkstreamIssue[]> {
      const state = await snapshot();
      return (await currentIssues(state)).filter((issue) =>
        issue.frontmatter.workstream === name || discoveredInWorkstream(issue, name),
      ).toSorted((left, right) =>
        Number(left.closed) - Number(right.closed) || left.frontmatter.title.localeCompare(right.frontmatter.title),
      ).map((issue) => ({
        issue: publicIssue(issue, overlayMap(state.overlay, issue.visibility).get(issue.relPath)),
        ...workstreamIssueIndicators({
          workstream: name,
          issue,
          main: state.issues.find((candidate) => issueKey(candidate) === issueKey(issue)),
          changedHere: state.worktreeIssues.some((entry) =>
            entry.worktree === name && issueKey(entry.issue) === issueKey(issue)),
        }),
      }));
    },
    async saveIssueChanges(changes): Promise<number> {
      const saved = await saveIssueChanges({
        changes,
        mainRoot: options.mainRoot,
        worktreesRoot: options.worktreesRoot,
      });
      cache = null;
      return saved;
    },
  };
}
