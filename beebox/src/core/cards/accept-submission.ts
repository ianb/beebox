/**
 * Accept a submission batch into a card's attach scope.
 *
 * Generic over `CardSubmissions` (`src/cards/schema.ts`): any card type that
 * opts in gets the same accept path. The whole span — read, refuse-check,
 * validate, sniff, rename, manifest write, frontmatter RMW, commit, and
 * event emission — runs inside `withCardLock` on the target card so two
 * concurrent submissions to the same card serialize rather than losing one
 * batch's `last-upload` update to the other.
 *
 * The caller (the route) has already streamed the uploaded parts to
 * `tempDir` and parsed the manifest JSON; this module owns everything from
 * "does this card accept submissions" onward.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import { fileTypeFromFile } from "file-type";
import { withCardLock } from "../../lib/card-lock.js";
import { errnoCode } from "../../lib/error-guards.js";
import { isRecord } from "../../lib/is-record.js";
import { stageAndCommitPaths } from "../../lib/git.js";
import type { EventBus } from "../event-bus.js";
import { attachDirFor } from "../../shared/attach-path.js";
import { createCardSchemaMap } from "../../schemas/registry.js";
import { parseCardText } from "../card-io.js";
import { parseFrontmatterObject, renderFrontmatterBlock, splitCardContent, type SubmissionIssue } from "../../cards/index.js";

export interface AcceptSubmissionInput {
  boxRoot: string;
  /** Box-relative path of the target card. */
  cardRel: string;
  /** Absolute dir holding the uploaded file parts, already streamed to disk by the route. */
  tempDir: string;
  /** The uploaded part names (basename only) present in `tempDir`. */
  fileNames: string[];
  /** Parsed JSON of the `records` part. */
  manifest: unknown;
  eventBus: EventBus;
  now: () => Date;
}

export type AcceptSubmissionResult =
  | { ok: true; batch: string; count: number; dir: string }
  | { ok: false; status: 404 | 409 | 400; message: string; issues?: SubmissionIssue[] };

/**
 * Raised when two allocation attempts for a batch id both collide with an
 * existing directory. Two hex bytes give 65536 possibilities per timestamp
 * second, so a second collision means something is wrong (a clock stuck, or
 * a directory pre-seeded to sabotage allocation) rather than ordinary
 * concurrency — a broken invariant, not a retry loop.
 */
class SubmissionBatchAllocationError extends Error {
  constructor(dir: string) {
    super(`Could not allocate a unique submission batch directory under ${dir}`);
    this.name = "SubmissionBatchAllocationError";
  }
}

async function readIfPresent(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return undefined;
    throw e;
  }
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return false;
    throw e;
  }
}

/** `YYYYMMDD-HHMMSS-<4 hex>`, never client-chosen. */
function allocateBatchId(timestamp: Date): string {
  const compact = timestamp.toISOString().slice(0, 19).replace(/[:-]/g, "").replace("T", "-");
  return `${compact}-${randomBytes(2).toString("hex")}`;
}

async function removeTempDir(tempDir: string): Promise<void> {
  await fs.rm(tempDir, { recursive: true, force: true });
}

