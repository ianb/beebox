/**
 * External-URL extraction + reachability checking for `cb validate --urls`.
 *
 * This is the network half of the feature. It is reached ONLY from the dedicated
 * `--urls` pass (and its non-blocking post-commit trigger) — never from the sync
 * markdown lint that the PostToolUse / pre-commit hooks call. Extraction is pure
 * and offline; only `checkUrl` touches the network.
 */

import { assertPublicHttpUrl, UnsafeProxyUrlError } from "../../webapp/routes/proxy-image.js";
import { invariant } from "../../lib/invariant.js";

/**
 * Matches an http(s) URL in raw card/markdown text. Excludes whitespace and the
 * delimiters that wrap URLs in markdown (`()`, `<>`, quotes) so a `[t](url)` or
 * `<url>` yields just the URL. Trailing sentence punctuation is trimmed in
 * `normalizeUrl`, not here.
 */
const URL_RE = /https?:\/\/[^\s"'()<>]+/g;

/** RFC 2606 / 6761 reserved domains + TLDs that never resolve to a real host. */
const RESERVED_HOST_RE = /(^|\.)(example\.(com|org|net)|invalid|test|localhost|example)$/;

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;
const DEFAULT_CONCURRENCY = 6;

/** A definitive-or-not reachability verdict for one URL. */
export interface UrlVerdict {
  url: string;
  /** `ok` — reachable; `broken` — hard 404/410/DNS; `transient` — inconclusive. */
  reason: "ok" | "broken" | "transient";
  /** HTTP status when we got one. */
  status: number | null;
  /** The method that produced the verdict. */
  method: "HEAD" | "GET" | null;
  /** Short human detail for the report. */
  detail: string;
}

/**
 * Strip the fragment and trailing sentence punctuation / stray close-paren from a
 * raw match, so `https://x/y).` and `https://x/y#top` dedupe to `https://x/y`.
 */
function normalizeUrl(raw: string): string {
  let url = raw.replace(/#.*$/, "");
  url = url.replace(/[!),.:;?\]]+$/, "");
  return url;
}

/** Every distinct normalized http(s) URL in a blob of card/markdown text. */
export function extractExternalUrls(text: string): Set<string> {
  const out = new Set<string>();
  for (const match of text.matchAll(URL_RE)) {
    const url = normalizeUrl(match[0]);
    if (url !== "") out.add(url);
  }
  return out;
}

/**
 * True if a URL is worth a network check: http(s) and not a reserved doc domain.
 * Private/loopback addresses are caught later by the SSRF guard in `checkUrl`.
 */
export function isCheckableUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (_e) {
    // A string our regex matched but `URL` rejects isn't a real target to check;
    // treating it as un-checkable (rather than broken) avoids false alarms on
    // template fragments like `https://${host}/`.
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  return !RESERVED_HOST_RE.test(parsed.hostname.toLowerCase());
}

/** Classify an HTTP status into our three buckets. */
function classifyStatus(status: number): UrlVerdict["reason"] {
  if (status === 404 || status === 410) return "broken";
  // 401/403 mean the resource exists but is gated — we can't prove it broken.
  // 429 + 5xx are server-side hiccups; retry later, never flag.
  if (status === 429 || status >= 500) return "transient";
  return "ok";
}

interface FetchOnce {
  status: number;
  /** Set when a 3xx needs another hop. */
  location: string | null;
}

/** One HEAD/GET request with a timeout, returning status + any redirect target. */
async function fetchOnce(url: string, method: "HEAD" | "GET"): Promise<FetchOnce> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method,
      redirect: "manual",
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (callback-box link checker)",
        // A bodyless GET fallback: ask for nothing, so servers that reject HEAD
        // still answer cheaply.
        ...(method === "GET" ? { Range: "bytes=0-0" } : {}),
      },
    });
    const location = resp.status >= 300 && resp.status < 400 ? resp.headers.get("location") : null;
    return { status: resp.status, location };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Check one URL: SSRF-guard it, HEAD it (GET fallback when HEAD is refused),
 * following redirects manually and re-validating each hop. Network failures and
 * server hiccups classify as `transient` (retry later); 404/410/DNS as `broken`.
 */
async function checkUrl(rawUrl: string): Promise<UrlVerdict> {
  let current: string;
  try {
    current = (await assertPublicHttpUrl(rawUrl)).href;
  } catch (e) {
    if (e instanceof UnsafeProxyUrlError) {
      // A host that doesn't resolve is genuinely broken; the other guard reasons
      // (private/scheme) shouldn't reach here (isCheckableUrl pre-filters), so
      // treat them as inconclusive rather than wrongly flagging a link.
      return e.reason === "host did not resolve"
        ? { url: rawUrl, reason: "broken", status: null, method: null, detail: "host did not resolve (DNS)" }
        : { url: rawUrl, reason: "transient", status: null, method: null, detail: e.reason };
    }
    throw e;
  }

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      let res = await fetchOnce(current, "HEAD");
      // Many servers reject HEAD outright — fall back to a bodyless GET.
      if (res.status === 405 || res.status === 501 || res.status === 403 || res.status === 400) {
        res = await fetchOnce(current, "GET");
      }
      if (res.location !== null) {
        if (hop === MAX_REDIRECTS) {
          return { url: rawUrl, reason: "transient", status: res.status, method: "HEAD", detail: "too many redirects" };
        }
        // Re-validate every hop — a redirect to a private address is the classic
        // SSRF bypass, and `assertPublicHttpUrl` also rejects an unresolvable hop.
        current = (await assertPublicHttpUrl(new URL(res.location, current).href)).href;
        continue;
      }
      const reason = classifyStatus(res.status);
      const method = res.status === 405 || res.status === 501 ? "GET" : "HEAD";
      return { url: rawUrl, reason, status: res.status, method, detail: `HTTP ${String(res.status)}` };
    }
    // Unreachable: the loop returns on every path, but TS wants a terminal value.
    return { url: rawUrl, reason: "transient", status: null, method: null, detail: "redirect loop" };
  } catch (e) {
    if (e instanceof UnsafeProxyUrlError) {
      return { url: rawUrl, reason: "broken", status: null, method: null, detail: `redirect target rejected: ${e.reason}` };
    }
    // Timeouts, connection resets, TLS errors — all inconclusive. Retry next run.
    const detail = e instanceof Error ? e.message : String(e);
    return { url: rawUrl, reason: "transient", status: null, method: null, detail };
  }
}

/**
 * Check many URLs with bounded concurrency so we never hammer a host or open
 * hundreds of sockets. Preserves input order in the returned verdicts.
 */
export async function checkUrls(urls: string[], { concurrency }: { concurrency?: number }): Promise<UrlVerdict[]> {
  const limit = concurrency ?? DEFAULT_CONCURRENCY;
  const verdicts: UrlVerdict[] = Array.from({ length: urls.length });
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= urls.length) return;
      const url = urls[i];
      invariant(url !== undefined, "i is within [0, urls.length) by the check above");
      verdicts[i] = await checkUrl(url);
    }
  }
  const workers = Array.from({ length: Math.min(limit, urls.length) }, () => worker());
  await Promise.all(workers);
  return verdicts;
}
