/**
 * Inline validation for scan uploads — the gate between "bytes arrived" and
 * "bytes are quarantined as `pending`".
 *
 * Two layers, both sub-second, so the PUT can answer the uploader truthfully
 * instead of accepting everything and failing hours later in a worker:
 *
 * 1. **Magic-byte sniff** (`file-type`) against the accepted-type allowlist,
 *    AND agreement with the claimed filename extension. This is the type-
 *    smuggling defense: HTML bytes named `.pdf` never reach a PDF parser.
 * 2. **Structural check** — `qpdf --check` for PDFs (a subprocess, so it is
 *    time-boxed), a `sharp` decode for images. A truncated scan fails here.
 *
 * ClamAV is deliberately absent: the threat model is parser exploits and type
 * smuggling, not commodity malware, and nothing downstream executes these bytes.
 *
 * `qpdf` missing from the host is NOT a rejection. Rejecting would tell the
 * uploader its file is bad and let it dispose of the only copy on a server
 * misconfiguration; accepting would quarantine unvalidated bytes. So it is a
 * third outcome — `unavailable` — which the route turns into a retryable 503.
 */

import * as path from "node:path";
import { execa } from "execa";
import { fileTypeFromFile } from "file-type";
import Sharp from "sharp";
import { PDF_EXTENSION, SUPPORTED_IMAGE_EXTENSIONS } from "../commands/upload-helpers.js";
import { errorMessage } from "../../lib/error-guards.js";

/** Accepted extension → the magic-byte MIME types that may back it. */
const ACCEPTED_TYPES: Record<string, string[]> = {
  [PDF_EXTENSION]: ["application/pdf"],
  ".jpg": ["image/jpeg"],
  ".jpeg": ["image/jpeg"],
  ".png": ["image/png"],
  ".tif": ["image/tiff"],
  ".tiff": ["image/tiff"],
};

const ACCEPTED_EXTENSIONS = [PDF_EXTENSION, ...SUPPORTED_IMAGE_EXTENSIONS];

/** Awake-time budget for one `qpdf --check`. A scan PDF checks in well under a
 *  second; anything near this is a pathological or adversarial file. */
const QPDF_TIMEOUT_MS = 20_000;

/** How much subprocess/decoder output travels into a rejection reason (which
 *  ends up in a boxholder-facing question card). */
const REASON_DETAIL_LIMIT = 200;

export type ScanValidation =
  | { status: "valid" }
  /** Failed validation. `reason` is written to the sidecar and shown to a human. */
  | { status: "rejected"; reason: string }
  /** The validator itself could not run (missing `qpdf`). Never a verdict on
   *  the file — the route answers 503 and records nothing. */
  | { status: "unavailable"; detail: string };

let qpdfProbe: Promise<boolean> | null = null;

/**
 * Whether `qpdf` is on PATH. Probed once per process and cached: the answer is
 * a property of the host install, and re-spawning per upload would put a
 * process spawn in front of every PDF.
 */
export function qpdfAvailable(): Promise<boolean> {
  qpdfProbe ??= execa("qpdf", ["--version"], { timeout: QPDF_TIMEOUT_MS, reject: false })
    .then((result) => result.exitCode === 0)
    .catch(() => false)
    .then((available) => {
      // Announced once, at the probe, so an operator learns about it at boot
      // rather than from the first uploader's 503. A present qpdf says nothing.
      if (!available) {
        console.warn("[scan] qpdf is not installed; PDF scan uploads will be refused with 503 until it is");
      }
      return available;
    });
  return qpdfProbe;
}

function condense(text: string): string {
  const flat = text.replaceAll(/\s+/gu, " ").trim();
  return flat.length > REASON_DETAIL_LIMIT ? `${flat.slice(0, REASON_DETAIL_LIMIT)}…` : flat;
}

/**
 * `qpdf --check`: exit 0 is clean, 3 is warnings-only (common and harmless in
 * scanner output — a non-strict producer, not a broken file), and anything else
 * — 2 for errors, a signal, a crash — is a structural failure.
 */
async function checkPdf(filePath: string): Promise<ScanValidation> {
  if (!(await qpdfAvailable())) {
    return { status: "unavailable", detail: "qpdf is not installed on this server" };
  }
  const result = await execa("qpdf", ["--check", filePath], { timeout: QPDF_TIMEOUT_MS, reject: false });
  if (result.timedOut) {
    return {
      status: "rejected",
      reason: `the PDF structure check (qpdf --check) did not complete within ${QPDF_TIMEOUT_MS / 1000}s`,
    };
  }
  if (result.exitCode === 0 || result.exitCode === 3) return { status: "valid" };
  const detail = condense(`${result.stdout}\n${result.stderr}`);
  return { status: "rejected", reason: `the PDF is structurally broken — qpdf --check said: ${detail}` };
}

/**
 * A full `sharp` decode. `metadata()` alone reads only the header, so a file
 * truncated mid-scanline would pass it; downscaling to a thumbnail forces
 * libvips through every pixel — which is where a truncated scan fails — while
 * keeping the output (and libvips' tiled working set) small rather than
 * materializing a full-size raw buffer for a 50 MB scan.
 */
async function checkImage(filePath: string): Promise<ScanValidation> {
  try {
    await Sharp(filePath, { failOn: "error" }).resize({ width: 32, height: 32, fit: "inside" }).toBuffer();
    return { status: "valid" };
  } catch (e) {
    return { status: "rejected", reason: `the image could not be decoded: ${condense(errorMessage(e))}` };
  }
}

/**
 * Validate one quarantined file against the filename the uploader claimed.
 *
 * WIRE CONTRACT (scan-upload): must match docs/scan-upload-contract.md — change both sides together.
 */
export async function validateScanFile(opts: { filePath: string; filename: string }): Promise<ScanValidation> {
  const ext = path.extname(opts.filename).toLowerCase();
  const acceptedMimes = ACCEPTED_TYPES[ext];
  if (acceptedMimes === undefined) {
    const claimed = ext === "" ? "the file has no extension" : `extension ${ext} is not accepted`;
    return { status: "rejected", reason: `${claimed} (accepted: ${ACCEPTED_EXTENSIONS.join(", ")})` };
  }

  const sniffed = await fileTypeFromFile(opts.filePath);
  if (sniffed === undefined) {
    return {
      status: "rejected",
      reason: `the magic bytes match no known file type, but the filename claims ${ext}`,
    };
  }
  if (!acceptedMimes.includes(sniffed.mime)) {
    return {
      status: "rejected",
      reason: `magic bytes say ${sniffed.mime} but the extension is ${ext}`,
    };
  }

  return ext === PDF_EXTENSION ? checkPdf(opts.filePath) : checkImage(opts.filePath);
}