export async function acceptSubmission(input: AcceptSubmissionInput): Promise<AcceptSubmissionResult> {
  const { boxRoot, cardRel, tempDir, fileNames, manifest, eventBus, now } = input;
  const absCardPath = path.resolve(boxRoot, cardRel);
  // Fail closed on a path that leaves the box or does not name a card: the
  // client chose `cardRel`, and everything below trusts it as a box path.
  if (!absCardPath.startsWith(path.resolve(boxRoot) + path.sep) || !cardRel.endsWith(".card")) {
    await removeTempDir(tempDir);
    return { ok: false, status: 404, message: `card not found: ${cardRel}` };
  }

  return withCardLock(absCardPath, async () => {
    const cardText = await readIfPresent(absCardPath);
    if (cardText === undefined) {
      await removeTempDir(tempDir);
      return { ok: false, status: 404, message: `card not found: ${cardRel}` };
    }

    const schemas = await createCardSchemaMap(boxRoot);
    const parsed = parseCardText(cardText, { source: absCardPath, schemas });
    const submissions = parsed.schema.submissions;
    if (submissions === undefined) {
      await removeTempDir(tempDir);
      return { ok: false, status: 404, message: "this card type does not accept submissions" };
    }

    const refusal = submissions.refusal(parsed.fields);
    if (refusal !== null) {
      await removeTempDir(tempDir);
      return { ok: false, status: 409, message: refusal };
    }

    const attachDir = path.join(boxRoot, attachDirFor(cardRel));
    const readAttachment = async (name: string): Promise<string | null> => {
      if (name.includes("/") || name.startsWith(".")) return null;
      const text = await readIfPresent(path.join(attachDir, name));
      return text ?? null;
    };

    const validation = await submissions.validate({
      fields: parsed.fields,
      manifest,
      fileNames,
      readAttachment,
    });
    if (!validation.ok) {
      await removeTempDir(tempDir);
      return { ok: false, status: 400, message: "submission failed validation", issues: validation.issues };
    }

    const files: Array<{ name: string; size: number; mimetype: string }> = [];
    for (const name of fileNames) {
      const filePath = path.join(tempDir, name);
      const stat = await fs.stat(filePath);
      const sniffed = await fileTypeFromFile(filePath);
      files.push({ name, size: stat.size, mimetype: sniffed?.mime ?? "application/octet-stream" });
    }

    const inboxDir = path.join(attachDir, submissions.dir);
    await fs.mkdir(inboxDir, { recursive: true });

    const timestamp = now();
    let batch = allocateBatchId(timestamp);
    let targetDir = path.join(inboxDir, batch);
    if (await pathExists(targetDir)) {
      batch = allocateBatchId(timestamp);
      targetDir = path.join(inboxDir, batch);
      if (await pathExists(targetDir)) {
        throw new SubmissionBatchAllocationError(inboxDir);
      }
    }

    try {
      await fs.rename(tempDir, targetDir);
    } catch (e) {
      if (errnoCode(e) !== "EXDEV") throw e;
      // Temp staging and the box's attach scope can sit on different
      // filesystems (e.g. a separate tmpfs mount); fall back to copy+remove.
      await fs.cp(tempDir, targetDir, { recursive: true });
      await removeTempDir(tempDir);
    }

    // The manifest is untrusted JSON from the request; preserve it under its
    // own key rather than silently dropping it if it ever arrives as
    // something other than an object (a schema's `validate` is expected to
    // have already required an object shape, but this module is generic over
    // any schema's contract).
    const manifestOut: Record<string, unknown> = isRecord(manifest) ? { ...manifest, files } : { manifest, files };
    await fs.writeFile(path.join(targetDir, "records.json"), `${JSON.stringify(manifestOut, null, 2)}\n`, "utf8");

    const fields = parseFrontmatterObject(cardText) ?? {};
    fields["last-upload"] = timestamp.toISOString();
    const split = splitCardContent(cardText);
    await fs.writeFile(absCardPath, renderFrontmatterBlock(fields, split.body), "utf8");

    const batchDirRel = path.relative(boxRoot, targetDir);
    const recordsRel = path.join(batchDirRel, "records.json");

    await stageAndCommitPaths(boxRoot, {
      paths: [cardRel, batchDirRel],
      message: `Accept submission ${batch} for ${cardRel}`,
      trailers: { "Created-By": "card-submission" },
    });

    const eventTimestamp = timestamp.toISOString();
    eventBus.emitTransient("file-change", { event: "change", path: cardRel, timestamp: eventTimestamp });
    eventBus.emitTransient("file-change", { event: "add", path: recordsRel, timestamp: eventTimestamp });

    return { ok: true, batch, count: validation.count, dir: batchDirRel };
  });
}
