/**
 * One measured page load in a fresh, isolated browser context.
 *
 * A new browser context has an empty HTTP cache and no cookies, which is a
 * first visit. `cache: "warm"` loads the page once first and measures the
 * second load, which is a repeat visit. Network and CPU throttling apply to
 * the measured page only. See `docs/development/performance.md`.
 */
import * as fs from "node:fs/promises";
import { z } from "zod";
import { CdpPage, type CdpConnection } from "./cdp.js";
import { NetworkLog, type RequestTiming } from "./network-log.js";
import { OBSERVER_SCRIPT, collectPageMetrics, hasAppMarks, readMark, type PageMetrics } from "./page-metrics.js";

export interface NetworkProfile {
  latencyMs: number;
  downloadKbps: number;
  uploadKbps: number;
}

/** `none` is the local machine's own speed; the others are DevTools-style presets. */
export const NETWORK_PROFILES: Record<string, NetworkProfile | null> = {
  none: null,
  // A good phone connection to a remote server.
  "4g": { latencyMs: 60, downloadKbps: 9000, uploadKbps: 1500 },
  // Lighthouse's mobile "slow 4G".
  slow4g: { latencyMs: 150, downloadKbps: 1600, uploadKbps: 750 },
};

export interface PageLoadOptions {
  url: string;
  /** The `bbx_session` cookie value; scoped to the URL's origin. */
  sessionCookie: string;
  profile: NetworkProfile | null;
  cpuRate: number;
  cache: "cold" | "warm";
  /** The `bbx:*` mark that ends the wait (network quiet follows it). */
  untilMark: string;
  timeoutMs: number;
  /** When set, a DevTools performance trace of the measured load is written here. */
  tracePath: string | undefined;
}

export interface PageLoadResult extends PageMetrics {
  /** Navigation start to the last non-streaming response after the wait mark. */
  networkQuietMs: number | undefined;
  requestCount: number;
  transferredBytes: number;
  /** Main-thread time from `Performance.getMetrics` (ms). */
  scriptMs: number;
  layoutMs: number;
  requests: RequestTiming[];
  timedOut: boolean;
  /** The HTML's first byte as the network log saw it. Unlike the Navigation
   * Timing `ttfbMs`, this includes the emulated network latency. */
  documentTtfbMs: number | undefined;
}

class LoginRedirectError extends Error {
  constructor(location: string) {
    super(`the page redirected to ${location}: the session cookie was not accepted`);
    this.name = "LoginRedirectError";
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function openPage(cdp: CdpConnection): Promise<{ page: CdpPage; dispose: () => Promise<void> }> {
  const { browserContextId } = z.object({ browserContextId: z.string() }).parse(await cdp.send("Target.createBrowserContext", { params: { disposeOnDetach: true } }));
  const { targetId } = z.object({ targetId: z.string() }).parse(await cdp.send("Target.createTarget", { params: { url: "about:blank", browserContextId } }));
  const { sessionId } = z.object({ sessionId: z.string() }).parse(await cdp.send("Target.attachToTarget", { params: { targetId, flatten: true } }));
  const dispose = async (): Promise<void> => {
    await cdp.send("Target.disposeBrowserContext", { params: { browserContextId } });
  };
  return { page: new CdpPage(cdp, sessionId), dispose };
}

async function prepare(page: CdpPage, options: PageLoadOptions): Promise<void> {
  for (const domain of ["Network.enable", "Page.enable", "Runtime.enable", "Performance.enable"]) await page.send(domain);
  const url = new URL(options.url);
  await page.send("Network.setCookie", { name: "bbx_session", value: options.sessionCookie, url: url.origin, path: "/", httpOnly: true, secure: url.protocol === "https:" });
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: OBSERVER_SCRIPT });
  if (options.profile) {
    const kbps = (n: number): number => (n * 1000) / 8;
    await page.send("Network.emulateNetworkConditions", { offline: false, latency: options.profile.latencyMs, downloadThroughput: kbps(options.profile.downloadKbps), uploadThroughput: kbps(options.profile.uploadKbps) });
  }
  if (options.cpuRate > 1) await page.send("Emulation.setCPUThrottlingRate", { rate: options.cpuRate });
}

