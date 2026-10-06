/** Prepare one agent-authored publication for the server-owned publisher. */

import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { errorMessage } from "../../../shared/error-guards.js";
import { withFileLock } from "../../../lib/file-lock.js";
import type { PublicationDefinition } from "../../publication-definition.js";
import { PublicationCardSourceError, readPublicationCardSource, resolvePublicationCardPath } from "../card-source.js";
import { prepareProject } from "./project.js";
import { BundlePolicyError, ProjectCommandError } from "./errors.js";
import { collectPublicationFiles, stagePublicationFiles } from "./files.js";
import { PUBLICATION_COMMAND_TIMEOUT_MS, type PrepareDeps, type PrepareResult } from "./types.js";

export { PUBLICATION_FILE_LIMITS } from "./files.js";
export type { PrepareDeps, PrepareFailure, PrepareResult, PreparedPublication, ProjectCommandRequest, RunProjectCommand } from "./types.js";

/** Build/collect, scan, and stage files; no Cloudflare authority is resolved here. */
export async function preparePublication(
  args: { boxRoot: string; card: string },
  deps: PrepareDeps,
): Promise<PrepareResult> {
  let cardPath: string;
  try {
    cardPath = resolvePublicationCardPath(args.card);
  } catch (error) {
    return { ok: false, reason: "invalid-definition", message: errorMessage(error) };
  }
  // Keyed by the card path, so the card is read once, inside the lock; the
  // source folder the lock guards belongs to that path.
  const lockKey = createHash("sha256").update(cardPath).digest("hex").slice(0, 32);
  const lockDir = path.join(args.boxRoot, ".beebox", "publish-prepare-locks");
  try {
    await mkdir(lockDir, { recursive: true });
    return await withFileLock({
      lockPath: path.join(lockDir, `card-${lockKey}.lock`),
      metadata: { purpose: "publication-local-prepare", card: cardPath },
      waitMs: PUBLICATION_COMMAND_TIMEOUT_MS * 2 + 20_000,
    }, () => preparePublicationUnlocked({ boxRoot: args.boxRoot, cardPath }, deps));
  } catch (error) {
    return { ok: false, reason: "invalid-source", message: errorMessage(error) };
  }
}

/** Local source/build lock; released before the caller mutates remote serving state. */
async function preparePublicationUnlocked(
  args: { boxRoot: string; cardPath: string },
  deps: PrepareDeps,
): Promise<PrepareResult> {
  let definition: PublicationDefinition;
  let sourceRoot: string;
  try {
    ({ definition, sourceRoot } = await readPublicationCardSource(args));
  } catch (error) {
    if (error instanceof PublicationCardSourceError) return { ok: false, reason: error.reason, message: error.message };
    return { ok: false, reason: "invalid-definition", message: errorMessage(error) };
  }

  let taskRoot: string | null = null;
  try {
    taskRoot = await mkdtemp(path.join(os.tmpdir(), "bbx-publish-prepare-"));
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
