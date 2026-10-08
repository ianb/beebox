/**
 * Records a page's requests from CDP Network events, as times relative to
 * the document request.
 *
 * URLs are reduced to origin-relative paths without query strings: tRPC
 * inputs and session ids live in the query, and results may be measured
 * against a real production box. A tRPC batch keeps its procedure list,
 * which is in the path.
 */
import { z } from "zod";
import type { CdpConnection, CdpEvent } from "./cdp.js";

export interface RequestTiming {
  path: string;
  type: string;
  status: number | undefined;
  protocol: string | undefined;
  /** Milliseconds from the document request. */
  startMs: number;
  ttfbMs: number | undefined;
  endMs: number | undefined;
  /** Bytes on the wire (headers + encoded body). */
  encodedBytes: number | undefined;
  encoding: string | undefined;
  fromCache: boolean;
  failed: string | undefined;
}

const willBeSent = z.object({ requestId: z.string(), timestamp: z.number(), type: z.string().optional(), request: z.object({ url: z.string() }) });
const responseReceived = z.object({
  requestId: z.string(), timestamp: z.number(),
  response: z.object({ status: z.number(), protocol: z.string().optional(), headers: z.record(z.string(), z.string()), fromDiskCache: z.boolean().optional(), fromServiceWorker: z.boolean().optional(), fromPrefetchCache: z.boolean().optional() }),
});
const finished = z.object({ requestId: z.string(), timestamp: z.number(), encodedDataLength: z.number() });
const failedEvent = z.object({ requestId: z.string(), timestamp: z.number(), errorText: z.string(), canceled: z.boolean().optional() });

interface Raw {
  url: string; type: string; start: number; ttfb?: number; end?: number; status?: number; protocol?: string;
  bytes?: number; encoding?: string; fromCache: boolean; failed?: string;
}

function displayPath(url: string, origin: string): string {
  try {
    const u = new URL(url);
    return u.origin === origin ? u.pathname : `${u.origin}${u.pathname}`;
  } catch (_e) {
    return url;
  }
}

function headerValue(headers: Record<string, string>, name: string): string | undefined {
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  return key === undefined ? undefined : headers[key];
}

export class NetworkLog {
  private readonly raw = new Map<string, Raw>();
  private documentStart: number | undefined;
  private readonly unsubscribe: () => void;

  constructor(cdp: CdpConnection, private readonly sessionId: string) {
    this.unsubscribe = cdp.onEvent((event) => this.onEvent(event));
  }

  /** Forget everything seen so far (after a cache-priming load). */
  reset(): void {
    this.raw.clear();
    this.documentStart = undefined;
  }

  stop(): void {
    this.unsubscribe();
  }

  /** Requests still in flight, ignoring long-lived streams (WebSocket, tRPC subscriptions). */
  inflight(): number {
    return [...this.raw.values()].filter((r) => r.end === undefined && r.type !== "WebSocket" && r.type !== "EventSource").length;
  }

  count(): number {
    return this.raw.size;
  }

  timings(origin: string): RequestTiming[] {
    const t0 = this.documentStart ?? 0;
    const rel = (t: number | undefined): number | undefined => (t === undefined ? undefined : Math.round((t - t0) * 1000));
    return [...this.raw.values()]
      .filter((r) => r.start >= t0)
      .map((r) => ({
        path: displayPath(r.url, origin), type: r.type, status: r.status, protocol: r.protocol,
        startMs: rel(r.start) ?? 0, ttfbMs: rel(r.ttfb), endMs: rel(r.end), encodedBytes: r.bytes,
        encoding: r.encoding, fromCache: r.fromCache, failed: r.failed,
      }))
      .toSorted((a, b) => a.startMs - b.startMs);
  }

  private onEvent(event: CdpEvent): void {
    if (event.sessionId !== this.sessionId) return;
    switch (event.method) {
      case "Network.requestWillBeSent": {
        const p = willBeSent.parse(event.params);
        const type = p.type ?? "Other";
        if (type === "Document" && this.documentStart === undefined) this.documentStart = p.timestamp;
        this.raw.set(p.requestId, { url: p.request.url, type, start: p.timestamp, fromCache: false });
        return;
      }
      case "Network.responseReceived": {
        const p = responseReceived.parse(event.params);
        const r = this.raw.get(p.requestId);
        if (!r) return;
        Object.assign(r, {
          ttfb: p.timestamp, status: p.response.status, protocol: p.response.protocol,
          encoding: headerValue(p.response.headers, "content-encoding"),
          fromCache: p.response.fromDiskCache === true || p.response.fromServiceWorker === true || p.response.fromPrefetchCache === true,
        });
        return;
      }
      case "Network.loadingFinished": {
        const p = finished.parse(event.params);
        const r = this.raw.get(p.requestId);
        if (r) Object.assign(r, { end: p.timestamp, bytes: p.encodedDataLength });
        return;
      }
      case "Network.loadingFailed": {
        const p = failedEvent.parse(event.params);
        const r = this.raw.get(p.requestId);
        // A canceled request (the app aborting a streamed tRPC batch it no longer needs) is not a failure.
        if (r) Object.assign(r, { end: p.timestamp, failed: p.canceled === true ? undefined : p.errorText });
        return;
      }
      default:
        return;
    }
  }
}
