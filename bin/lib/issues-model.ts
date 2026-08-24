/**
 * The issue-queue domain for `bin/issues`: load, derive, filter, group.
 *
 * Parsing is NOT re-implemented here — `workstreams-app/src/server/issue-domain.ts`
 * owns the frontmatter reader and the `IssueRecord` shape, and the dev issue
 * browser and this CLI must agree about what an issue is. This module adds only
 * what a CLI needs on top: the two fields derivable from conventions rather than
 * frontmatter (`date` from the filename prefix, `discoveredInWorkstream` from the
 * `discovered-in` token), a display path that distinguishes the public queue from
 * the private one, and the filter/group predicates.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

import { listIssues, type IssueRecord, type ResearchState, type Visibility }
  from "../../workstreams-app/src/server/issue-domain.js";

/** Repo root, resolved from this file rather than the cwd (the CLI is location-independent). */
export const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");

export interface IssueEntry {
  /** Repo-relative display path, e.g. `issues/bugs/2026-01-02-x.md`. Also the index id. */
  path: string;
  /** Path relative to the issue root (`bugs/2026-01-02-x.md`) — what issue-domain speaks. */
  relPath: string;
  absPath: string;
  /** Filename without `.md` — the issue's ID, unique across the whole queue. */
  slug: string;
  title: string;
  category: string;
  closed: boolean;
  visibility: Visibility;
  workstream: string;
  area: string | null;
  labels: string[];
  needs: string[];
  priority: string;
  nextAction: string | null;
  research: ResearchState;
  /** `YYYY-MM-DD` from the filename prefix; null when the name predates the convention. */
  date: string | null;
  /** Bare workstream name from `discovered-in:`'s `worktree-<name>` token; null when absent. */
  discoveredInWorkstream: string | null;
  discoveredIn: string | null;
  discoveredBy: string | null;
  filedBy: string | null;
  resolution: string | null;
  body: string;
}

/** `2026-08-24-slug` → `2026-08-24`. */
export function deriveDate(slug: string): string | null {
  return /^(?<date>\d{4}-\d{2}-\d{2})-/u.exec(slug)?.groups?.["date"] ?? null;
}

/**
 * `worktree-scanner-ingest — while doing X` → `scanner-ingest`.
 *
 * The bare name is stored (not the `worktree-` token) because that is the name
 * everything else in the repo uses for a workstream — the router prefix, the
 * `workstream:` field, `bin/workstreams`. {@link normalizeWorkstreamName} lets a
 * caller pass either spelling.
 */
export function deriveDiscoveredInWorkstream(discoveredIn: string | undefined): string | null {
  if (discoveredIn === undefined) return null;
  const token = /^\s*worktree-(?<name>[A-Za-z0-9][A-Za-z0-9._-]*)/u.exec(discoveredIn);
  return token?.groups?.["name"] ?? null;
}

/** Accept `foo` or `worktree-foo` for any workstream-shaped filter value. */
export function normalizeWorkstreamName(value: string): string {
  return value.startsWith("worktree-") ? value.slice("worktree-".length) : value;
}

function optional(value: string | undefined): string | null {
  return value ?? null;
}

async function toEntry(options: {
  record: IssueRecord;
  issuesDir: string;
  rootLabel: string;
}): Promise<IssueEntry> {
  const { record, issuesDir, rootLabel } = options;
  const absPath = path.join(issuesDir, record.relPath);
  const source = await fs.readFile(absPath, "utf8");
  const bodyStart = /^---[ \t]*\r?\n[\s\S]*?^---[ \t]*\r?\n/mu.exec(source);
  const { frontmatter } = record;
  return {
    path: `${rootLabel}/${record.relPath}`,
    relPath: record.relPath,
    absPath,
    slug: record.slug,
    title: frontmatter.title,
    category: record.category,
    closed: record.closed,
    visibility: record.visibility,
    workstream: frontmatter.workstream,
    area: optional(frontmatter.area),
    labels: frontmatter.labels,
    needs: frontmatter.needs,
    priority: frontmatter.priority,
    nextAction: optional(frontmatter.nextAction),
    research: record.research,
    date: deriveDate(record.slug),
    discoveredInWorkstream: deriveDiscoveredInWorkstream(frontmatter.discoveredIn),
    discoveredIn: optional(frontmatter.discoveredIn),
    discoveredBy: optional(frontmatter.discoveredBy),
    filedBy: optional(frontmatter.filedBy),
    resolution: optional(frontmatter.resolution),
    body: bodyStart ? source.slice(bodyStart[0].length) : source,
  };
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await fs.stat(target)).isDirectory();
  } catch (_error) {
    return false;
  }
}

/**
 * Load every issue from `issues/`, plus `private-issues/` when that symlink is
 * mounted. An absent private mount is the normal state for a developer who has
 * not opted in, so it is silent rather than an error.
 *
 * `publicOnly` does not filter — it never READS the private queue. That is the
 * difference that matters: a private issue that is merely filtered out of the
 * results has still been loaded, indexed, and sent to an embeddings API.
 */
