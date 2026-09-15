/** Local recovery objects preserve invalid input without publishing it as a box commit. */
import { randomUUID } from "node:crypto";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { gitAsBoxOwner } from "../lib/box-owner-exec.js";
import { withBoxGitLock } from "../lib/git-lock.js";

export interface MigrationSnapshot {
  ref: string;
  tree: string;
  indexTree: string;
}

function git(boxRoot: string, index?: string) {
  return async (args: string[]): Promise<string> => {
    return gitAsBoxOwner(args, {
      cwd: boxRoot,
      env: {
        ...process.env,
        GIT_LITERAL_PATHSPECS: "1",
        ...(index ? { GIT_INDEX_FILE: index } : {}),
      },
      maxBuffer: 32 * 1024 * 1024,
    });
  };
}

async function withTemporaryIndex<T>(
  boxRoot: string,
  fn: (run: ReturnType<typeof git>) => Promise<T>,
): Promise<T> {
  const run = git(boxRoot);
  const gitDir = (await run(["rev-parse", "--absolute-git-dir"])).trim();
  const directory = await mkdtemp(join(gitDir, "migration-index-"));
  try {
    const index = join(directory, "index");
    const realIndex = resolve(
      boxRoot,
      (await run(["rev-parse", "--git-path", "index"])).trim(),
    );
    await copyFile(realIndex, index);
    return await fn(git(boxRoot, index));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** Requires the caller's maintenance admission; never holds a Git lock across migration work. */
export async function captureMigrationSnapshot(
  boxRoot: string,
  name: string,
): Promise<MigrationSnapshot> {
  return withBoxGitLock(boxRoot, () =>
    withTemporaryIndex(boxRoot, async (run) => {
      const ref = `refs/bbx/migrations/${name}/snapshots/${randomUUID()}`;
      await run(["check-ref-format", ref]);
      const head = (await run(["rev-parse", "--verify", "HEAD"])).trim();
      // write-tree refuses an unresolved index instead of silently selecting a merge side.
      const indexTree = (await run(["write-tree"])).trim();
      const indexCommit = (
        await run([
          "commit-tree",
          indexTree,
          "-p",
          head,
          "-m",
          "Migration recovery: staged input",
        ])
      ).trim();
      await run(["add", "-A"]);
      const tree = (await run(["write-tree"])).trim();
      const tip = (
        await run([
          "commit-tree",
          tree,
          "-p",
          head,
          "-p",
          indexCommit,
          "-m",
          "Migration recovery: pre-attempt working input",
        ])
      ).trim();
      await run(["update-ref", ref, tip]);
      return { ref, tree, indexTree };
    }),
  );
}

/** Compare working images, not HEAD, so pre-existing edits do not become migration output. */
export async function changedMigrationPaths(
  boxRoot: string,
  snapshot: MigrationSnapshot,
): Promise<string[]> {
  return withBoxGitLock(boxRoot, () =>
    withTemporaryIndex(boxRoot, async (run) => {
      await run(["read-tree", snapshot.tree]);
      await run(["add", "-A"]);
      const tree = (await run(["write-tree"])).trim();
      return (
        await run([
          "diff-tree",
          "--no-commit-id",
          "--name-only",
          "--no-renames",
          "-r",
          "-z",
          snapshot.tree,
          tree,
        ])
      )
        .split("\0")
        .filter(Boolean);
    }),
  );
}

/** Restore attempted staging exactly; leave migrated working files available for repair. */
export async function restoreMigrationIndex(
  boxRoot: string,
  options: { snapshot: MigrationSnapshot; paths: string[] },
): Promise<void> {
  if (options.paths.length === 0) return;
  await withBoxGitLock(boxRoot, async () => {
    await git(boxRoot)([
      "reset",
      "--quiet",
      options.snapshot.indexTree,
      "--",
      ...options.paths,
    ]);
  });
}

/** Keep failed output in the next commit even when an idempotent retry changes nothing. */
export async function migrationOutputBaseline(boxRoot: string, attempt: MigrationSnapshot): Promise<MigrationSnapshot> {
  return withBoxGitLock(boxRoot, async () => {
    const run = git(boxRoot);
    const pending = `${attempt.ref.split("/snapshots/")[0]}/pending`;
    const ref = (await run(["for-each-ref", "--format=%(objectname)", pending])).trim();
    if (!ref) {
      await run(["update-ref", pending, attempt.ref]);
      return attempt;
    }
    return { ref, tree: (await run(["rev-parse", `${ref}^{tree}`])).trim(),
      indexTree: (await run(["rev-parse", `${ref}^2^{tree}`])).trim() };
  });
}

export async function finishMigrationOutput(boxRoot: string, attempt: MigrationSnapshot): Promise<void> {
  await withBoxGitLock(boxRoot, () => git(boxRoot)(["update-ref", "-d", `${attempt.ref.split("/snapshots/")[0]}/pending`]));
}
