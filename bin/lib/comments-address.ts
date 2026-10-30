/**
 * How `bin/comments` turns what the caller typed into store subjects: a path in
 * any spelling (absolute, repository-relative, cwd-relative) into its tracked
 * and worktree namespaces, or an exhibit address `exhibit:<workstream>/<name>`
 * into the one exhibit subject. Split from bin/comments.ts so the CLI file
 * stays the command dispatch.
 */

import * as path from "node:path";
import { execa } from "execa";

import type { Subject } from "./comments-store.js";
import { isWithin } from "../../beebox/src/lib/box-containment.js";

/** Where the repository is, and which worktree we are standing in. */
export interface Context {
  repoRoot: string;
  mainRoot: string;
  worktree: string;
}

/**
 * `git rev-parse --show-toplevel` gives this checkout; `--path-format=absolute
 * --git-common-dir` gives the shared `.git`, whose parent is the MAIN checkout
 * even from inside a worktree. The store hangs off main, so both are needed.
 */
export async function resolveContext(): Promise<Context> {
  const { stdout: top } = await execa("git", ["rev-parse", "--show-toplevel"]);
  const { stdout: common } = await execa("git", [
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
  ]);
  const repoRoot = top.trim();
  const mainRoot = path.dirname(common.trim());
  return { repoRoot, mainRoot, worktree: path.basename(repoRoot) };
}

/** Is this path tracked by git? Decides which namespace holds its comments. */
async function isTracked(repoRoot: string, relPath: string): Promise<boolean> {
  const result = await execa("git", ["ls-files", "--error-unmatch", "--", relPath], {
    cwd: repoRoot,
    reject: false,
  });
  return result.exitCode === 0;
}

/**
 * Accept a path in any spelling the developer or agent has to hand — absolute,
 * repository-relative, or relative to the current directory. Refusing a
 * plausible spelling is the kind of friction that stops a tool being used.
 */
function toRepoRelative(context: Context, input: string): string {
  const absolute = path.isAbsolute(input) ? input : path.resolve(process.cwd(), input);
  const relative = path.relative(context.repoRoot, absolute);
  if (relative === "" || !isWithin(context.repoRoot, absolute)) {
    // Not under this checkout; treat it as already repository-relative.
    return path.normalize(input);
  }
  return relative;
}

class InvalidExhibitAddressError extends Error {
  constructor(input: string) {
    super(`'${input}' is not an exhibit address; the form is exhibit:<workstream>/<name>`);
    this.name = "InvalidExhibitAddressError";
  }
}

/**
 * `exhibit:<workstream>/<name>` names an exhibit page rather than a file. The
 * segments are checked by the store, so this only has to split them — but a
 * string that claims the prefix and does not split is refused, not quietly
 * treated as a file called `exhibit:…`.
 */
function parseExhibitAddress(input: string): { workstream: string; exhibit: string } | null {
  if (!input.startsWith("exhibit:")) return null;
  const match = /^exhibit:([^/]+)\/([^/]+)$/u.exec(input);
  const workstream = match?.[1];
  const exhibit = match?.[2];
  if (workstream === undefined || exhibit === undefined) throw new InvalidExhibitAddressError(input);
  return { workstream, exhibit };
}

/**
 * BOTH namespaces a path could hold comments in, current-status-first — or the
 * one exhibit subject, when the target is an exhibit address.
 *
 * `worktree` names the UNTRACKED namespace. It defaults to the checkout this
 * CLI is running in, which is right for an agent at a terminal — but the app
 * runs from the MAIN checkout while the developer reads another workstream's
 * file through a lens, so it passes the lens explicitly. Without that, a
 * comment on `scratch/foo.md` viewed as `dev-comments` would be filed under
 * `worktree/main/` and the agent in `dev-comments` would never see it.
 *
 * Tracked status is not stable: a `scratch/notes.md` commented while untracked
 * and later committed would, if we consulted only its CURRENT namespace, report
 * "no comments" for remarks sitting on disk — and `clear` could not reach them
 * by path. So every read and every clear considers both, and the ordering only
 * decides which one a NEW comment would be written to.
 */
export async function subjectsFor(
  context: Context,
  target: { path: string; worktree?: string | undefined },
): Promise<Subject[]> {
  const exhibit = parseExhibitAddress(target.path);
  if (exhibit !== null) return [{ scope: "exhibit", ...exhibit }];
  const relPath = toRepoRelative(context, target.path);
  const worktree = target.worktree === undefined || target.worktree === ""
    ? context.worktree
    : target.worktree;
  const tracked: Subject = { scope: "tracked", relPath };
  const local: Subject = { scope: "worktree", worktree, relPath };
  return (await isTracked(context.repoRoot, relPath)) ? [tracked, local] : [local, tracked];
}

export function describeSubject(subject: Subject | null, storePath: string): string {
  if (subject === null) return `${storePath} (unreadable entry)`;
  if (subject.scope === "exhibit") return `exhibit:${subject.workstream}/${subject.exhibit}`;
  return subject.scope === "tracked" ? subject.relPath : `${subject.relPath} (${subject.worktree})`;
}
