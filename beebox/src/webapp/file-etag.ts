/**
 * The file version token shared by every surface that hands out or checks
 * file state: the /api/files/* read route (ETag header), view file
 * metadata (ViewFile.etag), and conditional writes (If-Match). One
 * encoding everywhere means a client can echo a token back verbatim and
 * the server compares strings, never re-deriving floats.
 */

export function fileEtag(stat: { mtimeMs: number; size: number }): string {
  return `W/"${stat.mtimeMs.toString(36)}-${stat.size.toString(36)}"`;
}
