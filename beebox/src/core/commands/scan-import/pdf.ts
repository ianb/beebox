/**
 * Pdf flow for the scan-import command: a single PDF that already has an
 * embedded text layer is run through Docling and filed as a `pdf.card`
 * (+ the original PDF, the gzipped extraction JSON, and page/figure images)
 * inside the session's attach scope. No Gemini analysis — the text is already
 * there; Docling contributes layout, reading order, and tables.
 *
 * When extraction fails for any reason, the card is still written — with an
 * `error:` field and the original PDF as its only asset.
 * That is exactly what this flow did before Docling existed, so a Docling
 * problem degrades to the old behavior instead of blocking intake
 * (`docs/implemented-plans/scanner-ingest.md`, Track 4).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { type CommandContext, type CommandResult } from "../../command-types.js";
import { stageAndCommitPaths } from "../../../lib/git/core/operations.js";
import { createCaptureSessionTemplate } from "../../../schemas/capture-session.js";
import type { DoclingService } from "../../../services/docling/core.js";
import { writePdfCard } from "../../pdf/write-card.js";
import { createSessionLayout, type SessionLayout } from "./session.js";
import { importSessionOrDiscard, queueCommittedSessionIntake } from "./session-discard.js";
import { assertAnnexBox } from "../../annex/assert-annex-box.js";

export { ocrIntentFor } from "../../pdf/write-card.js";

/** Basename of the pdf card and its attach scope inside the session. */
const PDF_BASENAME = "source";

export interface RunPdfModeArgs {
  pdfPath: string;
  /** Injected in tests; production creates the real `uvx docling` wrapper. */
  docling?: DoclingService | undefined;
  /** Provenance from the caller (`scan-upload/<token-name>`), when the run came
   *  from somewhere identifiable. Absent → the generic `scan-import`. */
  source?: string | undefined;
}

export async function runPdfMode(
  ctx: CommandContext,
  args: RunPdfModeArgs
): Promise<CommandResult> {
  await assertAnnexBox(ctx.boxRoot, "PDF extract");
  const layout = await createSessionLayout(ctx);
  return importSessionOrDiscard(ctx.boxRoot, { layout, run: () => importPdfSession(ctx, { args, layout }) });
}

async function importPdfSession(
  ctx: CommandContext,
  { args, layout }: { args: RunPdfModeArgs; layout: SessionLayout }
): Promise<CommandResult> {
  const {
    sessionAttachRelDir,
    sessionCardAbsPath,
    sessionCardRelPath,
    sessionId,
    startedAt,
  } = layout;
  ctx.writeLine(`Pdf intake → ${sessionCardRelPath}`);
  ctx.writeLine(`Source: ${args.pdfPath}`);

  // The original lives in the pdf card's own attach scope, alongside
  // everything extraction produces.
  const cardFilename = `${PDF_BASENAME}.pdf.card`;
  ctx.writeLine("Extracting with Docling...");
  const written = await writePdfCard({
    boxRoot: ctx.boxRoot,
    sourcePath: args.pdfPath,
    cardRel: `${sessionAttachRelDir}/${cardFilename}`,
    via: { channel: args.source ?? "scan-import", at: startedAt },
    originalName: path.basename(args.pdfPath),
    docling: args.docling,
  });
  if (written.error === null) {
    ctx.writeLine(`Extracted ${String(written.pages)} page(s), ${String(written.imageAssets)} image asset(s)`);
  } else {
    // Non-silent by construction: the reason is on the card, not only here.
    console.warn(`[scan-import] Docling extraction failed for ${path.basename(args.pdfPath)}: ${written.error}`);
    ctx.writeLine(`Extraction failed (filed with an error) — ${written.error}`);
  }

  const sessionCardContent = createCaptureSessionTemplate({
    sessionId,
    startedAt,
    endedAt: startedAt,
    imageRefs: [],
    audioRefs: [],
    fileRefs: [cardFilename],
    uploader: args.source,
  });
  await fs.writeFile(sessionCardAbsPath, sessionCardContent);

  const filesToStage = [...written.paths, sessionCardRelPath];
  await stageAndCommitPaths(ctx.boxRoot, {
    paths: filesToStage,
    message: `Pdf import: ${path.basename(args.pdfPath)}`,
    trailers: { "Created-By": "scan-import" },
  });

  const intakeJobPaths = await queueCommittedSessionIntake(ctx.boxRoot, {
    items: [sessionCardRelPath],
    description: `Pdf: ${path.basename(args.pdfPath)}`,
  });
  ctx.writeLine(`\nIntake jobs: ${intakeJobPaths?.join(", ") ?? "not created; the next wakeup queues it"}`);
  ctx.writeLine(`Session: ${sessionCardRelPath}`);

  return {
    success: true,
    data: {
      mode: "pdf",
      sessionRelDir: sessionAttachRelDir,
      sessionCardPath: sessionCardRelPath,
      pdfCardPath: `${sessionAttachRelDir}/${cardFilename}`,
      extracted: written.error === null,
      intakeJobPaths,
    },
  };
}
