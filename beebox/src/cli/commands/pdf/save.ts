/**
 * `bbx pdf save`: make a pdf card, at a path the caller chooses, from a URL or
 * a PDF file with its address (docs/plans/knowledge-base-tools.md, Track B).
 *
 * It runs in the agent's shell, so a URL reaches only what `curl` could. Exit
 * codes: 0 saved, 1 failed, 3 refused (the bytes are not a PDF), 4 a redirect
 * the agent should read first. Nothing is left behind on anything but exit 0.
 * No intake job is queued: the caller chose the place.
 */

import { createHash, randomBytes } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Command } from "commander";
import { assertAnnexBox } from "../../../core/annex/assert-annex-box.js";
import { writePdfCard } from "../../../core/pdf/write-card.js";
import { fetchPdf, REQUEST_HEADERS_NAME, type FetchedResource } from "../../../core/webpage/fetch.js";
import { ensureBoxTmpDir } from "../../../lib/box-tmp.js";
import { stageAndCommitPaths } from "../../../lib/git/core/operations.js";
import { BOX_DIRS, requireBoxRoot } from "../../../lib/paths/core.js";
import { safeFilename } from "../../../lib/safe-filename.js";
import type { PdfCaptureFields } from "../../../schemas/pdf.js";
import { attachDirFor } from "../../../shared/attach-path.js";
import { errnoCode } from "../../../shared/error-guards.js";
import type { DoclingService } from "../../../services/docling/core.js";
import { insideBox, parseMeta, SaveError, shellWord } from "../../lib/save-command.js";

const COMMAND = "bbx pdf save";
const EXIT_REFUSED = 3;
const EXIT_REDIRECT = 4;
const NAME_ATTEMPTS = 5;
const PDF_SUFFIX = ".pdf.card";
const PDF_MAGIC = "%PDF-";
/** Matches the fetch cap, so a file and a URL accept the same sizes. */
const FILE_CAP_BYTES = 200 * 1024 * 1024;

interface PdfSaveOptions {
  url?: string;
  from: string[];
  to?: string;
  name?: string;
  meta?: string;
  commit: boolean;
}

/** Injected in tests. */
export interface PdfSaveDeps {
  docling?: DoclingService | undefined;
  fetchImpl?: typeof fetch | undefined;
}

/** The PDF to save, as bytes on disk, and what is known of where it came from. */
interface Source {
  file: string;
  sha256: string;
  href: string;
  originalName: string;
  capture: PdfCaptureFields;
}

function fail(message: string): void {
  console.error(message);
  process.exitCode = 1;
}

function isWebAddress(text: string): boolean {
  return /^https?:\/\//i.test(text);
}

function checkFlags(source: string, options: PdfSaveOptions): void {
  if (isWebAddress(source)) {
    if (options.url !== undefined) throw new SaveError({ detail: `${COMMAND}: --url goes with a PDF file, not with a URL` });
  } else if (options.url === undefined || !isWebAddress(options.url)) {
    throw new SaveError({ detail: `${COMMAND}: give a URL, or a PDF file with --url <web address>` });
  }
  if (options.name !== undefined && (options.name.endsWith(PDF_SUFFIX) || safeFilename(options.name) !== options.name)) {
    throw new SaveError({ detail: `${COMMAND}: --name takes a plain name, with no folder or ${PDF_SUFFIX}: ${options.name}` });
  }
}

/** The last path segment of an address, without `.pdf`, or "". */
function lastSegment(address: string): string {
  let pathname: string;
  try {
    pathname = new URL(address).pathname;
  } catch (_e) {
    return "";
  }
  const segment = pathname.split("/").findLast((part) => part !== "") ?? "";
  try {
    return decodeURIComponent(segment);
  } catch (_e) {
    return segment;
  }
}

function withoutPdfExtension(name: string): string {
  return name.replace(/\.pdf$/i, "");
}

