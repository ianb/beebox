/**
 * Session layout + input classification for the scan-import command.
 *
 * Every scan-import run (photo or document) allocates one capture-session
 * card under `box/inbox/scan-<date>-<id>.capture-session.card` with a sibling
 * `.attach/` scope. `createSessionLayout` computes those paths and creates the
 * attach directory. The file-type predicates and the boxholder-context
 * assembly (scan guide via `scan-guide-context.ts`, plus `--context`) round
 * out the shared, side-feature-free primitives.
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
import { resolveScanGuideContext } from "./scan-guide-context.js";
import {
  createGeminiScanVision,
  selectScanVisionBackend,
  type ScanVisionService,
} from "../../services/scan-vision.js";
import { createClaudeScanVision } from "../../services/scan-vision-claude.js";
import { checkClaudeAuth, ClaudeAuthError } from "../agent/auth-preflight.js";
import { ScanVisionBatchError } from "../../services/scan-vision.js";
import { runScanBatches, type RunScanBatchesResult } from "./scan-import-helpers.js";

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

/**
 * Build the combined boxholder context from the scan guide (or the
 * deprecated CLAUDE_SCANS.md fallback) and any `--context` argument,
 * logging which sources contributed and surfacing deprecation warnings.
 */
/**
 * Build the photo-analysis backend from the environment (default: Claude via
 * the agent SDK — no extra credential; `CB_SCAN_VISION=gemini` opts into the
 * Gemini backend when its key is present). The Claude path preflights auth
 * here, before any files are staged, so an unauthed host fails with the
 * actionable login message instead of mid-run.
 */
export async function resolveScanVision(
  boxRoot: string
): Promise<{ vision: ScanVisionService } | { error: string }> {
  const selection = selectScanVisionBackend(process.env);
  if (!selection.ok) return { error: selection.error };
  if (selection.value.backend === "gemini") {
    return { vision: createGeminiScanVision({ apiKey: selection.value.apiKey }) };
  }
  try {
    await checkClaudeAuth();
  } catch (e) {
    if (e instanceof ClaudeAuthError) return { error: e.message };
    throw e;
  }
  return { vision: createClaudeScanVision({ boxRoot }) };
}

export async function resolveBoxholderContext(
  ctx: CommandContext,
  extraContext: string | undefined
): Promise<string | null> {
  const guideContext = await resolveScanGuideContext(ctx.boxRoot);
  for (const warning of guideContext?.warnings ?? []) {
    ctx.writeLine(warning);
  }
  const contextParts: string[] = [];
  if (guideContext) contextParts.push(guideContext.text.trim());
  if (extraContext && extraContext.trim().length > 0) contextParts.push(extraContext.trim());
  const boxholderContext = contextParts.length > 0 ? contextParts.join("\n\n---\n\n") : null;
  if (boxholderContext) {
    const sourceLabel =
      guideContext === null
        ? ""
        : guideContext.source === "guide"
          ? " from scan guide"
          : " from CLAUDE_SCANS.md (deprecated)";
    ctx.writeLine(
      `Using boxholder context (${boxholderContext.length} chars${sourceLabel}${extraContext ? " + --context" : ""})`
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

/**
 * Run the vision analysis over the archived pages, logging usage and cost
 * (failed/retried calls included). A `fatal` classification aborts cleanly:
 * nothing has been staged, so the session scratch dirs are removed wholesale.
 */
export async function analyzeScanPages(
  ctx: CommandContext,
  {
    vision,
    apiPages,
    boxholderContext,
    sessionAttachAbsDir,
  }: {
    vision: ScanVisionService;
    apiPages: string[];
    boxholderContext: string | null;
    sessionAttachAbsDir: string;
  }
): Promise<{ batchResult: RunScanBatchesResult } | { error: string }> {
  ctx.writeLine(`Analyzing ${apiPages.length} pages with ${vision.backend}...`);
  let batchResult;
  try {
    batchResult = await runScanBatches({
      vision,
      imagePaths: apiPages,
      boxholderContext,
      log: (line) => ctx.writeLine(line),
    });
  } catch (e) {
    if (e instanceof ScanVisionBatchError && e.retry === "fatal") {
      await fs.rm(sessionAttachAbsDir, { recursive: true, force: true });
      return { error: `Scan analysis aborted: ${e.message}` };
    }
    throw e;
  }
  if (batchResult.failed > 0) ctx.writeLine(`${batchResult.failed} page(s) failed analysis`);
  if (batchResult.usage) {
    ctx.writeLine(
      `Tokens: input=${batchResult.usage.prompt}, output=${batchResult.usage.output}, thinking=${batchResult.usage.thinking}`
    );
  }
  if (batchResult.costUsd !== null) {
    ctx.writeLine(`Cost: $${batchResult.costUsd.toFixed(4)} (includes failed/retried calls)`);
  }
  return { batchResult };
}
