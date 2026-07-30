/**
 * git-annex pointer files.
 *
 * When an annexed file's content is not present in a repository, its
 * working-tree file holds a short text pointer instead of the bytes:
 *
 *     /annex/objects/SHA256E-s300000--2ee2c7d4….jpg
 *
 * Two very different situations produce that file, and they are
 * indistinguishable on disk: content that was never fetched (`git annex get`
 * hasn't run), and a checkout made without git-annex installed (no smudge
 * filter, so git wrote the pointer text verbatim). Both mean the same thing to
 * a reader — *these are not the bytes you asked for* — which is why one
 * predicate serves both the annex doctor and every content read path.
 *
 * The pointer is self-describing: the key carries the expected size and
 * SHA-256, so a caller can report what the content *should* be without
 * fetching it.
 */

/** A parsed git-annex pointer. */
export interface AnnexPointer {
  /** Full annex key, e.g. `SHA256E-s300000--2ee2c7….jpg`. */
  key: string;
  /** Expected content size in bytes, from the key's `-s<n>` field. */
  size: number;
  /** Expected SHA-256 hex digest, from the key's `--<hash>` field. */
  sha256: string;
}

/**
 * Longest pointer we will consider. Real pointers are ~100 bytes; the cap
 * keeps `isAnnexPointer` from reading a large file's worth of bytes before
 * deciding, and makes a "pointer" that is implausibly long fail closed.
 */
const MAX_POINTER_BYTES = 1024;

const POINTER_PREFIX = "/annex/objects/";

/**
 * Backend-qualified key with size and hash — the SHA256E/SHA256 family, which
 * is what `annex.largefiles` produces for us. Other backends (WORM, URL) do
 * not carry a content hash and are deliberately not matched: we would have
 * nothing trustworthy to report about them.
 */
const KEY_RE = /^(SHA256E?-s(\d+)--([\da-f]{64})(?:\.[^\s/]*)?)$/;

/**
 * Cheap first pass: could these bytes be a pointer at all? Checks the prefix
 * without decoding the whole buffer, so callers can skip `parseAnnexPointer`
 * on ordinary content.
 */
export function isAnnexPointer(bytes: Uint8Array): boolean {
  if (bytes.length > MAX_POINTER_BYTES) return false;
  return parseAnnexPointer(bytes) !== null;
}

/**
 * Parse annex pointer bytes into their key, expected size, and expected
 * SHA-256. Returns null for anything that is not a pointer — ordinary file
 * content, an empty file, or a pointer using a backend that carries no hash.
 *
 * git-annex writes the pointer line optionally followed by a trailing newline
 * and, in some versions, further advisory lines; only the first line is
 * meaningful, so trailing content is tolerated but never parsed.
 */
export function parseAnnexPointer(bytes: Uint8Array): AnnexPointer | null {
  if (bytes.length === 0 || bytes.length > MAX_POINTER_BYTES) return null;

  // A pointer is ASCII text. Decoding with fatal:true rejects binary content
  // (an ordinary JPEG) without inspecting it further.
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (_e) {
    /* ignore: non-UTF-8 bytes are ordinary binary content, not a pointer */
    return null;
  }

  const firstLine = text.split("\n", 1)[0];
  if (firstLine === undefined || !firstLine.startsWith(POINTER_PREFIX)) return null;

  const key = firstLine.slice(POINTER_PREFIX.length);
  const match = KEY_RE.exec(key);
  if (match === null) return null;

  const [, fullKey, sizeText, sha256] = match;
  if (fullKey === undefined || sizeText === undefined || sha256 === undefined) return null;

  const size = Number(sizeText);
  if (!Number.isSafeInteger(size)) return null;

  return { key: fullKey, size, sha256 };
}

/**
 * One-line description of absent content, for an error body or an agent-facing
 * message. Names the remedy because the reader is usually an agent deciding
 * what to do next.
 */
export function describeAbsentContent(pointer: AnnexPointer, relPath: string): string {
  return (
    `${relPath}: content not present locally (${pointer.size} bytes, sha256 ` +
    `${pointer.sha256.slice(0, 12)}…). Fetch it with \`git annex get ${relPath}\`.`
  );
}