async function fileSource({ boxRoot, file, url }: { boxRoot: string; file: string; url: string }): Promise<Source | Refusal> {
  const absolute = path.resolve(boxRoot, file);
  let bytes: Buffer;
  try {
    if ((await fs.stat(absolute)).size > FILE_CAP_BYTES) throw new SaveError({ detail: `${COMMAND}: ${file} is over the ${String(FILE_CAP_BYTES / (1024 * 1024))} MB limit` });
    bytes = await fs.readFile(absolute);
  } catch (e) {
    if (e instanceof SaveError) throw e;
    throw new SaveError({ detail: `${COMMAND}: could not read ${file}: ${e instanceof Error ? e.message : String(e)}` });
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const refused = notPdf({ bytes, what: file });
  if (refused !== null) return refused;
  return { file: absolute, sha256, href: url, originalName: path.basename(absolute), capture: { via: "file", sha256 } };
}

/** Not a PDF is a refusal, not a failure: the server answered, and what it sent is no document. */
interface Refusal {
  refusal: string;
}

function notPdf({ bytes, what, contentType }: { bytes: Uint8Array; what: string; contentType?: string | null }): Refusal | null {
  if (Buffer.from(bytes.subarray(0, PDF_MAGIC.length)).toString("latin1") === PDF_MAGIC) return null;
  const type = contentType === undefined || contentType === null ? "" : ` (its type is ${contentType})`;
  return { refusal: `${what} is not a PDF${type}; it may be a sign-in page` };
}

function httpCapture(resource: FetchedResource): PdfCaptureFields {
  return {
    via: "http",
    sha256: resource.sha256,
    ...(resource.redirectedFrom.length === 0 ? {} : { redirectedFrom: resource.redirectedFrom }),
    requestHeaders: REQUEST_HEADERS_NAME,
  };
}

/** Write a new card under a name no other capture holds, and commit it unless told not to. */
async function saveNewCard(input: {
  boxRoot: string;
  dir: string;
  name: string | undefined;
  source: Source;
  capturedAt: string;
  meta: Record<string, unknown>;
  commit: boolean;
  deps: PdfSaveDeps;
}): Promise<{ cardRel: string; error: string | null }> {
  const { boxRoot, dir, name, source, capturedAt, meta, commit, deps } = input;
  const stamp = capturedAt.replace(/[.:]/g, "-").slice(0, 19);
  const stem = safeFilename(withoutPdfExtension(source.originalName), "Document");
  for (let attempt = 1; ; attempt += 1) {
    const cardRel = path.join(dir, `${name ?? `${stem}_${stamp}_${randomBytes(2).toString("hex")}`}${PDF_SUFFIX}`);
    let written;
    try {
      written = await writePdfCard({
        boxRoot,
        sourcePath: source.file,
        cardRel,
        via: { channel: "bbx-pdf-save", at: capturedAt },
        originalName: source.originalName,
        sources: [{ href: source.href, retrieved: capturedAt }],
        capture: { ...source.capture, ...(Object.keys(meta).length === 0 ? {} : { meta }) },
        docling: deps.docling,
        exclusive: true,
      });
    } catch (e) {
      if (errnoCode(e) === "EEXIST" && name !== undefined) throw new SaveError({ detail: `${COMMAND}: ${cardRel} already exists` });
      if (errnoCode(e) !== "EEXIST" || attempt >= NAME_ATTEMPTS) throw e;
      continue;
    }
    if (commit) {
      try {
        await stageAndCommitPaths(boxRoot, { paths: written.paths, message: `Save PDF: "${name ?? stem}"`, trailers: { "Created-By": "bbx-pdf-save" } });
      } catch (e) {
        // A failed save leaves nothing for a later sweep to commit.
        for (const rel of written.paths) await fs.rm(path.join(boxRoot, rel), { force: true });
        try {
          await fs.rmdir(path.join(boxRoot, attachDirFor(cardRel)));
        } catch (_e) {
          // A folder that still holds something is not ours to remove.
        }
        throw e;
      }
    }
    return { cardRel, error: written.error };
  }
}

/** Fetch to a file in the box's temp dir, which the caller removes. */
async function urlSource({ url, options, deps, scratch }: { url: string; options: PdfSaveOptions; deps: PdfSaveDeps; scratch: string }): Promise<Source | Refusal | null> {
  const fetched = await fetchPdf({ url, from: options.from, ...(deps.fetchImpl === undefined ? {} : { fetchImpl: deps.fetchImpl }) });
  if (fetched.kind === "failed") throw new SaveError({ detail: fetched.message });
  if (fetched.kind === "redirect") {
    const words = [COMMAND, shellWord(fetched.target), ...fetched.chain.flatMap((earlier) => ["--from", shellWord(earlier)])];
    console.log(`Redirects to ${fetched.target} (${String(fetched.status)}). Nothing was saved. Read the address; if it is a sign-in page, use the box browser. To follow:`);
    console.log(words.join(" "));
    process.exitCode = EXIT_REDIRECT;
    return null;
  }
  const refused = notPdf({ bytes: fetched.body, what: fetched.url, contentType: fetched.contentType });
  if (refused !== null) return refused;
  await fs.writeFile(scratch, fetched.body);
  return { file: scratch, sha256: fetched.sha256, href: fetched.url, originalName: lastSegment(fetched.url) || "document.pdf", capture: httpCapture(fetched) };
}

async function run({ source, options, deps }: { source: string; options: PdfSaveOptions; deps: PdfSaveDeps }): Promise<void> {
  checkFlags(source, options);
  const { retrieved, meta } = parseMeta({ text: options.meta, command: COMMAND });
  const boxRoot = await requireBoxRoot();
  const dir = await insideBox({ boxRoot, target: options.to ?? BOX_DIRS.inbox, flag: "--to", command: COMMAND });
  await assertAnnexBox(boxRoot, COMMAND);
  const scratch = path.join(await ensureBoxTmpDir(boxRoot), `pdf-save-${randomBytes(4).toString("hex")}.pdf`);
  try {
    const got = isWebAddress(source)
      ? await urlSource({ url: source, options, deps, scratch })
      : await fileSource({ boxRoot, file: source, url: options.url ?? "" });
    if (got === null) return;
    if ("refusal" in got) {
      console.log(`Refused: ${got.refusal}. Nothing was saved. If it is a sign-in page, use the box browser: bbx browser open <url>, or bbx browser ask.`);
      process.exitCode = EXIT_REFUSED;
      return;
    }
    const capturedAt = retrieved ?? new Date().toISOString();
    const saved = await saveNewCard({ boxRoot, dir, name: options.name, source: got, capturedAt, meta, commit: options.commit, deps });
    console.log(`Saved ${saved.cardRel}${options.commit ? "" : " (not committed)"}`);
    if (got.capture.redirectedFrom !== undefined) console.log(`Redirected: ${[...got.capture.redirectedFrom, got.href].join(" -> ")}`);
    if (saved.error !== null) console.log(`Note: text extraction failed (${saved.error}); the card holds the original. Retry with bbx pdf reanalyze ${shellWord(saved.cardRel)}.`);
  } finally {
    await fs.rm(scratch, { force: true });
  }
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

export function makePdfSaveCommand(deps: PdfSaveDeps): Command {
  return new Command("save")
    .description("Make a pdf card from a URL, or from a PDF file with its address")
    .argument("<source>", "The PDF's URL, or a PDF file (then give its address with --url)")
    .option("--url <address>", "Where the PDF file came from")
    .option("--from <url>", "An earlier address, when following a redirect (repeat for each)", collect, [])
    .option("--to <dir>", "The folder for the card (default: the inbox)")
    .option("--name <name>", "The card's file name, without .pdf.card (default: the file name and time)")
    .option("--meta <json>", 'Provenance to keep in capture.meta; "retrieved" (ISO time) becomes the capture time')
    .option("--no-commit", "Leave the card uncommitted, for a caller that commits in batches")
    .addHelpText("after", `
Exit codes: 0 saved, 1 failed, 3 refused (the reply is not a PDF, often a
sign-in page), 4 a redirect to read first.

The card is <folder>/<name>.pdf.card with the original beside it as
<name>.attach/source.pdf. Text is extracted with Docling; if that fails the card
is still saved with an error, and bbx pdf reanalyze <card> tries again.
No intake job is queued.
`)
    .action(async (source: string, options: PdfSaveOptions) => {
      try {
        await run({ source, options, deps });
      } catch (e) {
        if (!(e instanceof SaveError)) throw e;
        fail(e.message);
      }
    });
}
