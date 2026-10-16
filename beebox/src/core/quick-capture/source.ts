/** Retained capture source (a doc card), independently committed before work can be dispatched. */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { renderFrontmatterBlock, parseFrontmatterObject } from "../../exports/cards.js";
import { listBoxCardFiles } from "../list-cards.js";
import { parseCardText, serializeCardText } from "../card-io.js";
import { createCardSchemaMap } from "../../schemas.js";
import { createImageTemplate } from "../../schemas/image/schema.js";
import { createAudioTemplate } from "../../schemas/audio.js";
import { attachDirFor } from "../../shared/attach-path.js";
import { stageAndCommitPaths } from "../../lib/git/core/operations.js";
import { withCardLock } from "../../lib/card-lock.js";
import { writeFileAtomic } from "../../lib/atomic-write.js";
import { mimetypeToExtension } from "../../lib/mimetype.js";
import { isRecord } from "../../shared/is-record.js";
import { errnoCode } from "../../shared/error-guards.js";
import { resolveContainedRef } from "../ref-exists.js";
import { realpathContained } from "../../lib/box-containment.js";
import { neutralizeIngestedMarkdown } from "../../shared/markdoc-config/ingest.js";
import { quickCaptureDeclarationSchema } from "../../shared/quick-capture.js";
import { captureDirectory, readCapture, withCaptureLock, writeCapture, QuickCaptureError, type CaptureRecord } from "./store.js";
import { ensureIncomingDir, INCOMING_DIR } from "../incoming.js";
import type { QuickCaptureDeclaration } from "../../shared/quick-capture.js";

const CAPTURES_DIR = "_content/captures";

/**
 * Where a new source waits. A capture with typed or dictated words is routed to
 * a chat, which files it: it waits uncommitted in the git-ignored incoming
 * folder, as a page sent from the Clerk does. A capture with no words is never
 * routed, so nothing would file it: committed in `_content/captures/` on
 * arrival (boxholder, 2026-10-15). A recording is committed there too, words
 * or not, because it cannot be captured again; that exception is the
 * implementer's, put to the boxholder the same day.
 */
function sourceDirectory(declaration: Pick<QuickCaptureDeclaration, "input" | "material">): string {
  const words = declaration.input !== undefined && declaration.input.trim() !== "";
  return words && declaration.material?.kind !== "audio" ? INCOMING_DIR : CAPTURES_DIR;
}

async function resolveSource(boxRoot: string, ref: string): Promise<string> {
  const contained = resolveContainedRef({ boxRoot, ref, fromPath: "" });
  if (contained === null) throw new QuickCaptureError({ reason: "invalid-source-ref" });
  const safe = await realpathContained(boxRoot, contained);
  if (safe === null) throw new QuickCaptureError({ reason: "invalid-source-ref" });
  return path.join(boxRoot, safe);
}
const SOURCE_SUFFIX = ".doc.card";
/** Settling period only: sources written before the retire-memo-2026-10 migration. */
const LEGACY_SOURCE_SUFFIX = ".memo.card";
/** The recording's audio card, inside the source doc's attach scope. */
const RECORDING_CARD = "recording.audio.card";

