/**
 * Get a page over plain HTTP for `bbx webpage`
 * (docs/plans/webpage-capture-tools.md).
 *
 * A redirect is followed only when it is the same page in another form. Any
 * other redirect stops here and goes back to the agent, which can read the
 * target first: that is how a sign-in redirect does not become a saved page.
 *
 * The headers are a desktop Chrome's, by the boxholder's decision (2026-11-01):
 * the agent acts for a person, as a browser does.
 */

import type { CapturedResponse } from "./response.js";

const BROWSER_HEADERS = {
  "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
};

const TIMEOUT_MS = 30_000;
const BODY_CAP_BYTES = 10 * 1024 * 1024;
const MAX_SAME_PAGE_HOPS = 5;

export type FetchOutcome =
  | { kind: "page"; response: CapturedResponse }
  | { kind: "redirect"; status: number; target: string; chain: string[] }
  | { kind: "failed"; message: string };

function webUrl(text: string): URL | null {
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch (_e) {
    return null;
  }
}

function pageForm(url: URL): string {
  const host = url.hostname.replace(/^www\./, "");
  const path = url.pathname.replace(/\/+$/, "");
  return `${host}${url.port === "" ? "" : `:${url.port}`}${path}${url.search}`;
}

/** True for `http:` to `https:`, adding or removing `www.`, or a trailing slash: one page, another form. */
export function isSamePageForm(from: URL, to: URL): boolean {
  if (from.protocol === "https:" && to.protocol !== "https:") return false;
  return pageForm(from) === pageForm(to);
}

async function readCapped(res: Response): Promise<Uint8Array | null> {
  if (res.body === null) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for await (const chunk of res.body) {
    bytes += chunk.length;
    if (bytes > BODY_CAP_BYTES) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function decode(body: Uint8Array, contentType: string | null): string {
  const charset = /charset=["']?([\w-]+)/i.exec(contentType ?? "")?.[1] ?? "utf-8";
  try {
    return new TextDecoder(charset).decode(body);
  } catch (_e) {
    return new TextDecoder().decode(body);
  }
}

export interface FetchInput {
  readonly url: string;
  /** Earlier addresses the agent followed from (`--from`), oldest first. */
  readonly from: readonly string[];
  /** Tests substitute the network here. */
  readonly fetchImpl?: typeof fetch;
}

export async function fetchPage({ url, from, fetchImpl }: FetchInput): Promise<FetchOutcome> {
  const request = fetchImpl ?? fetch;
  let current = webUrl(url);
  if (current === null) return { kind: "failed", message: `Not a web address: ${url}` };
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  const hops: string[] = [];
  for (;;) {
    let res: Response;
    try {
      res = await request(current, { redirect: "manual", headers: BROWSER_HEADERS, signal });
    } catch (e) {
      return { kind: "failed", message: `Could not get ${current.href}: ${e instanceof Error ? e.message : String(e)}` };
    }
    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (location !== null) {
      await res.body?.cancel();
      const chain = [...from, ...hops, current.href];
      let target: URL | null = null;
      try {
        target = new URL(location, current);
      } catch (_e) {
        // Reported below with the raw value.
      }
      if (target === null || webUrl(target.href) === null) {
        return { kind: "failed", message: `${current.href} redirects to something that is not a web address: ${location}` };
      }
      if (!isSamePageForm(current, target)) return { kind: "redirect", status: res.status, target: target.href, chain };
      if (hops.length >= MAX_SAME_PAGE_HOPS || chain.includes(target.href)) {
        return { kind: "failed", message: `Redirect loop: ${[...chain, target.href].join(" -> ")}` };
      }
      hops.push(current.href);
      current = target;
      continue;
    }
    const contentType = res.headers.get("content-type");
    if (contentType !== null && !/html|xml/i.test(contentType)) {
      await res.body?.cancel();
      return { kind: "failed", message: `${current.href} is not a web page: its type is ${contentType}` };
    }
    const body = await readCapped(res);
    if (body === null) return { kind: "failed", message: `${current.href} is over the ${String(BODY_CAP_BYTES / (1024 * 1024))} MB limit` };
    return {
      kind: "page",
      response: {
        url: current.href,
        requestedUrl: from[0] ?? url,
        redirectedFrom: [...from, ...hops],
        status: res.status,
        headers: Object.fromEntries(res.headers.entries()),
        contentType,
        html: decode(body, contentType),
        via: "http",
      },
    };
  }
}
