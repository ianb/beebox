/**
 * Where `bbx webpage save` gets a page other than a URL: the box browser, or
 * HTML already on disk.
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { gunzipSync } from "node:zlib";
import { PAGE_READ } from "../../../core/browser/page-read.js";
import { decodeHtml, type ReceivedPage } from "../../../core/webpage/response.js";
import { postToBox } from "../../lib/browser-post.js";
import { SaveError as WebpageSaveError } from "../../lib/save-command.js";

/** Clerk snapshots reach 41 MB; the DOM for one takes far more than that. */
const HTML_FILE_CAP_BYTES = 64 * 1024 * 1024;

export { WebpageSaveError };

export async function browserResponse(): Promise<ReceivedPage> {
  const posted = await postToBox("page", {});
  if (!posted.ok) throw new WebpageSaveError({ detail: posted.message });
  const page = PAGE_READ.safeParse(posted.json);
  if (!page.success) throw new WebpageSaveError({ detail: `bbx webpage save: the box server's reply has the wrong shape: ${posted.text.slice(0, 200)}` });
  if (!/^https?:\/\//i.test(page.data.url)) throw new WebpageSaveError({ detail: `The box browser is on no web page (${page.data.url}). Open one with bbx browser open.` });
  return {
    body: Buffer.from(page.data.html),
    response: { url: page.data.url, requestedUrl: page.data.url, redirectedFrom: [], status: null, headers: {}, contentType: "text/html", html: page.data.html, sha256: null, via: "browser" },
  };
}

/** A page saved earlier, plain or gzipped. `url` says where it came from, because the file cannot. A card's own copy is UTF-8, whatever its `<meta>` still says. */
export async function fileResponse({ file, url, boxRoot, ownCopy }: { file: string; url: string; boxRoot: string; ownCopy: boolean }): Promise<ReceivedPage> {
  if (!/^https?:\/\//i.test(url)) throw new WebpageSaveError({ detail: `bbx webpage save: the page's address must be a web address: ${url}` });
  const absolute = path.resolve(boxRoot, file);
  let raw: Buffer;
  try {
    if ((await fs.stat(absolute)).size > HTML_FILE_CAP_BYTES) throw new WebpageSaveError({ detail: `bbx webpage save: ${file} is over the ${String(HTML_FILE_CAP_BYTES / (1024 * 1024))} MB limit` });
    raw = await fs.readFile(absolute);
  } catch (e) {
    if (e instanceof WebpageSaveError) throw e;
    throw new WebpageSaveError({ detail: `bbx webpage save: could not read ${file}: ${e instanceof Error ? e.message : String(e)}` });
  }
  let bytes = raw;
  if (raw[0] === 0x1f && raw[1] === 0x8b) {
    try {
      bytes = gunzipSync(raw, { maxOutputLength: HTML_FILE_CAP_BYTES });
    } catch (e) {
      throw new WebpageSaveError({ detail: `bbx webpage save: could not decompress ${file}: ${e instanceof Error ? e.message : String(e)}` });
    }
  }
  const contentType = ownCopy ? "text/html; charset=utf-8" : "text/html";
  const html = decodeHtml(bytes, contentType);
  if (html.startsWith("/annex/objects/")) throw new WebpageSaveError({ detail: `bbx webpage save: ${file} is an annex pointer, and its content is not here; run git annex get first` });
  return {
    body: bytes,
    response: { url, requestedUrl: url, redirectedFrom: [], status: null, headers: {}, contentType, html, sha256: createHash("sha256").update(bytes).digest("hex"), via: "file" },
  };
}