/** Only doc cards owned by this coordinator participate in identity lookup. */
export async function findCaptureSource(boxRoot: string, record: CaptureRecord): Promise<string | null> {
  const expected = [`${CAPTURES_DIR}/${record.id}${SOURCE_SUFFIX}`, `${INCOMING_DIR}/${record.id}${SOURCE_SUFFIX}`];
  const candidates = record.sourceRef === undefined ? expected : [record.sourceRef, ...expected];
  const schemas = await createCardSchemaMap(boxRoot);
  for (const ref of candidates) {
    const abs = await resolveSource(boxRoot, ref);
    let content: string;
    try { content = await fs.readFile(abs, "utf8"); }
    catch (error) { if (errnoCode(error) === "ENOENT") continue; throw error; }
    if (!abs.endsWith(SOURCE_SUFFIX) || parseFrontmatterObject(content)?.["share-id"] !== record.id) continue;
    parseCardText(content, { source: abs, schemas });
    return path.relative(boxRoot, abs).split(path.sep).join("/");
  }
  const matches: string[] = [];
  let legacy = false;
  for (const file of await listBoxCardFiles(boxRoot)) {
    const isSource = file.endsWith(SOURCE_SUFFIX);
    if (!isSource && !file.endsWith(LEGACY_SOURCE_SUFFIX)) continue;
    const content = await fs.readFile(file, "utf8");
    if (parseFrontmatterObject(content)?.["share-id"] !== record.id) continue;
    if (!isSource) { legacy = true; continue; }
    parseCardText(content, { source: file, schemas });
    matches.push(path.relative(boxRoot, file).split(path.sep).join("/"));
  }
  if (matches.length > 1) throw new QuickCaptureError({ reason: "duplicate-source" });
  // A memo source means the retire-memo migration has not run; "not found" would tombstone the capture.
  if (matches.length === 0 && legacy) throw new QuickCaptureError({ reason: "migration-pending" });
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
  const directory = sourceDirectory(record.declaration);
  const rel = existing ?? `${directory}/${record.id}${SOURCE_SUFFIX}`;
  const waitsInIncoming = rel.startsWith(`${INCOMING_DIR}/`);
  if (waitsInIncoming) await ensureIncomingDir(boxRoot);
  const abs = await resolveSource(boxRoot, rel);
  const attachRel = attachDirFor(rel);
  const attachAbs = path.join(boxRoot, attachRel);
  const paths = [rel];
  await withCardLock(abs, async () => {
    const declaration = quickCaptureDeclarationSchema.parse(record.declaration);
    const material = declaration.material;
    let body = declaration.input === undefined ? "" : neutralizeIngestedMarkdown(declaration.input);
    const fields: Record<string, unknown> = {
      title: material?.kind === "audio" ? "Voice note" : "Saved capture",
      "share-id": record.id, via: { channel: declaration.source },
    };
    if (material?.kind === "url") fields["sources"] = [{ href: material.url, ...(material.title === undefined ? {} : { label: material.title }) }];
    if (material?.kind === "clipping") body += `${body === "" ? "" : "\n\n"}${clippingSection(material)}`;
    if (material?.kind === "image") {
      await fs.mkdir(attachAbs, { recursive: true });
      const ext = mimetypeToExtension(material.mimeType).slice(1);
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
      const name = `recording${mimetypeToExtension(material.mimeType)}`;
      const recordingRef = `${attachRel}/${RECORDING_CARD}`;
      const recordingAttachRel = attachDirFor(recordingRef);
      await fs.mkdir(path.join(boxRoot, recordingAttachRel), { recursive: true });
      await fs.copyFile(path.join(captureDirectory(boxRoot, record.id), "material"), path.join(boxRoot, recordingAttachRel, name));
      await writeFileAtomic(path.join(boxRoot, recordingRef), { content:
        createAudioTemplate({ via: { channel: "microphone", at: declaration.capturedAt }, filename: name }) });
      paths.push(recordingRef, `${recordingAttachRel}/${name}`);
      if (declaration.recordingInterrupted === true) body += `${body === "" ? "" : "\n\n"}## Recording status\nThis recording was interrupted and may end early.\n` ;
      body += `${body === "" ? "" : "\n\n"}[Recorded audio](attach/${RECORDING_CARD})\n`;
    }
    // A retry after a crash before commit must not replace later edits to a source already written.
    try { await fs.access(abs); }
    catch (error) {
      if (errnoCode(error) !== "ENOENT") throw error;
      const content = renderFrontmatterBlock(fields, body);
      parseCardText(content, { source: abs, schemas: await createCardSchemaMap(boxRoot) });
      await writeFileAtomic(abs, { content });
    }
    // A source in the incoming folder is on disk, not in git, until its chat files it.
    if (!waitsInIncoming) await stageAndCommitPaths(boxRoot, { paths, message: "Retain quick capture source", trailers: { "Created-By": declaration.source } });
  });
  return rel;
}
/**
 * The clipping a capture carried, as body text. Material is evidence, not the
 * person's words: it sits under its own heading, quoted. A clipping has no URL,
 * so its title stays here rather than in `sources`.
 */
function clippingSection(material: { text: string; title?: string | undefined }): string {
  const quoted = neutralizeIngestedMarkdown(material.text).split("\n").map(line => line === "" ? ">" : `> ${line}`).join("\n");
  const from = material.title === undefined || material.title.trim() === "" ? "" : `Clipped from “${neutralizeIngestedMarkdown(material.title.trim())}”:\n\n`;
  return `## Clipping\n\n${from}${quoted}\n`;
}

/**
 * Record a transcription result on the source's recording card. The source is
 * looked up again under its lock: a chat may have filed it while the provider ran.
 */
export async function writeSourceTranscription(args: { boxRoot: string; record: CaptureRecord; text?: string; attemptedAt: string; error?: string; permanent?: boolean }): Promise<void> {
  const sourceRef = await findCaptureSource(args.boxRoot, args.record);
  if (sourceRef === null) throw new QuickCaptureError({ reason: "missing-source" });
  const sourceAbs = await resolveSource(args.boxRoot, sourceRef);
  await withCardLock(sourceAbs, async () => {
    // Re-resolved inside the lock so a move that finished while waiting is seen.
    const current = await findCaptureSource(args.boxRoot, args.record);
    if (current === null) throw new QuickCaptureError({ reason: "missing-source" });
    const cardRef = `${attachDirFor(current)}/${RECORDING_CARD}`;
    const abs = await resolveSource(args.boxRoot, cardRef);
    const parsed = parseCardText(await fs.readFile(abs, "utf8"), { source: abs, schemas: await createCardSchemaMap(args.boxRoot) });
    if (args.text !== undefined) {
      parsed.fields["transcript"] = args.text;
      delete parsed.fields["transcription-error"];
    } else {
      const previous = parsed.fields["transcription-error"];
      if (isRecord(previous) && previous["message"] === args.error && previous["permanent"] === (args.permanent === true)) return;
      parsed.fields["transcription-error"] = { permanent: args.permanent === true, message: args.error, "attempted-at": args.attemptedAt };
    }
    await writeFileAtomic(abs, { content: serializeCardText({ schema: parsed.schema, fields: parsed.fields }) });
    await stageAndCommitPaths(args.boxRoot, { paths: [cardRef], message: "Record quick capture transcription" });
  });
}