export async function loadIssueEntries(
  repoRoot: string = REPO_ROOT,
  options?: { publicOnly?: boolean },
): Promise<IssueEntry[]> {
  const sources: { dir: string; label: string; visibility: Visibility }[] = [
    { dir: path.join(repoRoot, "issues"), label: "issues", visibility: "public" },
  ];
  const privateDir = path.join(repoRoot, "private-issues");
  if (options?.publicOnly !== true && await isDirectory(privateDir)) {
    sources.push({ dir: privateDir, label: "private-issues", visibility: "private" });
  }
  const entries: IssueEntry[] = [];
  for (const source of sources) {
    const records = await listIssues(source.dir, source.visibility);
    for (const record of records) {
      entries.push(await toEntry({ record, issuesDir: source.dir, rootLabel: source.label }));
    }
  }
  return entries.toSorted((a, b) => a.path.localeCompare(b.path));
}

// ─── Filtering ───────────────────────────────────────────────────────────────

export type StatusFilter = "open" | "closed" | "all";

export interface IssueFilters {
  status: StatusFilter;
  /** Multi-valued fields are OR within a field and AND across fields… */
  category: string[];
  area: string[];
  workstream: string[];
  discoveredIn: string[];
  needs: string[];
  priority: string[];
  nextAction: string[];
  /** …except labels, where repeats mean AND (every label must be present). */
  labels: string[];
  since: string | null;
  research: ResearchState | null;
  visibility: Visibility | null;
}

export function emptyFilters(): IssueFilters {
  return {
    status: "open",
    category: [], area: [], workstream: [], discoveredIn: [],
    needs: [], priority: [], nextAction: [], labels: [],
    since: null, research: null, visibility: null,
  };
}

function matchesAny(values: string[], candidate: string | null): boolean {
  if (values.length === 0) return true;
  return candidate !== null && values.includes(candidate);
}

function matchesAnyOf(values: string[], candidates: string[]): boolean {
  if (values.length === 0) return true;
  return candidates.some((candidate) => values.includes(candidate));
}

export function matchesFilters(entry: IssueEntry, filters: IssueFilters): boolean {
  if (filters.status === "open" && entry.closed) return false;
  if (filters.status === "closed" && !entry.closed) return false;
  if (!matchesAny(filters.category, entry.category)) return false;
  if (!matchesAny(filters.area, entry.area)) return false;
  if (!matchesAny(filters.workstream, entry.workstream)) return false;
  if (!matchesAny(filters.discoveredIn, entry.discoveredInWorkstream)) return false;
  if (!matchesAny(filters.priority, entry.priority)) return false;
  if (!matchesAny(filters.nextAction, entry.nextAction)) return false;
  if (!matchesAnyOf(filters.needs, entry.needs)) return false;
  if (!filters.labels.every((label) => entry.labels.includes(label))) return false;
  if (filters.research !== null && entry.research !== filters.research) return false;
  if (filters.visibility !== null && entry.visibility !== filters.visibility) return false;
  if (filters.since !== null && (entry.date === null || entry.date < filters.since)) return false;
  return true;
}

export function filterIssues(entries: IssueEntry[], filters: IssueFilters): IssueEntry[] {
  return entries.filter((entry) => matchesFilters(entry, filters));
}

// ─── Grouping ────────────────────────────────────────────────────────────────

export const GROUP_KEYS = ["discovered-in", "date", "labels", "area", "workstream", "category"] as const;
export type GroupKey = (typeof GROUP_KEYS)[number];

export interface IssueGroup {
  key: string;
  count: number;
  paths: string[];
}

/**
 * Group values for one entry. Most keys yield at most one value; `labels` yields
 * one per label, so an issue with three labels counts in three groups. Entries
 * with no value for the key are dropped rather than bucketed into a synthetic
 * "none" group — a group of "issues with no area" is not the cluster anyone is
 * looking for when they run `groups`.
 */
function groupValues(entry: IssueEntry, by: GroupKey): string[] {
  switch (by) {
    case "discovered-in": return entry.discoveredInWorkstream === null ? [] : [entry.discoveredInWorkstream];
    case "date": return entry.date === null ? [] : [entry.date];
    case "labels": return entry.labels;
    case "area": return entry.area === null ? [] : [entry.area];
    case "workstream": return [entry.workstream];
    case "category": return [entry.category];
  }
}

export function groupIssues(entries: IssueEntry[], by: GroupKey, min: number): IssueGroup[] {
  const buckets = new Map<string, string[]>();
  for (const entry of entries) {
    for (const value of groupValues(entry, by)) {
      const bucket = buckets.get(value);
      if (bucket) bucket.push(entry.path);
      else buckets.set(value, [entry.path]);
    }
  }
  return [...buckets]
    .map(([key, paths]): IssueGroup => ({ key, count: paths.length, paths }))
    .filter((group) => group.count >= min)
    .toSorted((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}
