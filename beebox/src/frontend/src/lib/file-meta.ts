/**
 * Size and type of a box file served by `/api/files/*`, without its body.
 *
 * A HEAD request is not enough: behind Cloudflare, HEAD responses for
 * compressible types (JSON, text) arrive without `Content-Length`. A one-byte
 * Range request is answered with `Content-Range: bytes 0-0/<total>`, which
 * proxies pass through unchanged.
 */

import { RequestError } from "./errors";

export type FileMeta =
  /** Annexed but not present on this machine (the route's 409). */
  | { absent: true }
  /** `size` is null only when the response carried no usable length. */
  | { absent: false; size: number | null; contentType: string | null };

function rangeTotal(resp: Response): number | null {
  const match = /\/(\d+)$/.exec(resp.headers.get("content-range") ?? "");
  return match?.[1] === undefined ? null : Number(match[1]);
}

export async function fetchFileMeta(url: string, signal?: AbortSignal): Promise<FileMeta> {
  const resp = await fetch(url, { headers: { Range: "bytes=0-0" }, cache: "no-store", signal });
  if (resp.status === 409) return { absent: true };
  // An empty file has no byte 0: the route answers 416 with `bytes */0`.
  if (resp.status === 416) return { absent: false, size: rangeTotal(resp), contentType: null };
  if (!resp.ok) {
    const message = `Couldn’t read file info: ${String(resp.status)}`;
    throw new RequestError(message);
  }
  await resp.body?.cancel();
  const contentType = resp.headers.get("content-type");
  if (resp.status === 206) return { absent: false, size: rangeTotal(resp), contentType };
  // 200: the server ignored the Range (frozen pages are never range-served).
  const length = resp.headers.get("content-length");
  return { absent: false, size: length === null ? null : Number(length), contentType };
}
