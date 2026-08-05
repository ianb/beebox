import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execa } from "execa";
import { errnoCode, errorMessage } from "../../lib/error-guards.js";
import { getBoxShape } from "../../lib/box-shape.js";
import type { GrowthHistory, GrowthMeasurement, SubtreeCounts } from "./model.js";

const EXCLUDED_ROOT_NAMES = new Set([".git", ".callback-box", "node_modules"]);
const MAX_SUBTREES = 20;
const MAX_PREFIX_SEGMENTS = 3;
const CONNECTOR_ROOTS: readonly string[] = ["box/inbox/email", "store/calendar", "store/drive"];

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

function connectorRootForPath(relativePath: string): string | undefined {
  return CONNECTOR_ROOTS.find(
    (root) => relativePath === root || relativePath.startsWith(`${root}/`),
  );
}

function addSubtree(input: {
  subtrees: Map<string, MutableSubtree>;
  relativePath: string;
  kind: "directory" | "file";
}): void {
  const { subtrees, relativePath, kind } = input;
  const segments = relativePath.split(path.sep);
  const prefixSegments = kind === "file" && segments.length > 1 ? segments.slice(0, -1) : segments;
  const genericPrefix = prefixSegments.slice(0, MAX_PREFIX_SEGMENTS).join("/");
  const prefix = connectorRootForPath(relativePath) ?? genericPrefix;
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
): Promise<Pick<GrowthMeasurement, "counts" | "skippedDirectories" | "largestSubtrees">> {
  let directories = 0;
  let files = 0;
  let skippedDirectories = 0;
  const subtrees = new Map<string, MutableSubtree>();
  const pending = [boxRoot];
  while (pending.length > 0) {
    checkDeadline(deadline);
    const current = pending.pop();
    if (current === undefined) break;
    let dir: Awaited<ReturnType<typeof fs.opendir>>;
    try {
      dir = await fs.opendir(current);
    } catch (error) {
      if (errnoCode(error) === "ENOENT" || errnoCode(error) === "ENOTDIR") {
        skippedDirectories += 1;
        continue;
      }
      throw error;
    }
    for await (const entry of dir) {
      checkDeadline(deadline);
      if (EXCLUDED_ROOT_NAMES.has(entry.name)) continue;
      const absolute = path.join(current, entry.name);
      const relative = path.relative(boxRoot, absolute);
      if (entry.isDirectory()) {
        directories += 1;
        addSubtree({ subtrees, relativePath: relative, kind: "directory" });
        pending.push(absolute);
      } else if (entry.isFile()) {
        files += 1;
        addSubtree({ subtrees, relativePath: relative, kind: "file" });
      } else if (entry.isSymbolicLink()) {
        files += 1;
        addSubtree({ subtrees, relativePath: relative, kind: "file" });
      }
    }
  }
  const rankedSubtrees = [...subtrees.entries()]
    .filter(([, counts]) => counts.directories + counts.files > 0)
    .map(([subtreePath, counts]) => ({ path: subtreePath, ...counts, ...sourceForPath(subtreePath) }))
    .toSorted((a, b) => b.directories + b.files - (a.directories + a.files) || a.path.localeCompare(b.path));
  const connectorSubtrees = rankedSubtrees.filter((item) => item.source === "connector");
  const otherSubtrees = rankedSubtrees.filter((item) => item.source !== "connector");
  const largestSubtrees = [...connectorSubtrees, ...otherSubtrees]
    .slice(0, MAX_SUBTREES)
    .toSorted((a, b) => b.directories + b.files - (a.directories + a.files) || a.path.localeCompare(b.path));
  return { counts: { directories, files }, skippedDirectories, largestSubtrees };
}

function numericField(output: string, name: string): number {
  const line = output.split("\n").find((candidate) => candidate.startsWith(`${name}: `));
  if (line === undefined) throw new GitCountObjectsParseError(name, "missing");
  const value = Number(line.slice(name.length + 2));
  if (!Number.isFinite(value)) throw new GitCountObjectsParseError(name, "invalid");
  return value;
}

function numericOutput(output: string, command: string): number {
  const value = Number(output.trim());
  if (!Number.isFinite(value)) throw new GitCountObjectsParseError(command, "invalid");
  return value;
}

async function measureHistory(boxRoot: string, deadline: number): Promise<GrowthHistory> {
  try {
    checkDeadline(deadline);
    const { packageRoot } = await getBoxShape(boxRoot);
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
      commits: numericOutput(commits.stdout, "rev-list --count HEAD"),
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
  const history = await measureHistory(boxRoot, deadline);
  return { measuredAt: options.now.toISOString(), ...tree, history };
}
