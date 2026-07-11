/**
 * Document flow for the scan-import command: a single PDF that already has
 * embedded text is filed verbatim as a `source.file.card` (+ `source.pdf`)
 * inside the session's attach scope, with no Gemini analysis. The PDF lives
 * in the file-card's own attach scope.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { type CommandContext, type CommandResult } from "../command-runner.js";
import { stageAndCommitPaths } from "../../lib/git.js";
import { createCaptureSessionTemplate } from "../../schemas/capture-session.js";
import { createFileTemplate } from "../../schemas/file.js";
import { createOrAppendIntakeJob } from "../../connectors/intake-utils.js";
import { createSessionLayout } from "./scan-import-session.js";

export async function runDocumentMode(
  ctx: CommandContext,
  args: { pdfPath: string }
): Promise<CommandResult> {
  const layout = await createSessionLayout(ctx);
  const {
    sessionAttachAbsDir,
    sessionAttachRelDir,
    sessionCardAbsPath,
    sessionCardRelPath,
    sessionId,
    startedAt,
  } = layout;
  ctx.writeLine(`Document intake → ${sessionCardRelPath}`);
  ctx.writeLine(`Source: ${args.pdfPath}`);

  // The PDF lives in the file-card's own attach scope.
  const fileCardBasename = "source";
  const fileCardFilename = `${fileCardBasename}.file.card`;
  const fileAttachAbsDir = path.join(sessionAttachAbsDir, `${fileCardBasename}.attach`);
  await fs.mkdir(fileAttachAbsDir, { recursive: true });
  const pdfDestPath = path.join(fileAttachAbsDir, "source.pdf");
  await fs.copyFile(args.pdfPath, pdfDestPath);
  const stat = await fs.stat(pdfDestPath);
  const fileCard = createFileTemplate({
    capturedAt: startedAt,
    source: "scan-import",
    filename: "source.pdf",
    originalName: path.basename(args.pdfPath),
    mimeType: "application/pdf",
    size: stat.size,
  });
  await fs.writeFile(path.join(sessionAttachAbsDir, fileCardFilename), fileCard);

  const sessionCardContent = createCaptureSessionTemplate({
    sessionId,
    startedAt,
    endedAt: startedAt,
    imageRefs: [],
    audioRefs: [],
    fileRefs: [fileCardFilename],
  });
  await fs.writeFile(sessionCardAbsPath, sessionCardContent);

  const filesToStage = [
    `${sessionAttachRelDir}/${fileCardBasename}.attach/source.pdf`,
    `${sessionAttachRelDir}/${fileCardFilename}`,
    sessionCardRelPath,
  ];
  await stageAndCommitPaths(ctx.boxRoot, {
    paths: filesToStage,
    message: `Document import: ${path.basename(args.pdfPath)}`,
    trailers: { "Created-By": "scan-import" },
  });

  const intakeJobPath = await createOrAppendIntakeJob({
    boxRoot: ctx.boxRoot,
    source: "scan",
    items: [sessionCardRelPath],
    description: `Document PDF: ${path.basename(args.pdfPath)}`,
  });
  ctx.writeLine(`\nIntake job: ${intakeJobPath}`);
  ctx.writeLine(`Session: ${sessionCardRelPath}`);

  return {
    success: true,
    data: {
      mode: "document",
      sessionRelDir: sessionAttachRelDir,
      sessionCardPath: sessionCardRelPath,
      intakeJobPath,
    },
  };
}
