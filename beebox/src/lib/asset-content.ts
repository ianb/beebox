/**
 * Reading asset bytes when the content might not be here.
 *
 * Under git-annex an asset's working-tree file holds either the bytes or a
 * ~100-byte pointer standing in for them. Every code path that opens an asset
 * has to tell those apart, and the failure mode of not doing so is silent and
 * ugly: a pointer served with `Content-Type: image/jpeg`, or 101 bytes of text
 * shipped to a transcription API as if it were audio.
 *
 * The tempting shape — fix each route as you find it — is what this module
 * exists to avoid. There are at least six independent readers (`/api/files`,
 * `/api/image`, capture transcription, publish rendering, figure compilation,
 * and box agents), they do not share a boundary, and a per-site fix leaves the
 * ones nobody remembered silently broken. One predicate, one result type.
 *
 * `probePointer` is for callers that already `stat`ed and want to bail before
 * doing header/range work; `readAssetContent` is for callers that just want
 * bytes.
 */

import * as fs from "node:fs/promises";
import { type AnnexPointer, parseAnnexPointer } from "./annex-pointer.js";
import { type Result, ok, err } from "./result.js";

/**
 * Above this size a file cannot be a pointer, so no read happens at all.
 * Keeps the probe from turning every asset request into an extra full read —
 * it only ever touches files small enough to be a pointer.
 */
const MAX_POINTER_BYTES = 1024;

/** Why an asset's bytes were not available. */
export type AssetContentError =
  /** The file holds a git-annex pointer; the content lives elsewhere (or nowhere). */
  | { kind: "not-present"; pointer: AnnexPointer };

export type AssetContent = Result<Uint8Array, AssetContentError>;

/**
 * Does this path hold a pointer rather than content? Returns the parsed
 * pointer, or null when the file holds real content.
 *
 * Pass `knownSize` when you have already `stat`ed — the common case in a route
 * that needs the size for `Content-Length` anyway — and the probe becomes free
 * for every file too large to be a pointer.
 *
 * Missing files return null rather than throwing: "not there at all" is a
 * different condition with its own handling (a 404), and conflating it with
 * "here but contentless" would make both harder to report accurately.
 */
export async function probePointer(
  absPath: string,
  opts?: { knownSize?: number | undefined }
): Promise<AnnexPointer | null> {
  const knownSize = opts?.knownSize;
  if (knownSize !== undefined && knownSize > MAX_POINTER_BYTES) return null;

  let bytes: Buffer;
  try {
    bytes = await fs.readFile(absPath);
  } catch (_e) {
    /* ignore: unreadable/absent files are the caller's 404 case, not ours */
    return null;
  }
  if (bytes.length > MAX_POINTER_BYTES) return null;
  return parseAnnexPointer(new Uint8Array(bytes));
}

/**
 * Read an asset's bytes, or report that the content is not present locally.
 *
 * Throws for every other failure (missing file, permissions) — those are
 * infrastructure errors the existing boundary handlers already catch, and
 * laundering them through the Result would blur the one distinction this type
 * exists to draw.
 */
export async function readAssetContent(absPath: string): Promise<AssetContent> {
  const bytes = new Uint8Array(await fs.readFile(absPath));
  const pointer = bytes.length <= MAX_POINTER_BYTES ? parseAnnexPointer(bytes) : null;
  if (pointer !== null) return err({ kind: "not-present", pointer });
  return ok(bytes);
}
