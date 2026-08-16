import { spawn } from "node:child_process";
import { once } from "node:events";
import * as path from "node:path";
import { execa } from "execa";
import { errorMessage } from "../../lib/error-guards.js";
import { getBoxShape } from "../../lib/box-shape.js";
import type { GrowthHistory, GrowthMeasurement, SubtreeCounts } from "./model.js";

const MAX_SUBTREES = 20;
const MAX_PREFIX_SEGMENTS = 3;
const MAX_FIND_ERROR_BYTES = 8_192;
const CONNECTOR_ROOTS: readonly string[] = ["box/inbox/email", "store/calendar", "store/drive"];

interface MutableSubtree {
  directories: number;
  files: number;
}

interface TreeAccumulator {
  directories: number;
  files: number;
  subtrees: Map<string, MutableSubtree>;
}

type FindBuffer = Buffer<ArrayBufferLike>;

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

class FindEntryKindError extends Error {
  constructor(detail: string) {
    super(`find returned invalid entry kind: ${detail}`);
    this.name = "FindEntryKindError";
  }
}

class FindIncompleteEntryError extends Error {
  constructor() {
    super("find returned an incomplete entry");
    this.name = "FindIncompleteEntryError";
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

function findArguments(boxRoot: string): string[] {
  return [
    boxRoot,
    "(", "-name", ".git", "-o", "-name", ".callback-box", "-o", "-name", "node_modules", ")",
    "-prune", "-o",
    "(", "-type", "d", "-exec", "printf", "d\\000%s\\000", "{}", "+", ")", "-o",
    "(", "(", "-type", "f", "-o", "-type", "l", ")",
    "-exec", "printf", "f\\000%s\\000", "{}", "+", ")",
  ];
}

function recordFindEntry(input: {
  accumulator: TreeAccumulator;
  boxRoot: string;
  kind: "d" | "f";
  absolutePath: string;
}): void {
  const { accumulator, boxRoot, kind, absolutePath } = input;
  const relativePath = path.relative(boxRoot, absolutePath);
  if (relativePath.length === 0) return;
  if (kind === "d") accumulator.directories += 1;
  else accumulator.files += 1;
  addSubtree({
    subtrees: accumulator.subtrees,
    relativePath,
    kind: kind === "d" ? "directory" : "file",
  });
}

function consumeFindTokens(input: {
  accumulator: TreeAccumulator;
  boxRoot: string;
  chunk: FindBuffer;
  buffered: FindBuffer;
  pendingKind: "d" | "f" | null;
}): { buffered: FindBuffer; pendingKind: "d" | "f" | null } {
  const { accumulator, boxRoot, chunk } = input;
  let { buffered, pendingKind } = input;
  buffered = Buffer.concat([buffered, chunk]);
  let separator = buffered.indexOf(0);
  while (separator >= 0) {
    const token = buffered.subarray(0, separator).toString();
    buffered = buffered.subarray(separator + 1);
    if (pendingKind === null) {
      if (token !== "d" && token !== "f") throw new FindEntryKindError(token);
      pendingKind = token;
    } else {
      recordFindEntry({ accumulator, boxRoot, kind: pendingKind, absolutePath: token });
      pendingKind = null;
    }
    separator = buffered.indexOf(0);
  }
  return { buffered, pendingKind };
}

function rankedSubtrees(subtrees: Map<string, MutableSubtree>): SubtreeCounts[] {
  const ranked = [...subtrees.entries()]
    .filter(([, counts]) => counts.directories + counts.files > 0)
    .map(([subtreePath, counts]) => ({ path: subtreePath, ...counts, ...sourceForPath(subtreePath) }))
    .toSorted((a, b) => b.directories + b.files - (a.directories + a.files) || a.path.localeCompare(b.path));
  const connectorSubtrees = ranked.filter((item) => item.source === "connector");
  const otherSubtrees = ranked.filter((item) => item.source !== "connector");
  return [...connectorSubtrees, ...otherSubtrees]
    .slice(0, MAX_SUBTREES)
    .toSorted((a, b) => b.directories + b.files - (a.directories + a.files) || a.path.localeCompare(b.path));
}

async function scanTree(
  boxRoot: string,
  options: { deadline: number; findCommand: string },
): Promise<Pick<GrowthMeasurement, "complete" | "filesystemError" | "counts" | "skippedDirectories" | "largestSubtrees">> {
  const accumulator: TreeAccumulator = { directories: 0, files: 0, subtrees: new Map() };
  const child = spawn(options.findCommand, findArguments(boxRoot), { stdio: ["ignore", "pipe", "pipe"] });
  const deadlineState = { timedOut: false };
  const timer = setTimeout(() => {
    deadlineState.timedOut = true;
    child.kill("SIGTERM");
  }, Math.max(0, options.deadline - Date.now()));
  const closePromise = once(child, "close");
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    if (stderr.length < MAX_FIND_ERROR_BYTES) stderr += chunk.slice(0, MAX_FIND_ERROR_BYTES - stderr.length);
  });
  let parser: { buffered: FindBuffer; pendingKind: "d" | "f" | null } = {
    buffered: Buffer.alloc(0),
    pendingKind: null,
  };
  try {
    for await (const rawChunk of child.stdout) {
      const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
      parser = consumeFindTokens({ accumulator, boxRoot, chunk, ...parser });
    }
    await closePromise;
    stderr = stderr.trim();
    if (!deadlineState.timedOut && (parser.buffered.length > 0 || parser.pendingKind !== null)) {
      throw new FindIncompleteEntryError();
    }
    const filesystemError = deadlineState.timedOut
      ? "Box growth scan exceeded its time budget"
      : child.exitCode === 0 ? null : stderr.length === 0 ? "find failed" : `find failed: ${stderr}`;
    return {
      complete: filesystemError === null,
      filesystemError,
      counts: { directories: accumulator.directories, files: accumulator.files },
      skippedDirectories: 0,
      largestSubtrees: rankedSubtrees(accumulator.subtrees),
    };
  } finally {
    clearTimeout(timer);
  }
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
  options: { now: Date; maxDurationMs: number; findCommand?: string },
): Promise<GrowthMeasurement> {
  const deadline = Date.now() + options.maxDurationMs;
  const tree = await scanTree(boxRoot, { deadline, findCommand: options.findCommand ?? "find" });
  const history = tree.complete
    ? await measureHistory(boxRoot, deadline)
    : { status: "unavailable" as const, error: "Git history was not measured because the filesystem scan was incomplete" };
  return { measuredAt: options.now.toISOString(), ...tree, history };
}
