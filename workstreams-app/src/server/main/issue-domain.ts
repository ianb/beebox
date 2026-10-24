import fs from "node:fs/promises";
import path from "node:path";

import { resolveIssuePath } from "./issue-path.js";
import { frontmatterFence } from "../../../../beebox/src/cards/frontmatter.js";
import { markdownTitle } from "../../../../beebox/src/shared/leading-title-heading.js";

export const ISSUE_CATEGORIES = [
  "bugs", "features", "code-quality", "docs-and-chores", "decisions", "exploration", "watch",
] as const;
export type IssueCategory = (typeof ISSUE_CATEGORIES)[number];

export type IssuePriority = "important" | "normal" | "uncategorized" | "backlog";
export type ResearchState = "none" | "awaiting" | "researched";
export type Visibility = "public" | "private";

export interface IssueFrontmatter {
  title: string;
  workstream: string;
  needs: string[];
  labels: string[];
  priority: IssuePriority;
  area?: string;
  filedBy?: string;
  discoveredBy?: string;
  discoveredIn?: string;
  resolution?: string;
  design?: string;
}

export interface IssueRecord {
  relPath: string;
  category: string;
  closed: boolean;
  slug: string;
  frontmatter: IssueFrontmatter;
  /**
   * Frontmatter keys this parser does not know.
   *
   * The schema in `issues/AGENTS.md` is closed, but this parser used to drop
   * anything outside it without a word. Eleven issues were filed carrying a
   * `stories:` list for two months before anyone noticed it reached no tool —
   * not a filter, not a facet, not `--json`. Silence is what let that happen,
   * so unknown keys are reported and callers decide how loudly.
   */
  unknownKeys: string[];
  research: ResearchState;
  visibility: Visibility;
}

