import fs from "node:fs/promises";
import path from "node:path";

import { issueRelPathSchema } from "../shared/documents.js";

export class InvalidIssuePathError extends Error {
  constructor(relPath: string) {
    super(`invalid issue path: ${relPath}`);
    this.name = "InvalidIssuePathError";
  }
}

function assertContained(options: { root: string; target: string; relPath: string }): void {
  const { root, target, relPath } = options;
  const relative = path.relative(root, target);
  if (relative === "" || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
    throw new InvalidIssuePathError(relPath);
  }
}

/** Resolve one existing issue without allowing category, extension, or symlink escape. */
export async function resolveIssuePath(root: string, relPath: string): Promise<string> {
  if (!issueRelPathSchema.safeParse(relPath).success) throw new InvalidIssuePathError(relPath);
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(resolvedRoot, relPath);
  assertContained({ root: resolvedRoot, target: resolvedTarget, relPath });
  if (path.extname(resolvedTarget) !== ".md") throw new InvalidIssuePathError(relPath);

  const [canonicalRoot, canonicalTarget] = await Promise.all([
    fs.realpath(resolvedRoot),
    fs.realpath(resolvedTarget),
  ]);
  assertContained({ root: canonicalRoot, target: canonicalTarget, relPath });
  if (path.relative(canonicalRoot, canonicalTarget) !== path.normalize(relPath)) {
    throw new InvalidIssuePathError(relPath);
  }
  if (path.extname(canonicalTarget) !== ".md") throw new InvalidIssuePathError(relPath);
  if (!(await fs.stat(canonicalTarget)).isFile()) throw new InvalidIssuePathError(relPath);
  return canonicalTarget;
}
