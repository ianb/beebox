/** Refresh under the same admission boundary as migrations, preserving dirty input in Git. */
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { simpleGit } from "simple-git";
import { stageAndCommitPaths } from "../lib/git.js";
import { acquireBoxMaintenance } from "../lib/box-maintenance.js";
import { getBoxShape } from "../lib/box-shape.js";
import { errnoCode, errorMessage } from "../lib/error-guards.js";
import {
  generateDocs,
  generatedDocsAreCurrent,
  GENERATE_MARKER,
} from "./docs-gen/index.js";
import { ensureEngineDocs } from "./docs-gen/box-docs.js";
import {
  captureMigrationSnapshot,
  changedMigrationPaths,
  restoreMigrationIndex,
  migrationOutputBaseline,
  finishMigrationOutput,
} from "./migration-recovery.js";

export interface DocsRefreshResult { readonly status: "current" | "refreshed" }
class DocsRefreshError extends Error {
  constructor(ref: string, cause: unknown) {
    super(`Docs refresh failed: ${errorMessage(cause)}. Recovery: ${ref}; restore selected input with git restore --source=${ref} -- path/to/file`, { cause });
    this.name = "DocsRefreshError";
  }
}

const PENDING_REF = "refs/bbx/migrations/docs-refresh/pending";

async function readMarker(boxRoot: string): Promise<string | null> {
  try {
    return await readFile(join(boxRoot, GENERATE_MARKER), "utf8");
  } catch (error) {
    if (errnoCode(error) === "ENOENT") return null;
    throw error;
  }
}

/** Retain the original baseline across a rejected commit: its output is still ours on retry. */
async function refreshSnapshot(boxRoot: string) {
  const pending = (await simpleGit(boxRoot).raw(["for-each-ref", "--format=%(objectname)", PENDING_REF])).trim();
  if (!pending && await generatedDocsAreCurrent(boxRoot)) return null;
  const snapshot = await captureMigrationSnapshot(boxRoot, "docs-refresh");
  return { snapshot, baseline: await migrationOutputBaseline(boxRoot, snapshot) };
}

export async function refreshGeneratedDocs(opts: {
  boxRoot: string;
  withinMaintenance?: boolean;
  recover?: boolean;
}): Promise<DocsRefreshResult> {
  const shape = await getBoxShape(opts.boxRoot);
  await ensureEngineDocs();
  const maintenance = await acquireBoxMaintenance(shape.boxRoot, {
    reason: "docs refresh",
    join: opts.withinMaintenance === true,
    recover: opts.recover === true,
  });
  try {
    const result = await maintenance.run(
      async (): Promise<DocsRefreshResult> => {
        const before = await readMarker(opts.boxRoot);
        const input = await refreshSnapshot(shape.boxRoot);
        if (!input) return { status: "current" };
        const { snapshot, baseline } = input;
        let paths: string[] = [];
        await maintenance.beginChanges();
        try {
          await generateDocs(opts.boxRoot, { commit: false });
          paths = await changedMigrationPaths(shape.boxRoot, baseline);
          await stageAndCommitPaths(shape.boxRoot, {
            paths,
            message: "Refresh generated docs",
            trailers: {
              "Created-By": "docs-refresh",
              "Migration-Recovery": snapshot.ref,
            },
          });
          await finishMigrationOutput(shape.boxRoot, snapshot);
        } catch (error) {
          await rm(join(opts.boxRoot, GENERATE_MARKER), { force: true });
          await restoreMigrationIndex(shape.boxRoot, { snapshot, paths });
          throw new DocsRefreshError(snapshot.ref, error);
        }
        return {
          status:
            (await readMarker(opts.boxRoot)) === before
              ? "current"
              : "refreshed",
        };
      },
    );
    await maintenance.complete();
    return result;
  } finally {
    await maintenance.release();
  }
}
