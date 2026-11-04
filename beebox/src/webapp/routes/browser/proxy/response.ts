/**
 * What the browser proxy sends back to the person's browser
 * (docs/plans/shared-browser.md, Track C): the dashboard's response with its
 * paths rewritten under the box prefix, and the pages the proxy writes itself
 * when there is no dashboard to show.
 *
 * The dashboard is third-party code served on the box's own origin (the
 * accepted same-origin decision, "Failure modes"), so every HTML response
 * gets a CSP that keeps its script to its own files, and nothing the
 * dashboard sets may land on the box origin as a cookie.
 */

import type { IncomingHttpHeaders, OutgoingHttpHeaders } from "node:http";
import { promisify } from "node:util";
import zlib from "node:zlib";
import { escapeHtml } from "../../../../lib/escape-html.js";

export const BROWSER_PAGE_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'";

/**
 * Upstream response headers that are not passed on: hop-by-hop headers, the
 * dashboard's cookies (they would be set on the box origin), and its own CSP
 * (the proxy sets one on HTML).
 */
const DROPPED_RESPONSE_HEADERS = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "proxy-authenticate",
  "trailer",
  "set-cookie",
  "content-security-policy",
  "content-security-policy-report-only",
]);

/** Headers a rewritten body invalidates. */
const REWRITE_INVALIDATED = new Set(["content-length", "content-encoding", "etag"]);

/** The upstream headers to send on, without the ones a rewrite invalidates when `rewritten`. */
export function responseHeaders(upstream: IncomingHttpHeaders, rewritten: boolean): OutgoingHttpHeaders {
  const out: OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(upstream)) {
    if (value === undefined || DROPPED_RESPONSE_HEADERS.has(name)) continue;
    if (rewritten && REWRITE_INVALIDATED.has(name)) continue;
    out[name] = value;
  }
  return out;
}

/** An upstream `Content-Encoding` the proxy cannot decode. */
export class UnknownContentEncodingError extends Error {
  override name = "UnknownContentEncodingError";
  constructor(readonly encoding: string) {
    super(`The browser dashboard sent a body in an encoding the proxy cannot decode: ${encoding}`);
  }
}

const gunzip = promisify(zlib.gunzip);
const inflate = promisify(zlib.inflate);
const brotli = promisify(zlib.brotliDecompress);

/**
 * The body as text. The proxy asks for `identity`, so an encoded body means
 * the dashboard ignored that; it is decoded rather than rewritten as bytes.
 */
export async function decodeBody(body: Buffer, encoding: string | undefined): Promise<string> {
  switch ((encoding ?? "identity").trim().toLowerCase()) {
    case "identity":
    case "":
      return body.toString("utf8");
    case "gzip":
      return (await gunzip(body)).toString("utf8");
    case "deflate":
      return (await inflate(body)).toString("utf8");
    case "br":
      return (await brotli(body)).toString("utf8");
    default:
      throw new UnknownContentEncodingError(encoding ?? "");
  }
}

/** A page the proxy writes itself, for when the dashboard cannot be shown. */
export function messagePage({ title, detail }: { title: string; detail: string }): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem}pre{white-space:pre-wrap;background:#f4f1ec;padding:1rem}</style></head>
<body><h1>${escapeHtml(title)}</h1><pre>${escapeHtml(detail)}</pre></body>
</html>
`;
}

/**
 * The dashboard page with a notice at the top of its body, for a session
 * check that failed: the page still loads, so the person keeps what they had.
 */
export function withNotice(html: string, notice: string): string {
  const banner = `<div role="alert" style="position:relative;z-index:2147483647;padding:8px 12px;background:#fde8c8;color:#3b2a10;font:14px system-ui,sans-serif">${escapeHtml(notice)}</div>`;
  const body = /<body\b[^>]*>/i.exec(html);
  if (body === null) return banner + html;
  const end = body.index + body[0].length;
  return html.slice(0, end) + banner + html.slice(end);
}
