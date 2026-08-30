/**
 * Question cards for rejected scan uploads.
 *
 * A file the upload route refused stays in quarantine with a human-readable
 * reason and never reaches the box — so without this the rejection is visible
 * only in an HTTP response the uploader printed once (principle #4: never
 * silent). Each rejected entry raises one question card in `box/questions/`,
 * the one directory the pending/notification/aging machinery scans.
 *
 * Emission is idempotent across repeated promote passes: the card's ref is
 * written back onto the sidecar (`questionRef`), and the filename is derived
 * from the content hash, so a crash between writing the card and recording the
 * ref re-adopts the existing card instead of emitting a second one.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { errnoCode } from "../../lib/error-guards.js";
import { stageAndCommitPaths } from "../../lib/git.js";
import { getBoxDir } from "../../lib/paths.js";
import { getBoxTimeISO } from "../../lib/time.js";
import { createTextQuestionTemplate } from "../../schemas/question.js";
import { updateQuarantineState, type ScanQuarantineEntry } from "./quarantine.js";

/** Deterministic per-hash name — the idempotency key on disk. */
function questionFilename(entry: ScanQuarantineEntry): string {
  return `scan-rejected-${entry.sha256.slice(0, 12)}.question.card`;
}

function questionContent(entry: ScanQuarantineEntry, askedAt: string): string {
  const from = entry.tokenName === null ? "an owner-authenticated upload" : `scan token \`${entry.tokenName}\``;
  const profile = entry.profile === undefined ? "" : ` (scanner profile: ${entry.profile})`;
  const memo = [
    "A scanned file was refused at upload and never entered the box.",
    `- File: \`${entry.originalFilename}\``,
    `- Reason: ${entry.reason ?? "(no reason recorded)"}`,
    `- Sent by: ${from}${profile} at ${entry.receivedAt}`,
    "",
    "The bytes are held in the box's scan quarantine and the sending machine still has its copy — the uploader never disposes of a rejected file.",
  ].join("\n");
  return createTextQuestionTemplate({
    memo,
    prompt: `What should happen with the rejected scan \`${entry.originalFilename}\`?`,
    directive:
      "Decide with the boxholder: re-scan the original, fix whatever the reason names and re-upload " +
      "(a re-upload of the same file re-runs validation), or accept the loss. Then answer this question — " +
      "the quarantined copy is deleted once it is resolved.",
    askedAt,
  });
}

/**
 * Emit one question card per rejected entry that doesn't have one yet, and
 * record the ref on its sidecar. Returns the number of cards written.
 */
export async function emitRejectionQuestions(opts: {
  boxRoot: string;
  entries: ScanQuarantineEntry[];
}): Promise<number> {
  const { boxRoot, entries } = opts;
  const pending = entries.filter((e) => e.state === "rejected" && e.questionRef === undefined);
  if (pending.length === 0) return 0;

  const questionsDir = getBoxDir(boxRoot, "questions");
  await fs.mkdir(questionsDir, { recursive: true });
  const askedAt = getBoxTimeISO(boxRoot);
  const written: string[] = [];

  for (const entry of pending) {
    const filename = questionFilename(entry);
    const absPath = path.join(questionsDir, filename);
    const relPath = path.relative(boxRoot, absPath);
    // `wx` fails EEXIST when a prior pass already wrote the card but crashed
    // before recording the ref — adopt that card rather than rewriting one the
    // boxholder may already have answered. Any OTHER write failure (EACCES,
    // ENOSPC, EROFS) must NOT record a ref: the GC reads a missing card as
    // "resolved" and would then delete the quarantined bytes for a question
    // that was never asked. Rethrowing keeps the entry whole and retryable.
    try {
      await fs.writeFile(absPath, questionContent(entry, askedAt), { flag: "wx" });
      written.push(relPath);
    } catch (e) {
      if (errnoCode(e) !== "EEXIST") throw e;
      console.warn(`[scan] Adopting existing rejection question ${relPath} for ${entry.sha256.slice(0, 12)}`);
    }
    await updateQuarantineState(boxRoot, { sha256: entry.sha256, state: "rejected", questionRef: relPath });
  }

  if (written.length > 0) {
    await stageAndCommitPaths(boxRoot, {
      paths: written,
      message: `Scan rejections: ${written.length} question${written.length === 1 ? "" : "s"}`,
      trailers: { "Created-By": "scan-promote" },
    });
  }
  return written.length;
}
