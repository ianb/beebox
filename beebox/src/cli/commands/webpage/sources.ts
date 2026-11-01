/**
 * Where `bbx webpage save` gets a page other than a URL: the box browser, or
 * HTML already on disk.
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { gunzipSync } from "node:zlib";
import { PAGE_READ } from "../../../core/browser/page-read.js";
import type { CapturedResponse } from "../../../core/webpage/response.js";
import { postToBox } from "../../lib/browser-post.js";

/** Clerk snapshots reach 41 MB; the DOM for one takes far more than that. */
const HTML_FILE_CAP_BYTES = 64 * 1024 * 1024;

/** A failure to report to the agent as one line. */
export class WebpageSaveError extends Error {
  override name = "WebpageSaveError";
  constructor(what: { readonly detail: string }) {
    super(what.detail);
  }
}

export async function browserResponse(): Promise<CapturedResponse> {
  const posted = await postToBox("page", {});
  if (!posted.ok) throw new WebpageSaveError({ detail: posted.message });
  const page = PAGE_READ.safeParse(posted.json);
  if (!page.success) throw new WebpageSaveError({ detail: `bbx webpage save: the box server's reply has the wrong shape: ${posted.text.slice(0, 200)}` });
  if (!/^https?:\/\//i.test(page.data.url)) throw new WebpageSaveError({ detail: `The box browser is on no web page (${page.data.url}). Open one with bbx browser open.` });
  return { url: page.data.url, requestedUrl: page.data.url, redirectedFrom: [], status: null, headers: {}, contentType: "text/html", html: page.data.html, sha256: null, via: "browser" };
}

/** A page saved earlier, plain or gzipped. `url` says where it came from, because the file cannot. */
export async function fileResponse({ file, url, boxRoot }: { file: string; url: string; boxRoot: string }): Promise<CapturedResponse> {
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
  const html = bytes.toString("utf8");
  if (html.startsWith("/annex/objects/")) throw new WebpageSaveError({ detail: `bbx webpage save: ${file} is an annex pointer, and its content is not here; run git annex get first` });
  return { url, requestedUrl: url, redirectedFrom: [], status: null, headers: {}, contentType: "text/html", html, sha256: createHash("sha256").update(bytes).digest("hex"), via: "file" };
}
