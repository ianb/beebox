/** Read-only preparation of admitted material. No source or attachment writes. */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { createHash } from "node:crypto";
import { execa } from "execa";
import { z } from "zod";
import { parseRef, resolveRefPath } from "../../../shared/ref-path/core.js";
import { attachDirFor } from "../../../shared/attach-path.js";
import { errorMessage, errnoCode } from "../../../shared/error-guards.js";
import { invariant } from "../../../shared/invariant.js";
import { isCardFile, getBoxDir } from "../../../lib/paths/core.js";
import { createDoclingService, checkExtractionBounds, type DoclingService } from "../../../services/docling/core.js";
import { JEV_MAX_REQUEST_CHARS } from "../../../services/jev-wire.js";
import type { ScanVisionService } from "../../../services/scan-vision.js";
import { resolveScanVision } from "../../commands/scan-import/session.js";
import { probePdf, extractPdfText } from "../../pdf/probe.js";
import { compileInstructionSnapshot, type InstructionSnapshot } from "../snapshot.js";
import { packEvidence, scanRepresentations } from "./packing.js";

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const statusSchema = z.enum(["ready", "partial", "unavailable"]);
const partSchema = z.object({
  ref: z.string(), digest: digestSchema, mediaType: z.string(), method: z.string(), duplicateOf: z.string().optional(),
  toolVersion: z.string(), status: statusSchema, text: z.string(), omissions: z.array(z.string()),
});
export const evidenceSchema = z.object({
  version: z.literal(1),
  source: z.object({ ref: z.string(), digest: digestSchema, gitRevision: z.string().nullable(), attachmentRef: z.string().nullable() }),
  status: statusSchema, parts: z.array(partSchema).min(1),
  recipe: z.object({ adapterVersion: z.union([z.literal(1), z.literal(2)]), steps: z.array(z.string()), maxTextChars: z.number().int().positive(), maxRequestChars: z.number().int().positive().optional() }),
});
export type Evidence = z.infer<typeof evidenceSchema>;
type Part = Evidence["parts"][number];
export interface PrepareItemOptions {
  boxRoot: string;
  sourceRef: string;
  docling?: DoclingService;
  vision?: ScanVisionService;
  maxTextChars?: number;
  maxRequestChars?: number;
  instructions?: InstructionSnapshot;
  /** Reuse only adapter-compatible parts whose original bytes still match. */
  previousEvidence?: Evidence;
}

function sha256(bytes: Buffer): string { return createHash("sha256").update(bytes).digest("hex"); }
function resolve(boxRoot: string, ref: string): string {
  const parsed = parseRef(ref);
  invariant(parsed.fragment === undefined && parsed.query === undefined, "Preparation needs a file ref, without query or fragment");
  const relative = resolveRefPath({ fromPath: undefined, ref: parsed.path, kind: "markdown" });
  invariant(relative !== null, `Invalid evidence ref: ${ref}`);
  return path.join(boxRoot, relative);
}
async function exists(file: string): Promise<boolean> {
  // Keep lstat semantics instead of lib/file-exists: broken links count as present and EACCES must propagate.
  try { await fs.lstat(file); return true; }
  catch (error) { if (errnoCode(error) === "ENOENT") return false; throw error; }
}
async function listScope(directory: string): Promise<string[]> {
  if (!await exists(directory)) return [];
  const result: string[] = [];
  for (const entry of (await fs.readdir(directory, { withFileTypes: true })).toSorted((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await listScope(file));
    else result.push(file);
  }
  return result;
}
async function checkedRead({ boxRoot, file }: { boxRoot: string; file: string }): Promise<Buffer> {
  // Annex symlinks may point inside the repository; never follow an arbitrary external link.
  const real = await fs.realpath(file);
  const relative = path.relative(await fs.realpath(boxRoot), real);
  invariant(relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), `Evidence escapes box: ${file}`);
  return fs.readFile(real);
}

