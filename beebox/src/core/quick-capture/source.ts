/** Retained memo source, independently committed before work can be dispatched. */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { renderFrontmatterBlock, parseFrontmatterObject } from "../../exports/cards.js";
import { listBoxCardFiles } from "../list-cards.js";
import { parseCardText, serializeCardText } from "../card-io.js";
import { createCardSchemaMap } from "../../schemas.js";
import { createImageTemplate } from "../../schemas/image/schema.js";
import { stageAndCommitPaths } from "../../lib/git/core/operations.js";
import { withCardLock } from "../../lib/card-lock.js";
import { writeFileAtomic } from "../../lib/atomic-write.js";
import { isRecord } from "../../shared/is-record.js";
import { errnoCode } from "../../shared/error-guards.js";
import { parseRef, resolveRefPath } from "../../shared/ref-path/core.js";
import { neutralizeIngestedMarkdown } from "../../shared/markdoc-config/ingest.js";
import { quickCaptureDeclarationSchema, type QuickCaptureMaterial } from "../../shared/quick-capture.js";
import { captureDirectory, readCapture, withCaptureLock, writeCapture, QuickCaptureError, type CaptureRecord } from "./store.js";

function resolveSource(boxRoot: string, ref: string): string {
  const resolved = resolveRefPath({ fromPath: undefined, ref: parseRef(ref).path, kind: "card" });
  if (resolved === null) throw new QuickCaptureError({ reason: "invalid-source-ref" });
  return path.join(boxRoot, resolved);
}
/** Only memo cards owned by this coordinator participate in identity lookup. */
export async function findCaptureSource(boxRoot: string, record: CaptureRecord): Promise<string | null> {
  const expected = `_content/captures/${record.id}.memo.card`;
  const candidates = record.sourceRef === undefined ? [expected] : [record.sourceRef, expected];
  const schemas = await createCardSchemaMap(boxRoot);
  for (const ref of candidates) {
    const abs = resolveSource(boxRoot, ref);
    let content: string;
    try { content = await fs.readFile(abs, "utf8"); }
    catch (error) { if (errnoCode(error) === "ENOENT") continue; throw error; }
    if (!abs.endsWith(".memo.card") || parseFrontmatterObject(content)?.["share-id"] !== record.id) continue;
    parseCardText(content, { source: abs, schemas });
    return path.relative(boxRoot, abs).split(path.sep).join("/");
  }
  const matches: string[] = [];
  for (const file of await listBoxCardFiles(boxRoot)) {
    if (!file.endsWith(".memo.card")) continue;
    const content = await fs.readFile(file, "utf8");
    if (parseFrontmatterObject(content)?.["share-id"] !== record.id) continue;
    parseCardText(content, { source: file, schemas });
    matches.push(path.relative(boxRoot, file).split(path.sep).join("/"));
  }
  if (matches.length > 1) throw new QuickCaptureError({ reason: "duplicate-source" });
  return matches[0] ?? null;
}
/** Caller already holds this capture's lock: persist filing/deletion reconciliation once. */
export async function reconcileCaptureSourceLocked(boxRoot: string, record: CaptureRecord): Promise<CaptureRecord> {
  if (record.state === "gone" || record.sourceCommitted !== true) return record;
  const found = await findCaptureSource(boxRoot, record);
  if (found === record.sourceRef) return record;
  if (found === null) { record.state = "gone"; record.error = "The saved source was deleted."; }
  else record.sourceRef = found;
  await writeCapture(boxRoot, record);
  return record;
}
/** Fast valid-ref reads do not wait for a transcription job holding the capture lock. */
export async function reconcileCaptureSource(boxRoot: string, id: string): Promise<CaptureRecord | null> {
  const record = await readCapture(boxRoot, id);
  if (record === null || record.state === "gone" || record.sourceCommitted !== true) return record;
  const found = await findCaptureSource(boxRoot, record);
  if (found === record.sourceRef) return record;
  return withCaptureLock({ boxRoot, id }, async () => {
    const fresh = await readCapture(boxRoot, id);
    return fresh === null ? null : reconcileCaptureSourceLocked(boxRoot, fresh);
  });
}
export async function materializeCaptureSource(boxRoot: string, record: CaptureRecord): Promise<string> {
  const existing = await findCaptureSource(boxRoot, record);
  if (record.sourceCommitted === true) {
    if (existing === null) throw new QuickCaptureError({ reason: "missing-source" });
    return existing;
  }
  const rel = existing ?? `_content/captures/${record.id}.memo.card`;
  const abs = resolveSource(boxRoot, rel);
  const attachRel = rel.replace(/\.memo\.card$/, ".attach");
  const attachAbs = path.join(boxRoot, attachRel);
  const paths = [rel];
  await withCardLock(abs, async () => {
    const declaration = quickCaptureDeclarationSchema.parse(record.declaration);
    const material = declaration.material;
    let body = declaration.input === undefined ? "" : neutralizeIngestedMarkdown(declaration.input);
    const fields: Record<string, unknown> = {
      status: "processed", created: declaration.capturedAt, source: declaration.source,
      "share-id": record.id, title: material?.kind === "audio" ? "Voice note" : "Saved capture",
    };
    if (material?.kind === "url") fields["context"] = { url: material.url, ...(material.title === undefined ? {} : { title: material.title }) };
    if (material?.kind === "clipping") fields["context"] = { text: material.text, ...(material.title === undefined ? {} : { title: material.title }) };
    if (material?.kind === "image") {
      await fs.mkdir(attachAbs, { recursive: true });
      const ext = imageExtension(material.mimeType);
      const imageAttachRel = `${attachRel}/image.attach`;
      await fs.mkdir(path.join(boxRoot, imageAttachRel), { recursive: true });
      await fs.copyFile(path.join(captureDirectory(boxRoot, record.id), "material"), path.join(boxRoot, imageAttachRel, `image.${ext}`));
      const imageRef = `${attachRel}/image.image.card`;
      await writeFileAtomic(path.join(boxRoot, imageRef), { content:
        createImageTemplate({ via: { channel: "import", at: declaration.capturedAt }, filename: `image.${ext}` }) });
      paths.push(imageRef, `${imageAttachRel}/image.${ext}`);
      body += `${body === "" ? "" : "\n\n"}[Shared image](attach/image.image.card)\n`;
    }
    if (material?.kind === "audio") {
      await fs.mkdir(attachAbs, { recursive: true });
      const name = `recording.${audioExtension(material.mimeType)}`;
      await fs.copyFile(path.join(captureDirectory(boxRoot, record.id), "material"), path.join(attachAbs, name));
      paths.push(`${attachRel}/${name}`);
      if (declaration.recordingInterrupted === true) body += `${body === "" ? "" : "\n\n"}## Recording status\nThis recording was interrupted and may end early.\n` ;
      body += `${body === "" ? "" : "\n\n"}[Recorded audio](attach/${name})\n`;
    }
    // A retry after a crash before commit must not replace later edits to a source already written.
    try { await fs.access(abs); }
    catch (error) {
      if (errnoCode(error) !== "ENOENT") throw error;
      const content = renderFrontmatterBlock(fields, body);
      parseCardText(content, { source: abs, schemas: await createCardSchemaMap(boxRoot) });
      await writeFileAtomic(abs, { content });
    }
    await stageAndCommitPaths(boxRoot, { paths, message: "Retain quick capture source", trailers: { "Created-By": declaration.source } });
  });
  return rel;
}
export async function writeSourceTranscription(args: { boxRoot: string; sourceRef: string; text?: string; language?: string; attemptedAt: string; error?: string; permanent?: boolean }): Promise<void> {
  const abs = resolveSource(args.boxRoot, args.sourceRef);
  await withCardLock(abs, async () => {
    const parsed = parseCardText(await fs.readFile(abs, "utf8"), { source: abs, schemas: await createCardSchemaMap(args.boxRoot) });
    if (args.text !== undefined) {
      parsed.fields["transcription"] = { text: args.text, language: args.language, "transcribed-at": args.attemptedAt };
      delete parsed.fields["transcription-error"];
    } else {
      const previous = parsed.fields["transcription-error"];
      if (isRecord(previous) && previous["message"] === args.error && previous["permanent"] === (args.permanent === true)) return;
      parsed.fields["transcription-error"] = { permanent: args.permanent === true, message: args.error, "attempted-at": args.attemptedAt };
    }
    await writeFileAtomic(abs, { content: serializeCardText({ schema: parsed.schema, fields: parsed.fields }) });
    await stageAndCommitPaths(args.boxRoot, { paths: [args.sourceRef], message: "Record quick capture transcription" });
  });
}
function imageExtension(mime: Extract<QuickCaptureMaterial, { kind: "image" }>["mimeType"]): string {
  switch (mime) {
    case "image/png": return "png";
    case "image/jpeg": return "jpg";
    case "image/webp": return "webp";
    case "image/heic":
    case "image/heif": return "heic";
  }
}
export function audioExtension(mime: Extract<QuickCaptureMaterial, { kind: "audio" }>["mimeType"]): string {
  switch (mime) {
    case "audio/wav": return "wav";
    case "audio/webm": return "webm";
    case "audio/mpeg": return "mp3";
    case "audio/aac": return "aac";
    case "audio/mp4":
    case "audio/x-m4a": return "m4a";
  }
}
