/** Prepare one agent-authored publication for the server-owned publisher. */

import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { errorMessage } from "../lib/error-guards.js";
import { withFileLock } from "../lib/file-lock.js";
import { parsePublicationName, readPublicationDefinition, publicationSourcePath, type PublicationDefinition } from "./publication-definition.js";
import { prepareProject } from "./prepare-project.js";
import { BundlePolicyError, ProjectCommandError } from "./prepare-errors.js";
import { collectPublicationFiles, stagePublicationFiles } from "./prepare-files.js";
import { PUBLICATION_COMMAND_TIMEOUT_MS, type PrepareDeps, type PrepareResult } from "./prepare-types.js";

export { PUBLICATION_FILE_LIMITS } from "./prepare-files.js";
export { PUBLICATION_COMMAND_TIMEOUT_MS } from "./prepare-types.js";
export type { PrepareDeps, PrepareFailure, PrepareResult, PreparedPublication, ProjectCommandRequest, RunProjectCommand } from "./prepare-types.js";

/** Build/collect, scan, and stage files; no Cloudflare authority is resolved here. */
export async function preparePublication(
  args: { boxRoot: string; name: string },
  deps: PrepareDeps,
): Promise<PrepareResult> {
  let name: string;
  try {
    name = parsePublicationName(args.name);
  } catch (error) {
    return { ok: false, reason: "invalid-definition", message: errorMessage(error) };
  }
  const lockDir = path.join(args.boxRoot, ".beebox", "publish-prepare-locks");
  try {
    await mkdir(lockDir, { recursive: true });
    return await withFileLock({
      lockPath: path.join(lockDir, `${name}.lock`),
      metadata: { purpose: "publication-local-prepare", name },
      waitMs: PUBLICATION_COMMAND_TIMEOUT_MS * 2 + 20_000,
    }, () => preparePublicationUnlocked({ ...args, name }, deps));
  } catch (error) {
    return { ok: false, reason: "invalid-source", message: errorMessage(error) };
  }
}

/** Local source/build lock; released before the caller mutates remote serving state. */
async function preparePublicationUnlocked(
  args: { boxRoot: string; name: string },
  deps: PrepareDeps,
): Promise<PrepareResult> {
  let definition: PublicationDefinition;
  try {
    definition = await readPublicationDefinition(args);
  } catch (error) {
    return { ok: false, reason: "invalid-definition", message: errorMessage(error) };
  }

  let taskRoot: string | null = null;
  try {
    taskRoot = await mkdtemp(path.join(os.tmpdir(), "bbx-publish-prepare-"));
    const sourceRoot = publicationSourcePath({ boxRoot: args.boxRoot, name: args.name, content: definition.content });
    if (definition.content === "project") await prepareProject({ projectRoot: sourceRoot, taskRoot, deps });
    const outputRoot = definition.content === "static" ? sourceRoot : path.join(sourceRoot, "dist");
    const { output, collected } = await collectPublicationFiles({ root: outputRoot, definition, ownerEmail: deps.ownerEmail });
    const stagedDir = path.join(taskRoot, "release");
    await stagePublicationFiles(output, stagedDir);
    const ownedTaskRoot = taskRoot;
    return {
      ok: true,
      prepared: {
        definition,
        pubId: definition.pubId,
        contentHash: collected.contentHash,
        stagedDir,
        files: collected.files,
        preview: collected.preview,
        scan: collected.scan,
        cleanup: async () => rm(ownedTaskRoot, { recursive: true, force: true }),
      },
    };
  } catch (error) {
    if (taskRoot !== null) await rm(taskRoot, { recursive: true, force: true });
    if (error instanceof BundlePolicyError) {
      return {
        ok: false,
        reason: "bundle-policy",
        message: error.message,
        ...(error.observed !== undefined ? { observed: error.observed } : {}),
        ...(error.limit !== undefined ? { limit: error.limit } : {}),
      };
    }
    if (error instanceof ProjectCommandError) {
      return { ok: false, reason: "project-command-failed", step: error.step, timedOut: error.timedOut, message: error.message };
    }
    return { ok: false, reason: "invalid-source", message: errorMessage(error) };
  }
}
