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
import type { DocumentsService } from "./services.js";
import { resolveIssueTarget, saveIssueChanges } from "./issues-mutation-service.js";

const DOCUMENT_CACHE_MS = 60_000;

interface DocumentsSnapshot {
  issues: IssueRecord[];
  plans: Plan[];
  worktreeIssues: Array<{ worktree: string; issue: IssueRecord }>;
  worktreeTouchedSlugs: Array<{ worktree: string; slug: string }>;
  overlay: OverlayResult;
}

function discoveredInWorkstream(issue: IssueRecord, workstream: string): boolean {
  const origin = /^(worktree-[\w-]+)(?:\s+—|\s+-|$)/u.exec(
    issue.frontmatter.discoveredIn ?? "",
  )?.[1];
  return origin === `worktree-${workstream}`;
}

function selectIssuesForWorkstream(
  documents: DocumentsSnapshot,
  workstream: string,
): IssueRecord[] {
  const touched = new Set(documents.worktreeTouchedSlugs.map((entry) => entry.slug));
  const main = documents.issues.filter((issue) => !touched.has(issue.slug));
  const candidates = new Map<string, Array<{ worktree: string; issue: IssueRecord }>>();
  for (const entry of documents.worktreeIssues) {
    const records = candidates.get(entry.issue.slug) ?? [];
    records.push(entry);
    candidates.set(entry.issue.slug, records);
  }
  const overlaid = [...candidates.values()].map((records) => {
    const sorted = records.toSorted((a, b) => a.worktree.localeCompare(b.worktree));
    return (sorted.find((entry) => entry.issue.frontmatter.workstream === entry.worktree) ?? sorted[0])?.issue;
  }).filter((issue) => issue !== undefined);
  return [...main, ...overlaid].filter((issue) =>
    issue.frontmatter.workstream === workstream || discoveredInWorkstream(issue, workstream),
  ).toSorted((a, b) =>
    Number(a.closed) - Number(b.closed) || a.frontmatter.title.localeCompare(b.frontmatter.title));
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
    const slug = path.posix.basename(relPath, ".md");
    for (const worktree of new Set(entries.map((entry) => entry.worktree))) {
      const root = overlay.worktreeRoots.get(worktree);
      if (!root) continue;
      const issue = await readWorktreeIssue({ root, relPath, visibility });
      if (!issue) continue;
      touched.add(slug);
      const current = candidates.get(slug) ?? [];
      current.push({ issue, worktree });
      candidates.set(slug, current);
    }
  }
  const selected = [...candidates.values()].flatMap((records) => {
    const candidate = preferredCandidate(records);
    return candidate ? [candidate.issue] : [];
  });
  return [...main.filter((issue) => !touched.has(issue.slug)), ...selected];
}

function publicIssue(issue: IssueRecord, entries?: OverlayEntry[] | undefined): Issue {
  return {
    ...issue,
    ...(entries && entries.length > 0 ? { overlay: entries } : {}),
  };
}

async function worktreeIssueChanges(overlay: OverlayResult): Promise<{
  worktreeIssues: Array<{ worktree: string; issue: IssueRecord }>;
  worktreeTouchedSlugs: Array<{ worktree: string; slug: string }>;
}> {
  const worktreeIssues: Array<{ worktree: string; issue: IssueRecord }> = [];
  const worktreeTouchedSlugs: Array<{ worktree: string; slug: string }> = [];
  for (const [relPath, entries] of overlay.byPath) {
    for (const worktree of new Set(entries.map((entry) => entry.worktree))) {
      const root = overlay.worktreeRoots.get(worktree);
      if (!root) continue;
      const issue = await readWorktreeIssue({ root, relPath, visibility: "public" });
      if (!issue) continue;
      worktreeIssues.push({ worktree, issue });
      worktreeTouchedSlugs.push({ worktree, slug: issue.slug });
    }
  }
  return { worktreeIssues, worktreeTouchedSlugs };
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

  return {
    async listIssues(): Promise<Issue[]> {
      const state = await snapshot();
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
      return [...publicIssues, ...privateIssues].map((issue) =>
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
      const changedSlugs = new Set(state.worktreeTouchedSlugs.map((entry) => entry.slug));
      return {
        landed: state.issues.filter((issue) =>
          issue.visibility === "public" && !changedSlugs.has(issue.slug) && !issue.closed && issue.frontmatter.needs.includes("manual-testing"),
        ).map((issue) => publicIssue(issue)),
        pending: state.worktreeIssues.filter(({ issue }) =>
          !issue.closed && issue.frontmatter.needs.includes("manual-testing"),
        ).map(({ worktree, issue }) => ({ worktree, issue: publicIssue(issue) })),
      };
    },
    async issuesForWorkstream(name): Promise<Issue[]> {
      const state = await snapshot();
      return selectIssuesForWorkstream(state, name).map((issue) => publicIssue(issue));
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
