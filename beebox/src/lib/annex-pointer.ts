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
  /** Backend name, e.g. `SHA256E`, `SHA512E`, `WORM`, `URL`. */
  backend: string;
  /** Expected size from the key's `-s<n>` field; null for backends that omit it. */
  size: number | null;
  /** Expected SHA-256 digest; null unless the key uses a SHA256 backend. */
  sha256: string | null;
}

/**
 * Longest pointer we will consider. Real pointers are ~100 bytes; the cap
 * keeps `isAnnexPointer` from reading a large file's worth of bytes before
 * deciding, and makes a "pointer" that is implausibly long fail closed.
 */
const MAX_POINTER_BYTES = 1024;

const POINTER_PREFIX = "/annex/objects/";

/**
 * A git-annex key: `BACKEND[-s<size>][-other fields]--<name>`.
 *
 * **Backend-independent on purpose.** An earlier version matched only the
 * SHA256/SHA256E family, reasoning that other backends carry no content hash so
 * there is "nothing trustworthy to report". That was the wrong question. The
 * job here is *"are these the bytes, or a stand-in for them?"* — a SHA512E,
 * SHA1E, WORM, or URL pointer is just as much a stand-in, and treating one as
 * real content is exactly the failure this module exists to prevent: it would
 * be served as an image, embedded in a published page, or uploaded to a
 * transcription API. Hash metadata is optional enrichment; detection is not.
 */
const KEY_RE = /^([A-Z][\dA-Z]*(?:-[^\s-]\S*?)*?)--(\S+)$/;

/** Size field (`-s<n>`) — present on most backends, absent on some. */
const SIZE_FIELD_RE = /-s(\d+)(?:-|$)/;

/** SHA-256 digests are the only ones we can report as `sha256`. */
const SHA256_BACKEND_RE = /^SHA256E?$/;

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

  const [, fields, name] = match;
  if (fields === undefined || name === undefined) return null;

  const backend = fields.split("-", 1)[0] ?? fields;
  const sizeMatch = SIZE_FIELD_RE.exec(fields);
  const sizeText = sizeMatch?.[1];
  const parsedSize = sizeText === undefined ? null : Number(sizeText);
  const size = parsedSize !== null && Number.isSafeInteger(parsedSize) ? parsedSize : null;

  // Only a SHA256 key's name is a SHA-256 digest. For any other backend the
  // name is something else entirely (a WORM timestamp, a URL), and reporting it
  // as `sha256` would be a lie a caller might act on.
  const digest = SHA256_BACKEND_RE.test(backend) ? (name.split(".", 1)[0] ?? "") : "";
  const sha256 = /^[\da-f]{64}$/.test(digest) ? digest : null;

  return { key, backend, size, sha256 };
}

/**
 * One-line description of absent content, for an error body or an agent-facing
 * message. Names the remedy because the reader is usually an agent deciding
 * what to do next.
 */
export function describeAbsentContent(pointer: AnnexPointer, relPath: string): string {
  const size = pointer.size === null ? "unknown size" : `${String(pointer.size)} bytes`;
  const hash = pointer.sha256 === null ? pointer.backend : `sha256 ${pointer.sha256.slice(0, 12)}…`;
  return `${relPath}: content not present locally (${size}, ${hash}). Fetch it with \`git annex get ${relPath}\`.`;
}
