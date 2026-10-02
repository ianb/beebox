/**
 * Image proxy for external images that block hot-linking.
 *
 * Two callers retry through this endpoint when a direct image load fails:
 *   - Frozen page snapshots hot-link images to their original URLs (see the
 *     clerk extension's freeze-page.ts); the injected fallback script (in
 *     api-files.ts) swaps a broken <img> to this route.
 *   - Live markdown images (the frontend `Image` component's proxyFallbackSrc,
 *     built by view-url's `externalImageProxyUrl`) do the same in React.
 * Either way this fetches the image server-side (no Referer restriction) and
 * streams it back.
 *
 * The route is unauthenticated: frozen pages are sandboxed (opaque origin) so
 * their requests can't carry the box session cookie anyway, and it's only a
 * public image proxy. That makes SSRF the real risk: a page could carry an <img> pointing at an
 * internal address. Guards: http(s) only; the resolved host must be a public IP
 * (private / loopback / link-local / unique-local / CGNAT / multicast are
 * refused); redirects are followed manually and each hop re-validated; the
 * response must be an image; size and time are capped. Residual: it's still a
 * general public image proxy (bandwidth), acceptable for a hearth box.
 */

import type { FastifyInstance } from "fastify";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const MAX_PROXY_BYTES = 25 * 1024 * 1024;
const PROXY_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

/** Rejection reasons (referenced, not inline literals — keeps Error messages hardcoded). */
const REJECT = {
  malformed: "malformed URL",
  scheme: "only http(s) URLs are proxied",
  localHost: "local hostnames are not proxied",
  nonPublic: "resolves to a non-public address",
  noResolve: "host did not resolve",
} as const;

/** Thrown when a proxy target fails the SSRF/scheme guards. */
export class UnsafeProxyUrlError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super("Unsafe proxy target");
    this.name = "UnsafeProxyUrlError";
    this.reason = reason;
  }
}

function isBlockedV4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  if (a === undefined || b === undefined) return true;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local (incl. cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return a >= 224; // multicast / reserved
}

function isBlockedV6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fe80")) return true; // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique-local
  if (lower.startsWith("ff")) return true; // multicast
  if (lower.startsWith("::ffff:")) {
    // IPv4-mapped IPv6 — check the embedded v4.
    const v4 = lower.slice("::ffff:".length);
    if (isIP(v4) === 4) return isBlockedV4(v4);
  }
  return false;
}

/**
 * True when `ip` (a numeric literal) is in a range we must not let the server
 * reach: loopback, private, link-local, unique-local, CGNAT, unspecified, or
 * multicast/reserved. Pure — exported for tests.
 */
export function isBlockedAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return isBlockedV4(ip);
  if (kind === 6) return isBlockedV6(ip);
  return true; // not a literal IP — caller resolves first, so this means "block"
}

/**
 * Validate a proxy target: http(s) scheme, not an obvious local hostname, and
 * every resolved address public. Returns the parsed URL or throws
 * UnsafeProxyUrlError.
 */
export async function assertPublicHttpUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch (_e) {
    throw new UnsafeProxyUrlError(REJECT.malformed);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeProxyUrlError(REJECT.scheme);
  }
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new UnsafeProxyUrlError(REJECT.localHost);
  }
  if (isIP(host) !== 0) {
    if (isBlockedAddress(host)) throw new UnsafeProxyUrlError(REJECT.nonPublic);
    return url;
  }
  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(host, { all: true });
  } catch (_e) {
    throw new UnsafeProxyUrlError(REJECT.noResolve);
  }
  if (addresses.length === 0) throw new UnsafeProxyUrlError(REJECT.noResolve);
  for (const a of addresses) {
    if (isBlockedAddress(a.address)) throw new UnsafeProxyUrlError(REJECT.nonPublic);
  }
  return url;
}

interface RegisterProxyImageRoutesOptions {
  server: FastifyInstance;
}

export function registerProxyImageRoutes(options: RegisterProxyImageRoutesOptions): void {
  const { server } = options;

  server.get<{ Querystring: { url?: string } }>("/api/proxy-image", async (request, reply) => {
    const raw = request.query.url;
    if (typeof raw !== "string" || raw === "") {
      return reply.status(400).send({ error: "url query parameter required" });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);
    try {
      let current = await assertPublicHttpUrl(raw);
      let response: Response | null = null;
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        const resp = await fetch(current.href, {
          signal: controller.signal,
          redirect: "manual",
          headers: {
            // Server-side fetch with the image's own origin as Referer defeats
            // naive hot-link blockers; never forward the box session.
            Referer: current.origin + "/",
            "User-Agent": "Mozilla/5.0 (beebox image proxy)",
            Accept: "image/*,*/*;q=0.8",
          },
        });
        if (resp.status >= 300 && resp.status < 400) {
          const location = resp.headers.get("location");
          if (location === null || hop === MAX_REDIRECTS) {
            return reply.status(502).send({ error: "too many redirects" });
          }
          // Re-validate every hop — a redirect to an internal address is the
          // classic SSRF bypass.
          current = await assertPublicHttpUrl(new URL(location, current).href);
          continue;
        }
        response = resp;
        break;
      }
      if (response === null || !response.ok || response.body === null) {
        return reply.status(502).send({ error: "upstream did not return an image" });
      }
      const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
      if (!contentType.startsWith("image/")) {
        return reply.status(415).send({ error: "upstream is not an image" });
      }
      const declared = Number(response.headers.get("content-length") ?? "0");
      if (Number.isFinite(declared) && declared > MAX_PROXY_BYTES) {
        return reply.status(413).send({ error: "image too large" });
      }
      const reader = response.body.getReader();
      const chunks: Buffer[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_PROXY_BYTES) {
          await reader.cancel();
          return reply.status(413).send({ error: "image too large" });
        }
        chunks.push(Buffer.from(value));
      }
      return reply
        .header("Content-Type", contentType)
        .header("X-Content-Type-Options", "nosniff")
        .header("Cache-Control", "public, max-age=86400")
        .send(Buffer.concat(chunks));
    } catch (e) {
      if (e instanceof UnsafeProxyUrlError) {
        return reply.status(400).send({ error: e.reason });
      }
      console.warn(`[proxy-image] fetch failed for ${raw}:`, e instanceof Error ? e.message : e);
      return reply.status(502).send({ error: "could not fetch image" });
    } finally {
      clearTimeout(timer);
    }
  });
}
