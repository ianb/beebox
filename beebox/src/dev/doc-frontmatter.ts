import path from "node:path";
import { parse as parseYaml } from "yaml";

const PLAN_RE = /^beebox\/docs\/(plans|implemented-plans|unimplemented-plans)\/([^/]+\.md)$/;
const ISSUE_CATEGORIES = ["bugs", "features", "code-quality", "docs-and-chores", "decisions", "exploration", "watch"] as const;
const ISSUE_CATEGORY_SET = new Set<string>(ISSUE_CATEGORIES);
const ISSUE_RE = /^issues\/(closed\/)?(?:bugs|features|code-quality|docs-and-chores|decisions|exploration|watch)\/[^/]+\.md$/;
const DEFERRED_ISSUE_RE = /^issues\/deferred\/[^/]+\.md$/;
const PLAN_STATUSES = new Set(["draft", "active", "partial", "implemented", "superseded", "parked"]);
const NEEDS = new Set(["design", "decision", "manual-testing"]);
const RESOLUTIONS = new Set(["implemented", "wontfix", "superseded"]);
const PRIORITIES = new Set(["important", "normal", "backlog"]);
const WORKSTREAM_RE = /^[\w-]+$/;

export interface FrontmatterDocument {
  data: Record<string, unknown>;
  body: string;
  lines: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function splitFrontmatter(source: string): FrontmatterDocument | null {
  if (!source.startsWith("---\n")) return null;
  const end = source.indexOf("\n---", 4);
  if (end === -1) return null;
  const yaml = source.slice(4, end);
  const parsed: unknown = parseYaml(yaml);
  if (!isRecord(parsed)) return null;
  return { data: parsed, body: source.slice(end + 4).replace(/^\n/, ""), lines: yaml.split("\n").length + 2 };
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function calendarDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function pathProblem(params: { rel: string; key: string; value: unknown; exists: (rel: string) => boolean }): string[] {
  const { rel, key, value, exists } = params;
  if (typeof value !== "string" || value.length === 0) return [`${rel}: frontmatter ${key} must be a non-empty path`];
  const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), value));
  return exists(target) ? [] : [`${rel}: frontmatter ${key} does not resolve: ${value}`];
}

function planProblems(params: {
  rel: string; dir: string; data: Record<string, unknown>; exists: (rel: string) => boolean;
}): string[] {
  const { rel, dir, data, exists } = params;
  const out: string[] = [];
  const status = data.status;
  if (typeof status !== "string" || !PLAN_STATUSES.has(status)) out.push(`${rel}: invalid plan status`);
  if (!strings(data.issues)) out.push(`${rel}: frontmatter issues must be a list`);
  else for (const value of data.issues) out.push(...pathProblem({ rel, key: "issues", value, exists }));
  if (data["superseded-by"] !== undefined) {
    if (status !== "superseded") out.push(`${rel}: superseded-by is allowed only with status superseded`);
    out.push(...pathProblem({ rel, key: "superseded-by", value: data["superseded-by"], exists }));
  }
  if (dir === "implemented-plans" && status !== "implemented") out.push(`${rel}: implemented-plans requires status implemented`);
  if (dir === "unimplemented-plans" && status !== "superseded" && status !== "parked") out.push(`${rel}: unimplemented-plans requires status superseded or parked`);
  return out;
}

function issueProblems(params: {
  rel: string; closed: boolean; deferred: boolean; data: Record<string, unknown>; body: string; exists: (rel: string) => boolean;
}): string[] {
  const { rel, closed, deferred, data, body, exists } = params;
  const out: string[] = [];
  if (data.needs !== undefined && (!strings(data.needs) || data.needs.some((need) => !NEEDS.has(need)))) out.push(`${rel}: invalid needs list`);
  if (data.labels !== undefined && (!strings(data.labels) || data.labels.some((label) => !/^[\da-z]+(?:-[\da-z]+)*$/.test(label)))) out.push(`${rel}: invalid labels list`);
  if (data.priority !== undefined && (typeof data.priority !== "string" || !PRIORITIES.has(data.priority))) out.push(`${rel}: priority must be important, normal, or backlog`);
  if (data.design !== undefined) out.push(...pathProblem({ rel, key: "design", value: data.design, exists }));
  if (strings(data.needs) && data.needs.includes("manual-testing") && !/^## Manual testing$/m.test(body)) {
    out.push(`${rel}: needs manual-testing requires a ## Manual testing section`);
  }
  const resolution = data.resolution;
  if (closed && (typeof resolution !== "string" || !RESOLUTIONS.has(resolution))) out.push(`${rel}: closed issues require a valid resolution`);
  if (!closed && resolution !== undefined) out.push(`${rel}: open issues must not have resolution`);
  const activateOn = data["activate-on"];
  const category = data.category;
  if (deferred) {
    if (!calendarDate(activateOn)) {
      out.push(`${rel}: deferred issues require activate-on as a valid YYYY-MM-DD date`);
    }
    if (typeof category !== "string" || !ISSUE_CATEGORY_SET.has(category)) {
      out.push(`${rel}: deferred issues require a valid category`);
    }
  } else {
    if (activateOn !== undefined) out.push(`${rel}: activate-on is allowed only on deferred issues`);
    if (category !== undefined) out.push(`${rel}: category is allowed only on deferred issues`);
  }
  return out;
}

function commonProblems(rel: string, data: Record<string, unknown>): string[] {
  const out: string[] = [];
  if (typeof data.title !== "string" || data.title.length === 0) out.push(`${rel}: frontmatter title is required`);
  if (typeof data.workstream !== "string" || !WORKSTREAM_RE.test(data.workstream)) {
    out.push(`${rel}: frontmatter workstream must be a bare name, unattached, or unknown`);
  }
  return out;
}

export function frontmatterProblems(params: {
  rel: string;
  source: string;
  exists: (rel: string) => boolean;
}): string[] {
  const { rel, source, exists } = params;
  const plan = PLAN_RE.exec(rel);
  const issue = ISSUE_RE.exec(rel);
  const deferred = DEFERRED_ISSUE_RE.test(rel);
  if (!plan && !issue && !deferred) return [];
  if (plan && (plan[2] === "README.md" || plan[2]?.endsWith(".review.md"))) return [];
  let parsed: FrontmatterDocument | null;
  try {
    parsed = splitFrontmatter(source);
  } catch (error) {
    return [`${rel}: invalid YAML frontmatter: ${error instanceof Error ? error.message : String(error)}`];
  }
  if (!parsed) return [`${rel}: YAML frontmatter is required`];
  const { data } = parsed;
  return [
    ...commonProblems(rel, data),
    ...(plan
      ? planProblems({ rel, dir: plan[1] ?? "", data, exists })
      : issueProblems({ rel, closed: issue?.[1] !== undefined, deferred, data, body: parsed.body, exists })),
  ];
}
