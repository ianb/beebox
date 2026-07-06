/**
 * Safety guard for knowledge-audit boxes.
 *
 * `runTest` resets box git state between tests (`git reset --hard` +
 * `git clean -fd`, cwd = boxRoot) to undo the agent's mutations. If boxRoot is
 * inside another repo — e.g. a box dir created by mistake inside the monorepo
 * (`--box test1` resolves relative to cwd → `callback-box/test1`) — those
 * commands hit the *enclosing* repo: the reset discards uncommitted monorepo
 * work, and the box inherits the parent's `CLAUDE.md`. This guard refuses that
 * case before any destructive command runs.
 */

import * as path from "node:path";
import { realpathSync } from "node:fs";
import { execSync } from "node:child_process";
import { getBoxShapeOrLegacyFallback } from "../../lib/box-shape.js";

/** Base for the cases where a box is unsafe to run audits against. */
export class UnsafeAuditBoxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeAuditBoxError";
  }
}

/** boxRoot is missing or isn't a git repository at all. */
export class AuditBoxNotGitRepoError extends UnsafeAuditBoxError {
  readonly boxRoot: string;
  constructor(boxRoot: string) {
    super("Audit box is missing or not a git repository");
    this.name = "AuditBoxNotGitRepoError";
    this.boxRoot = boxRoot;
  }
}

/** boxRoot lives inside another git repo (e.g. the monorepo), not its own. */
export class AuditBoxInsideRepoError extends UnsafeAuditBoxError {
  readonly boxRoot: string;
  readonly enclosingRepo: string;
  constructor(boxRoot: string, enclosingRepo: string) {
    super("Refusing to audit a box nested inside another git repo");
    this.name = "AuditBoxInsideRepoError";
    this.boxRoot = boxRoot;
    this.enclosingRepo = enclosingRepo;
  }
}

/** Human-facing remediation text for an unsafe-box error. */
export function formatUnsafeAuditBox(err: UnsafeAuditBoxError): string {
  if (err instanceof AuditBoxInsideRepoError) {
    return `Refusing to audit ${err.boxRoot}: it lives inside the git repo at ${err.enclosingRepo}, not its own repo. The post-test "git reset --hard" / "git clean -fd" would operate on that repo (e.g. the monorepo — discarding uncommitted work), and the box would inherit the parent's CLAUDE.md. Use a standalone box outside the repo, e.g. ~/src/boxes/test1.`;
  }
  if (err instanceof AuditBoxNotGitRepoError) {
    return `Audit box at ${err.boxRoot} is missing or not a git repository. Audits reset box git state between tests, so the box must be an initialized git repo. Pass --box as an absolute path to a real box, e.g. ~/src/boxes/test1.`;
  }
  return err.message;
}

/**
 * Require boxRoot to be the top level of its own git repo, or throw.
 *
 * A package-layout (shapeVersion 2+) box nests its operational root
 * (`content/`) one level inside the git repo, whose top level is the
 * package root — that's by design (`docs/implemented-plans/boxes-as-packages-v2.md`,
 * "The box repository": one git repo at the repo root, `boxRoot` is
 * `content/`). So the expected top level is the box's `packageRoot`
 * (`boxCodePaths`' predicate), not `boxRoot` itself; a legacy box has
 * `packageRoot === boxRoot`, so this subsumes the old check.
 */
export async function assertStandaloneBox(boxRoot: string): Promise<void> {
  const resolved = path.resolve(boxRoot);
  let toplevel: string;
  try {
    toplevel = execSync("git rev-parse --show-toplevel", { cwd: resolved, encoding: "utf-8" }).trim();
  } catch (_e) {
    throw new AuditBoxNotGitRepoError(resolved);
  }
  const shape = await getBoxShapeOrLegacyFallback(resolved);
  // git returns the real (symlink-resolved) path; realpath the expected root
  // too so a legit box under a symlinked prefix (e.g. macOS /var →
  // /private/var) isn't falsely flagged as nested.
  const expectedRoot = realpathSync(shape.packageRoot);
  if (path.resolve(toplevel) !== expectedRoot) {
    throw new AuditBoxInsideRepoError(realpathSync(resolved), path.resolve(toplevel));
  }
}
