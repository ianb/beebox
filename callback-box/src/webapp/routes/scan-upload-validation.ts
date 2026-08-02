/**
 * Request-shape validation and limits for the scan upload routes — everything
 * the two handlers can refuse from the path, headers and body alone, before any
 * bytes are read or written.
 *
 * Split from `scan-upload.ts` so the handlers stay about streaming and state
 * while the refusals sit together and are visibly side-effect free.
 *
 * WIRE CONTRACT (scan-upload): must match docs/scan-upload-contract.md — change both sides together.
 */

import * as path from "node:path";
import type { FastifyRequest } from "fastify";
import sanitize from "sanitize-filename";
import { z } from "zod";

/** Per-file cap. Above any real scan; a 413 says "this is not a scan". */
export const MAX_SCAN_BYTES = 50 * 1024 * 1024;

export const OVER_LIMIT_ERROR = `File exceeds the ${MAX_SCAN_BYTES}-byte scan upload limit`;

/** Batch cap on `check` — the uploader walks a folder, not a filesystem. */
const MAX_CHECK_HASHES = 500;

/** `X-Scan-Profile` is free-text client prose that lands on a card; capped here. */
export const MAX_PROFILE_LENGTH = 200;

const SHA256_PATTERN = /^[\da-f]{64}$/;

export const CheckBodySchema = z.object({
  hashes: z.array(z.string().regex(SHA256_PATTERN)).max(MAX_CHECK_HASHES),
});

export const CHECK_BODY_ERROR =
  `hashes must be an array of at most ${MAX_CHECK_HASHES} lowercase 64-character hex SHA-256 digests`;

/** Read a single string header, or undefined when absent or duplicated. */
export function header(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === "string" ? value : undefined;
}

/**
 * The quarantine filename's extension. The claimed extension is untrusted (the
 * whole point of validation is that it may lie), so it is sanitized down to a
 * short alphanumeric suffix — or dropped entirely — before it becomes a path.
 */
export function quarantineExtension(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  return /^\.[\da-z]{1,8}$/.test(ext) ? ext : ".bin";
}

export type PutPrelude =
  | { ok: true; sha256: string; originalFilename: string }
  | { ok: false; status: number; error: string };

/**
 * Everything the PUT can refuse from the path and headers alone, before a
 * single byte is read.
 */
export function parsePutPrelude(request: FastifyRequest<{ Params: { sha256: string } }>): PutPrelude {
  const sha256 = request.params.sha256;
  if (!SHA256_PATTERN.test(sha256)) {
    return { ok: false, status: 400, error: "The path segment must be a lowercase 64-character hex SHA-256 digest" };
  }
  const claimedName = header(request, "x-upload-filename");
  if (claimedName === undefined || claimedName.trim() === "") {
    return { ok: false, status: 400, error: "X-Upload-Filename header required" };
  }
  // A path in the header collapses to its basename before anything else sees
  // it, so a traversal attempt never reaches a path join.
  const originalFilename = sanitize(path.basename(claimedName)).trim();
  if (originalFilename === "" || originalFilename === "." || originalFilename === "..") {
    return { ok: false, status: 400, error: "X-Upload-Filename does not sanitize to a usable filename" };
  }

  // Content-Length is contractual, and checking it first turns a 50 MB mistake
  // into one refused header exchange instead of 50 MB of transferred bytes. The
  // stream is metered anyway, because a client can lie about this.
  const declaredRaw = header(request, "content-length")?.trim();
  const declared = declaredRaw === undefined || declaredRaw === "" ? Number.NaN : Number(declaredRaw);
  if (!Number.isInteger(declared) || declared < 0) {
    return { ok: false, status: 411, error: "Content-Length required" };
  }
  if (declared > MAX_SCAN_BYTES) {
    return { ok: false, status: 413, error: OVER_LIMIT_ERROR };
  }
  return { ok: true, sha256, originalFilename };
}