function unquote(value: string): string {
  if (value.length >= 2 && value[0] === '"' && value.at(-1) === '"') {
    return value.slice(1, -1).replace(/\\(["\\/nt])/gu, (_match, char: string) =>
      char === "n" ? "\n" : char === "t" ? "\t" : char);
  }
  if (value.length >= 2 && value[0] === "'" && value.at(-1) === "'") {
    return value.slice(1, -1).replaceAll("''", "'");
  }
  return value;
}

export function parseFrontmatter(source: string): {
  data: Record<string, string | string[]>;
  body: string;
} {
  const fence = frontmatterFence(source);
  if (fence === null) return { data: {}, body: source };
  const data: Record<string, string | string[]> = {};
  let blockKey: string | null = null;
  let blockItems: string[] | null = null;
  const flush = (): void => {
    if (blockKey !== null && blockItems !== null) data[blockKey] = blockItems;
    blockKey = null;
    blockItems = null;
  };
  for (const line of source.slice(fence.textStart, fence.textEnd).split("\n")) {
    const listMatch = /^\s*-\s+(.*)$/u.exec(line);
    if (listMatch && blockKey !== null && blockItems !== null) {
      blockItems.push(unquote((listMatch[1] ?? "").trim()));
      continue;
    }
    flush();
    const pair = /^([A-Za-z0-9_-]+):\s*(.*)$/u.exec(line);
    if (!pair) continue;
    const key = pair[1] ?? "";
    const value = (pair[2] ?? "").trim();
    if (!value) {
      blockKey = key;
      blockItems = [];
    } else if (value.startsWith("[") && value.endsWith("]")) {
      const inner = value.slice(1, -1).trim();
      data[key] = inner ? inner.split(",").map((item) => unquote(item.trim())) : [];
    } else {
      data[key] = unquote(value);
    }
  }
  flush();
  return { data, body: source.slice(fence.bodyStart) };
}

function scalar(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function list(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value;
  return typeof value === "string" && value.trim() ? [value.trim()] : [];
}

function researchState(body: string): ResearchState {
  if (/^## Research \(incomplete\)/mu.test(body)) return "awaiting";
  if (/^## Research \(\d{4}-\d{2}-\d{2}\)/mu.test(body)) return "researched";
  return "none";
}

/**
 * Every frontmatter key `issues/AGENTS.md` defines. Adding a field to the schema
 * means adding it here, or it will be reported as unknown on every issue using it.
 */
const KNOWN_FRONTMATTER_KEYS = new Set([
  "title", "workstream", "needs", "design", "area", "labels", "priority",
  "filed-by", "discovered-by", "discovered-in", "resolution",
  // Deferred-only lifecycle metadata. Deferred files are intentionally not
  // returned by listIssues(); the activation script consumes these fields and
  // removes them when it moves the issue into its category directory.
  "activate-on", "category",
]);

export function parseIssueFile(options: {
  relPath: string;
  source: string;
  visibility?: Visibility;
}): IssueRecord {
  const { relPath, source } = options;
  const visibility = options.visibility ?? "public";
  const segments = relPath.split("/");
  const closed = segments[0] === "closed";
  const filename = segments.at(-1) ?? relPath;
  const slug = filename.replace(/\.md$/u, "");
  const { data, body } = parseFrontmatter(source);
  const priorityValue = scalar(data.priority);
  const priority: IssuePriority = priorityValue === "important" || priorityValue === "normal" || priorityValue === "backlog"
    ? priorityValue : "uncategorized";
  const optional = {
    area: scalar(data.area), filedBy: scalar(data["filed-by"]), discoveredBy: scalar(data["discovered-by"]),
    discoveredIn: scalar(data["discovered-in"]), resolution: scalar(data.resolution), design: scalar(data.design),
  };
  return {
    relPath,
    category: closed ? (segments[1] ?? "") : (segments[0] ?? ""),
    closed,
    slug,
    frontmatter: {
      title: scalar(data.title) ?? markdownTitle(body) ?? slug,
      workstream: scalar(data.workstream) ?? "unknown",
      needs: list(data.needs), labels: list(data.labels), priority,
      ...Object.fromEntries(Object.entries(optional).filter((entry) => entry[1] !== undefined)),
    },
    research: researchState(body),
    unknownKeys: Object.keys(data).filter((k) => !KNOWN_FRONTMATTER_KEYS.has(k)).toSorted(),
    visibility,
  };
}

async function markdownFiles(directory: string): Promise<string[]> {
  try {
    return (await fs.readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => entry.name).toSorted();
  } catch (_error) {
    return [];
  }
}

export async function listIssues(root: string, visibility?: Visibility): Promise<IssueRecord[]> {
  const resolvedVisibility = visibility ?? "public";
  const records: IssueRecord[] = [];
  for (const category of ISSUE_CATEGORIES) {
    for (const prefix of [category, `closed/${category}`]) {
      const directory = path.join(root, prefix);
      for (const file of await markdownFiles(directory)) {
        const relPath = `${prefix}/${file}`;
        try {
          records.push(parseIssueFile({
            relPath,
            source: await fs.readFile(await resolveIssuePath(root, relPath), "utf8"),
            visibility: resolvedVisibility,
          }));
        } catch (_error) {
          // An unreadable issue does not take down the queue.
        }
      }
    }
  }
  return records;
}

class UnwritableIssueError extends Error {
  constructor() {
    super("issue has no writable YAML frontmatter");
    this.name = "UnwritableIssueError";
  }
}

/** Where the closing fence line starts, and the file's newline style, so a
 *  key line can be added just before the closing fence. */
function frontmatterEnd(source: string): { end: number; newline: string } {
  const fence = frontmatterFence(source);
  if (fence === null) throw new UnwritableIssueError();
  const newline = source.slice(0, fence.textStart).endsWith("\r\n") ? "\r\n" : "\n";
  const end = fence.textEnd === fence.textStart ? fence.textStart : fence.textEnd + (source[fence.textEnd] === "\r" ? 2 : 1);
  return { end, newline };
}

export function setIssuePriority(source: string, priority: IssuePriority): string {
  const { end, newline } = frontmatterEnd(source);
  const linePattern = /^priority:[^\r\n]*(?:\r?\n)?/mu;
  const frontmatter = source.slice(0, end);
  if (priority === "uncategorized") return `${frontmatter.replace(linePattern, "")}${source.slice(end)}`;
  const line = `priority: ${priority}`;
  return linePattern.test(frontmatter)
    ? `${frontmatter.replace(linePattern, `${line}${newline}`)}${source.slice(end)}`
    : `${frontmatter}${line}${newline}${source.slice(end)}`;
}
