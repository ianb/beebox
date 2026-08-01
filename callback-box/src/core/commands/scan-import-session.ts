/**
 * Session layout + input classification for the scan-import command.
 *
 * Every scan-import run (photo or document) allocates one capture-session
 * card under `box/inbox/scan-<date>-<id>.capture-session.card` with a sibling
 * `.attach/` scope. `createSessionLayout` computes those paths and creates the
 * attach directory. The file-type predicates and the optional CLAUDE_SCANS.md
 * context reader round out the shared, side-feature-free primitives.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { CommandContext } from "../command-runner.js";
import { getBoxTimeISO } from "../../lib/time.js";
import { createFileTemplate } from "../../schemas/file.js";
import { invariant } from "../../lib/invariant.js";
import {
  PDF_EXTENSION,
  SUPPORTED_IMAGE_EXTENSIONS,
} from "./upload-helpers.js";

export interface SessionLayout {
  sessionId: string;
  /** Basename of the session card (e.g. `scan-20260310T1924-abc12345`). */
  sessionBasename: string;
  /** Inbox-relative dir holding the session card. */
  inboxRelDir: string;
  /** Absolute path to the directory that holds the session card. */
  inboxAbsDir: string;
  /** Filename of the session card itself. */
  sessionCardFilename: string;
  /** Absolute path to the session card. */
  sessionCardAbsPath: string;
  /** Inbox-relative path to the session card. */
  sessionCardRelPath: string;
  /** Inbox-relative dir of the session's attach scope. */
  sessionAttachRelDir: string;
  /** Absolute path to the session's attach scope. */
  sessionAttachAbsDir: string;
  startedAt: string;
}

/**
 * File the PDF a photo-flow session was rendered from as a `source.file.card`
 * in the session's attach scope, so the original survives alongside the
 * derived page renders. Returns what the caller must stage and the session
 * card's `files:` refs.
 */
export async function fileSessionSourcePdf(args: {
  sourcePdfPath: string;
  sessionAttachAbsDir: string;
  sessionAttachRelDir: string;
  startedAt: string;
}): Promise<{ filesToStage: string[]; fileRefs: string[] }> {
  const sourceAttachAbsDir = path.join(args.sessionAttachAbsDir, "source.attach");
  await fs.mkdir(sourceAttachAbsDir, { recursive: true });
  const pdfDestPath = path.join(sourceAttachAbsDir, "source.pdf");
  await fs.copyFile(args.sourcePdfPath, pdfDestPath);
  const stat = await fs.stat(pdfDestPath);
  await fs.writeFile(
    path.join(args.sessionAttachAbsDir, "source.file.card"),
    createFileTemplate({
      capturedAt: args.startedAt,
      source: "scan-import",
      filename: "source.pdf",
      originalName: path.basename(args.sourcePdfPath),
      mimeType: "application/pdf",
      size: stat.size,
    })
  );
  return {
    filesToStage: [
      `${args.sessionAttachRelDir}/source.attach/source.pdf`,
      `${args.sessionAttachRelDir}/source.file.card`,
    ],
    fileRefs: ["source.file.card"],
  };
}

export const isImageFile = (p: string): boolean =>
  SUPPORTED_IMAGE_EXTENSIONS.includes(path.extname(p).toLowerCase());
export const isPdfFile = (p: string): boolean =>
  path.extname(p).toLowerCase() === PDF_EXTENSION;

/** What one scan-import invocation was handed, once resolved and classified. */
export type ResolvedScanInputs =
  | { error: string }
  | { kind: "pdf"; pdfPath: string }
  | { kind: "images"; imagePaths: string[] };

/**
 * Resolve input paths against the box root, check they exist, and classify the
 * batch. Every way a caller can hand scan-import an unusable set of inputs is
 * decided here, before any session directory is created.
 */
