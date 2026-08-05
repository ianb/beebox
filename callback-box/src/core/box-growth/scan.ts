import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execa } from "execa";
import { errorMessage } from "../../lib/error-guards.js";
import { getBoxShape } from "../../lib/box-shape.js";
import type { GrowthHistory, GrowthMeasurement, SubtreeCounts } from "./model.js";

const EXCLUDED_ROOT_NAMES = new Set([".git", ".callback-box", "node_modules"]);
const MAX_SUBTREES = 20;
const MAX_PREFIX_SEGMENTS = 3;

interface MutableSubtree {
  directories: number;
  files: number;
}

class BoxGrowthDeadlineError extends Error {
  constructor() {
    super("Box growth scan exceeded its time budget");
    this.name = "BoxGrowthDeadlineError";
  }
}

class GitCountObjectsParseError extends Error {
  constructor(field: string, reason: "missing" | "invalid") {
    super(`git count-objects returned ${reason} field: ${field}`);
    this.name = "GitCountObjectsParseError";
  }
}

function sourceForPath(relativePath: string): Pick<SubtreeCounts, "source" | "sourceLabel"> {
  if (relativePath === "box/inbox/email" || relativePath.startsWith("box/inbox/email/")) {
    return { source: "connector", sourceLabel: "Gmail" };
  }
  if (relativePath === "store/calendar" || relativePath.startsWith("store/calendar/")) {
    return { source: "connector", sourceLabel: "Google Calendar" };
  }
  if (relativePath === "store/drive" || relativePath.startsWith("store/drive/")) {
    return { source: "connector", sourceLabel: "Google Drive" };
  }
  if (relativePath.startsWith("store/chat/")) return { source: "chat", sourceLabel: null };
  if (["tmp-capture", "tmp-upload", "captures"].some((name) => relativePath === name || relativePath.startsWith(`${name}/`))) {
    return { source: "user-input", sourceLabel: null };
  }
  if (
    relativePath === "procedure/runs" ||
    relativePath.startsWith("procedure/runs/") ||
    relativePath === "generated" ||
    relativePath.startsWith("generated/") ||
    relativePath === "runtime" ||
    relativePath.startsWith("runtime/")
  ) {
    return { source: "automation", sourceLabel: null };
  }
  return { source: "unknown", sourceLabel: null };
}

function addSubtree(input: {
  subtrees: Map<string, MutableSubtree>;
  relativePath: string;
  kind: "directory" | "file";
}): void {
  const { subtrees, relativePath, kind } = input;
  const segments = relativePath.split(path.sep);
  const prefixSegments = kind === "file" && segments.length > 1 ? segments.slice(0, -1) : segments;
  const prefix = prefixSegments.slice(0, MAX_PREFIX_SEGMENTS).join("/");
  const counts = subtrees.get(prefix) ?? { directories: 0, files: 0 };
  counts[kind === "directory" ? "directories" : "files"] += 1;
  subtrees.set(prefix, counts);
}

function checkDeadline(deadline: number): void {
  if (Date.now() >= deadline) throw new BoxGrowthDeadlineError();
}

async function scanTree(
  boxRoot: string,
  deadline: number,
): Promise<Pick<GrowthMeasurement, "counts" | "largestSubtrees">> {
  let directories = 0;
  let files = 0;
  const subtrees = new Map<string, MutableSubtree>();
  const pending = [boxRoot];
  while (pending.length > 0) {
    checkDeadline(deadline);
    const current = pending.pop();
    if (current === undefined) break;
    const dir = await fs.opendir(current);
    for await (const entry of dir) {
      checkDeadline(deadline);
      const absolute = path.join(current, entry.name);
      const relative = path.relative(boxRoot, absolute);
      const rootName = relative.split(path.sep).at(0) ?? "";
      if (EXCLUDED_ROOT_NAMES.has(rootName)) continue;
      if (entry.isDirectory()) {
        directories += 1;
        addSubtree({ subtrees, relativePath: relative, kind: "directory" });
        pending.push(absolute);
      } else if (entry.isFile()) {
        files += 1;
        addSubtree({ subtrees, relativePath: relative, kind: "file" });
      }
    }
  }
  const largestSubtrees = [...subtrees.entries()]
    .filter(([, counts]) => counts.directories + counts.files > 0)
    .map(([subtreePath, counts]) => ({ path: subtreePath, ...counts, ...sourceForPath(subtreePath) }))
    .toSorted((a, b) => b.directories + b.files - (a.directories + a.files) || a.path.localeCompare(b.path))
    .slice(0, MAX_SUBTREES);
  return { counts: { directories, files }, largestSubtrees };
}

function numericField(output: string, name: string): number {
  const line = output.split("\n").find((candidate) => candidate.startsWith(`${name}: `));
  if (line === undefined) throw new GitCountObjectsParseError(name, "missing");
  const value = Number(line.slice(name.length + 2));
  if (!Number.isFinite(value)) throw new GitCountObjectsParseError(name, "invalid");
  return value;
}

async function measureHistory(packageRoot: string, deadline: number): Promise<GrowthHistory> {
  try {
    checkDeadline(deadline);
    const timeout = Math.max(1, deadline - Date.now());
    const [head, commits, objects] = await Promise.all([
      execa("git", ["rev-parse", "HEAD"], { cwd: packageRoot, timeout }),
      execa("git", ["rev-list", "--count", "HEAD"], { cwd: packageRoot, timeout }),
      execa("git", ["count-objects", "-v"], { cwd: packageRoot, timeout }),
    ]);
    const looseObjects = numericField(objects.stdout, "count");
    const packedObjects = numericField(objects.stdout, "in-pack");
    const looseKiB = numericField(objects.stdout, "size");
    const packedKiB = numericField(objects.stdout, "size-pack");
    return {
      status: "available",
      gitHead: head.stdout.trim(),
      commits: Number(commits.stdout.trim()),
      gitObjects: looseObjects + packedObjects,
      gitBytes: (looseKiB + packedKiB) * 1024,
    };
  } catch (error) {
    return { status: "unavailable", error: errorMessage(error) };
  }
}

export async function scanBoxGrowth(
  boxRoot: string,
  options: { now: Date; maxDurationMs: number },
): Promise<GrowthMeasurement> {
  const deadline = Date.now() + options.maxDurationMs;
  const tree = await scanTree(boxRoot, deadline);
  const { packageRoot } = await getBoxShape(boxRoot);
  const history = await measureHistory(packageRoot, deadline);
  return { measuredAt: options.now.toISOString(), ...tree, history };
}