/** Navigates and waits for `untilMark`, then for one second with no request activity. */
async function navigateAndSettle(page: CdpPage, { options, network }: { options: PageLoadOptions; network: NetworkLog }): Promise<boolean> {
  await page.send("Page.navigate", { url: options.url });
  const deadline = Date.now() + options.timeoutMs;
  let timedOut = true;
  let until = options.untilMark;
  while (Date.now() < deadline) {
    if ((await readMark(page, until)) !== undefined) {
      timedOut = false;
      break;
    }
    // `bbx:entry` is marked before React mounts, so a mounted page without it
    // is a build without app marks: wait for the DOM composer milestone instead.
    if (until.startsWith("bbx:") && (await readMark(page, "dom:mounted")) !== undefined && !(await hasAppMarks(page))) until = "dom:composer";
    await sleep(25);
  }
  let quietSince = Date.now();
  let seen = network.count();
  const quietDeadline = Date.now() + 15_000;
  while (Date.now() < quietDeadline && Date.now() - quietSince < 1000) {
    await sleep(100);
    if (network.count() !== seen || network.inflight() > 0) {
      quietSince = Date.now();
      seen = network.count();
    }
  }
  return timedOut;
}

async function startTrace(page: CdpPage): Promise<void> {
  const categories = ["devtools.timeline", "disabled-by-default-devtools.timeline", "disabled-by-default-devtools.timeline.frame", "v8.execute", "blink.user_timing", "loading", "latencyInfo", "disabled-by-default-v8.cpu_profiler"];
  await page.send("Tracing.start", { transferMode: "ReturnAsStream", traceConfig: { includedCategories: categories } });
}

async function stopTrace(page: CdpPage, tracePath: string): Promise<void> {
  const complete = new Promise<string>((resolve) => {
    const off = page.cdp.onEvent((event) => {
      if (event.sessionId !== page.sessionId || event.method !== "Tracing.tracingComplete") return;
      off();
      resolve(z.object({ stream: z.string() }).parse(event.params).stream);
    });
  });
  await page.send("Tracing.end");
  const stream = await complete;
  const chunks: string[] = [];
  for (;;) {
    const chunk = z.object({ data: z.string(), eof: z.boolean() }).parse(await page.send("IO.read", { handle: stream }));
    chunks.push(chunk.data);
    if (chunk.eof) break;
  }
  await page.send("IO.close", { handle: stream });
  await fs.writeFile(tracePath, chunks.join(""));
}

const metricsSchema = z.object({ metrics: z.array(z.object({ name: z.string(), value: z.number() })) });

/** Main-thread durations of the current document, in ms (Chrome resets them on navigation). */
async function mainThreadMs(page: CdpPage): Promise<{ script: number; layout: number }> {
  const perf = metricsSchema.parse(await page.send("Performance.getMetrics"));
  const ms = (name: string): number => (perf.metrics.find((m) => m.name === name)?.value ?? 0) * 1000;
  return { script: ms("ScriptDuration"), layout: ms("LayoutDuration") };
}

export async function measurePageLoad(cdp: CdpConnection, options: PageLoadOptions): Promise<PageLoadResult> {
  const { page, dispose } = await openPage(cdp);
  const network = new NetworkLog(cdp, page.sessionId);
  try {
    await prepare(page, options);
    if (options.cache === "warm") {
      await navigateAndSettle(page, { options, network });
      network.reset();
    }
    if (options.tracePath !== undefined) await startTrace(page);
    const timedOut = await navigateAndSettle(page, { options, network });
    if (options.tracePath !== undefined) await stopTrace(page, options.tracePath);
    const metrics = await collectPageMetrics(page);
    if (metrics.location.includes("/auth/login")) throw new LoginRedirectError(metrics.location);
    const after = await mainThreadMs(page);
    const requests = network.timings(new URL(options.url).origin);
    const ends = requests.filter((r) => r.type !== "WebSocket" && r.endMs !== undefined).map((r) => r.endMs ?? 0);
    return {
      ...metrics,
      networkQuietMs: ends.length > 0 ? Math.max(...ends) : undefined,
      requestCount: requests.length,
      transferredBytes: requests.reduce((n, r) => n + (r.encodedBytes ?? 0), 0),
      scriptMs: Math.round(after.script),
      layoutMs: Math.round(after.layout),
      documentTtfbMs: requests.find((r) => r.type === "Document")?.ttfbMs,
      requests,
      timedOut,
    };
  } finally {
    network.stop();
    await dispose();
  }
}