export async function resolveScanInputs(
  boxRoot: string,
  inputs: string[],
): Promise<ResolvedScanInputs> {
  const resolved: string[] = [];
  for (const f of inputs) {
    const abs = path.isAbsolute(f) ? f : path.join(boxRoot, f);
    try {
      await fs.access(abs);
    } catch (_e) {
      // fs.access rejects when the input path is missing/unreadable — that is
      // precisely the condition we report back. The error adds no detail
      // beyond the path, so we don't surface it.
      return { error: `Input file not found: ${abs}` };
    }
    resolved.push(abs);
  }

  const allPdf = resolved.every((f) => isPdfFile(f));
  const allImage = resolved.every((f) => isImageFile(f));
  if (!allPdf && !allImage) {
    return {
      error: "Mixed file types in one scan-import invocation. PDFs run one-per-session; images can be batched together.",
    };
  }
  if (!allPdf) return { kind: "images", imagePaths: resolved };
  if (resolved.length > 1) {
    return { error: "scan-import takes a single PDF at a time (use cb upload for batches)" };
  }
  const [pdfPath] = resolved;
  invariant(pdfPath !== undefined, "resolved has exactly one entry (non-empty inputs, length > 1 handled above)");
  return { kind: "pdf", pdfPath };
}

export async function readScanContextFile(boxRoot: string): Promise<string | null> {
  for (const name of ["CLAUDE_SCANS.md", "claude_scans.md"]) {
    try {
      const content = await fs.readFile(path.join(boxRoot, name), "utf-8");
      if (content.trim().length > 0) return content;
    } catch (_e) {
      // Context file is optional — readFile rejects when this candidate
      // name doesn't exist, which is the common case. Try the next name;
      // returning null (no context) at the end is a valid outcome.
    }
  }
  return null;
}

/**
 * Build the combined boxholder context from the optional CLAUDE_SCANS.md file
 * and any `--context` argument, logging which sources contributed.
 */
export async function resolveBoxholderContext(
  ctx: CommandContext,
  extraContext: string | undefined
): Promise<string | null> {
  const fileContext = await readScanContextFile(ctx.boxRoot);
  const contextParts: string[] = [];
  if (fileContext) contextParts.push(fileContext.trim());
  if (extraContext && extraContext.trim().length > 0) contextParts.push(extraContext.trim());
  const boxholderContext = contextParts.length > 0 ? contextParts.join("\n\n---\n\n") : null;
  if (boxholderContext) {
    ctx.writeLine(
      `Using boxholder context (${boxholderContext.length} chars${fileContext ? " from CLAUDE_SCANS.md" : ""}${extraContext ? " + --context" : ""})`
    );
  }
  return boxholderContext;
}

export async function createSessionLayout(ctx: CommandContext): Promise<SessionLayout> {
  const sessionId = randomUUID();
  const shortId = sessionId.slice(0, 8);
  const startedAt = getBoxTimeISO(ctx.boxRoot);
  const stamp = startedAt.replace(/[:-]/g, "").slice(0, 13);
  const formattedDate = `${stamp.slice(0, 8)}T${stamp.slice(9, 13)}`;
  const sessionBasename = `scan-${formattedDate}-${shortId}`;
  const inboxRelDir = "box/inbox";
  const inboxAbsDir = path.join(ctx.boxRoot, inboxRelDir);
  const sessionCardFilename = `${sessionBasename}.capture-session.card`;
  const sessionAttachRelDir = `${inboxRelDir}/${sessionBasename}.attach`;
  const sessionAttachAbsDir = path.join(ctx.boxRoot, sessionAttachRelDir);
  await fs.mkdir(sessionAttachAbsDir, { recursive: true });
  return {
    sessionId,
    sessionBasename,
    inboxRelDir,
    inboxAbsDir,
    sessionCardFilename,
    sessionCardAbsPath: path.join(inboxAbsDir, sessionCardFilename),
    sessionCardRelPath: `${inboxRelDir}/${sessionCardFilename}`,
    sessionAttachRelDir,
    sessionAttachAbsDir,
    startedAt,
  };
}