/** Revalidation covers added/removed attachments too, not just the primary card. */
export async function verifyEvidence(boxRoot: string, evidence: Evidence): Promise<void> {
  evidenceSchema.parse(evidence);
  for (const part of evidence.parts) {
    const bytes = await checkedRead({ boxRoot, file: resolve(boxRoot, part.ref) });
    invariant(sha256(bytes) === part.digest, `stale-decision: changed evidence ${part.ref}; prepare again`);
  }
  const source = await checkedRead({ boxRoot, file: resolve(boxRoot, evidence.source.ref) });
  invariant(sha256(source) === evidence.source.digest, "stale-decision: changed source; prepare again");
  if (evidence.source.attachmentRef !== null) {
    const files = await listScope(resolve(boxRoot, evidence.source.attachmentRef));
    const expected = evidence.parts.filter((part) => part.ref !== evidence.source.ref).map((part) => part.ref).toSorted();
    const actual = files.map((file) => `/${path.relative(boxRoot, file)}`).toSorted();
    invariant(JSON.stringify(expected) === JSON.stringify(actual), "stale-decision: attachment scope changed; prepare again");
  }
}

/** Keep headings, blocks, links, and table cell boundaries; do not fetch links. */
function htmlText(html: string): string {
  return html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/giu, "")
    .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/giu, "$2 ($1)")
    .replace(/<\/(?:p|div|h[1-6]|tr|li|section)>|<br\s*\/?>/giu, "\n")
    .replace(/<\/(?:td|th)>/giu, " | ").replace(/<[^>]*>/gu, "")
    .replace(/&nbsp;/gu, " ").replace(/&lt;/gu, "<").replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"').replace(/&#39;/gu, "'").replace(/&amp;/gu, "&").trim();
}

async function prepareImage({ file, part }: { file: string; part: Part }, options: PrepareItemOptions): Promise<void> {
      const selected = options.vision ? { vision: options.vision } : await resolveScanVision(options.boxRoot);
      if ("error" in selected) part.omissions.push(selected.error);
      else {
        const result = await selected.vision.analyzeBatch({ imagePaths: [file], boxholderContext: null });
        part.text = result.analyses.map((analysis) => [analysis.description, ...analysis.text_blocks.map((block) => block.text)].join("\n")).join("\n");
        part.method = "scan-vision";
        part.toolVersion = `${selected.vision.backend}:model-version-unreported`;
        for (const analysis of result.analyses) if (analysis.flag_for_review) part.omissions.push(analysis.flag_reason ?? "Vision requested review");
        if (part.text.trim() === "") part.omissions.push("Vision returned no semantic description or text");
      }
 }

function cachedPart(input: { ref: string; bytes: Buffer }, evidence: Evidence | undefined): Part | undefined {
  if (evidence?.recipe.adapterVersion !== 2) return undefined;
  return evidence.parts.find((part) => part.ref === input.ref && part.digest === sha256(input.bytes) && part.status === "ready" && part.text !== "" && !["duplicate-text", "provenance-only"].includes(part.method));
}

async function preparePart(input: { file: string; bytes: Buffer }, options: PrepareItemOptions): Promise<Part> {
  const { file, bytes } = input;
  const ref = `/${path.relative(options.boxRoot, file)}`;
  const cached = cachedPart({ ref, bytes }, options.previousEvidence);
  if (cached) return { ...cached, omissions: [...cached.omissions] };
  const part: Part = { ref, digest: sha256(bytes), mediaType: "application/octet-stream", method: "unsupported", toolVersion: "1", status: "unavailable", text: "", omissions: [] };
  const extension = path.extname(file).toLowerCase();
  try {
    if (extension === ".pdf") {
      part.mediaType = "application/pdf";
      const probe = await probePdf(file);
      if (probe.textLayerSource === "probed" && probe.textLayerQuality === "good") {
        part.text = await extractPdfText(file) ?? "";
        part.method = "pdf-native-text";
        part.toolVersion = (await execa("pdftotext", ["-v"], { reject: false })).stderr.split("\n")[0] ?? "poppler-version-unreported";
      }
      if (part.text.trim() === "") {
        const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "bbx-triage-"));
        try {
          const ocr = probe.textLayerQuality === "junk" || probe.textLayerSource === "assumed" ? "replace" : "regions";
          const extraction = await (options.docling ?? createDoclingService()).extract(file, { workDir: workspace, ocr, languages: null });
          part.method = `docling-${ocr}`;
          if (extraction.ok) {
            const bounded = await checkExtractionBounds(extraction.value);
            if (bounded.ok) { part.text = extraction.value.markdown; part.toolVersion = extraction.value.version; }
            else part.omissions.push(bounded.error);
          }
          else part.omissions.push(extraction.error);
        } finally { await fs.rm(workspace, { recursive: true, force: true }); }
      }
    } else if ([".png", ".jpg", ".jpeg", ".avif", ".webp", ".heic", ".gif", ".tiff", ".tif"].includes(extension)) {
      part.mediaType = `image/${extension.slice(1)}`;
      await prepareImage({ file, part }, options);
    } else if ([".card", ".md", ".txt", ".csv", ".json", ".yaml", ".yml", ".html", ".htm", ".xml", ".eml"].includes(extension)) {
      part.text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      part.mediaType = extension === ".html" || extension === ".htm" ? "text/html" : "text/plain";
      part.method = "utf8";
      if (part.mediaType === "text/html") { part.text = htmlText(part.text); part.method = "html-structure"; }
      if (extension === ".eml") {
        part.text = "";
        part.method = "mime-unparsed";
        part.omissions.push("Raw MIME is not decoded; encoded bodies and attachments require research");
      }
    } else part.omissions.push(`Unsupported media: ${extension || "no extension"}`);
  } catch (error) { part.omissions.push(`Preparation failed: ${errorMessage(error)}`); }
  if (/https?:\/\//u.test(part.text)) part.omissions.push("External links were not fetched");
  if (part.text.trim() === "") { part.status = "unavailable"; part.omissions.push("No readable content prepared"); }
  else part.status = part.omissions.length > 0 ? "partial" : "ready";
  return part;
}

function deferredMethod({
  file,
  ref,
  representations,
}: {
  file: string;
  ref: string;
  representations: ReturnType<typeof scanRepresentations>;
}): "provenance-only" | "page-deferred" | "pdf-deferred" | undefined {
  if (representations.sidecars.has(ref)) return "provenance-only";
  if (representations.pages.has(ref)) return "page-deferred";
  if (representations.owners.has(ref) && file.endsWith(".pdf")) return "pdf-deferred";
  return undefined;
}

async function noteMissingAttachments(part: Part, boxRoot: string): Promise<void> {
  if (!isCardFile(part.ref)) return;
  const refs = new Set(part.text.match(/\battach\/[^\s"'<>()[\]{}]+/gu));
  for (const ref of refs) {
    const relative = resolveRefPath({ fromPath: part.ref, ref: parseRef(ref).path, kind: "card" });
    if (relative === null || !await exists(path.join(boxRoot, relative))) {
      part.omissions.push(`Missing referenced attachment: ${ref}`);
      if (part.status === "ready") part.status = "partial";
    }
  }
}

export async function prepareItem(options: PrepareItemOptions): Promise<Evidence> {
  evidenceSchema.optional().parse(options.previousEvidence);
  const sourcePath = resolve(options.boxRoot, options.sourceRef);
  const sourceRef = `/${path.relative(options.boxRoot, sourcePath)}`;
  const attachmentPath = isCardFile(sourcePath) ? attachDirFor(sourcePath) : null;
  if (attachmentPath !== null) {
    for (const upstream of [getBoxDir(options.boxRoot, "inbox"), getBoxDir(options.boxRoot, "inboxIntake")]) {
      const candidate = path.join(upstream, path.basename(attachmentPath));
      invariant(candidate === attachmentPath || !await exists(candidate), `Stranded attachment scope: ${candidate}; repair before preparation`);
    }
  }
  const files = [sourcePath, ...attachmentPath === null ? [] : await listScope(attachmentPath)];
  // Prepared structured scan cards carry the usable reading order. Admit their
  // bodies before raw derivatives, but keep every underlying file in provenance.
  files.sort((a, b) => {
    const rank = (file: string): number => file === sourcePath ? 0 : file.endsWith(".pdf.card") ? 1 : path.basename(file) === "text-layer.txt" ? 2 : 3;
    return rank(a) - rank(b) || a.localeCompare(b);
  });
  const sourceBytes = await checkedRead({ boxRoot: options.boxRoot, file: sourcePath });
  const manifestRefs = files.map((file) => `/${path.relative(options.boxRoot, file)}`);
  const parts: Part[] = [];
  const maxTextChars = options.maxTextChars ?? 100_000;
  const maxRequestChars = options.maxRequestChars ?? JEV_MAX_REQUEST_CHARS;
  const instructions = options.instructions ?? await compileInstructionSnapshot(options.boxRoot);
  invariant(Number.isSafeInteger(maxTextChars) && maxTextChars > 0, "maxTextChars must be a positive integer");
  invariant(Number.isSafeInteger(maxRequestChars) && maxRequestChars > 0 && maxRequestChars <= JEV_MAX_REQUEST_CHARS, `maxRequestChars must be a positive integer no greater than ${String(JEV_MAX_REQUEST_CHARS)}`);
  for (const file of files) {
    const bytes = file === sourcePath ? sourceBytes : await checkedRead({ boxRoot: options.boxRoot, file });
    const ref = `/${path.relative(options.boxRoot, file)}`;
    const representations = scanRepresentations(parts, manifestRefs);
    const method = deferredMethod({ file, ref, representations });
    const part: Part = method === undefined ? await preparePart({ file, bytes }, options)
      : { ref, digest: sha256(bytes), mediaType: method === "provenance-only" ? "application/gzip" : method === "pdf-deferred" ? "application/pdf" : "image/avif", method, toolVersion: "1", status: method === "provenance-only" ? "ready" : "unavailable", text: "", omissions: [] };
    await noteMissingAttachments(part, options.boxRoot);
    parts.push(part);
  }
  // Keep each original part and digest while admitting readable content in
  // authority order. A duplicate points only to a copy already retained.
  const source = parts[0];
  invariant(source !== undefined, "Preparation must include source");
  const revision = await execa("git", ["rev-parse", "HEAD"], { cwd: options.boxRoot, reject: false });
  const evidence: Evidence = {
    version: 1,
    source: { ref: sourceRef, digest: source.digest, gitRevision: revision.exitCode === 0 ? revision.stdout.trim() : null, attachmentRef: attachmentPath === null ? null : `/${path.relative(options.boxRoot, attachmentPath)}` },
    status: "unavailable",
    parts, recipe: { adapterVersion: 2, steps: parts.map((part) => `${part.ref}: ${part.method}`), maxTextChars, maxRequestChars },
  };
  let packed = packEvidence(evidence, instructions);
  // Prefer existing analyzed text without re-reading its PDF pages. If the
  // owner representation was excluded, prepare deferred PDFs/pages and repack.
  // Each deferred image/PDF enters this fallback at most once.
  for (;;) {
    const deferred = packed.parts.filter((part) => part.method === "pdf-deferred" || part.method === "page-deferred");
    if (deferred.length === 0) break;
    for (const part of deferred) {
      const file = resolve(options.boxRoot, part.ref);
      const bytes = await checkedRead({ boxRoot: options.boxRoot, file });
      const index = parts.findIndex((candidate) => candidate.ref === part.ref);
      parts[index] = await preparePart({ file, bytes }, options);
    }
    packed = packEvidence(evidence, instructions);
  }
  await verifyEvidence(options.boxRoot, packed);
  return evidenceSchema.parse(packed);
}
