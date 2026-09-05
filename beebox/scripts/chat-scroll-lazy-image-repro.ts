/** Reproduce lazy user-image scroll drift in the shipping chat UI. */
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, "../.."), worktree = path.basename(root);
const boxName = "test1";
// Standalone probe configuration; do not import application environment initialization.
const boxRoot = process.env.BBX_SCROLL_TEST_BOX_ROOT
  ?? path.resolve(root, "../../box-worktrees", worktree, boxName, "content");
const output = path.resolve(process.argv[2] ?? path.join(root, "scratch/web-scroll-deeper", `repro-${Date.now()}`));
const sessionName = "delayed-images";
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type Geometry = z.infer<typeof geometrySchema>;
interface ArmResult {
  name: "above" | "below";
  initial: Geometry; beforeRelease: Geometry; afterDecode: Geometry;
  initialRequestCount: number; requestCount: number; growth: number;
  markerDrift: number; scrollCompensation: number;
}

class LazyImageReproError extends Error {
  constructor(cause: unknown) { super("Lazy image reproduction invariant failed", { cause }); this.name = "LazyImageReproError"; }
}
const geometrySchema = z.object({
  clientHeight: z.number(), complete: z.boolean(), currentSrc: z.string(), markerConnected: z.boolean(),
  imageHeight: z.number(), imageTop: z.number(), markerTop: z.number(), naturalHeight: z.number(), naturalWidth: z.number(), sameNode: z.boolean(),
  scrollHeight: z.number(), scrollTop: z.number(),
});
const serverEvents: Array<{ event: string; name?: string; elapsedMs?: number }> = [];
const requestCounts = new Map<string, number>();
const pending = new Map<string, Array<{ response: ServerResponse; startedAt: number }>>();
const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const name = url.pathname.slice(1).replace(/\.svg$/, "");
  requestCounts.set(name, (requestCounts.get(name) ?? 0) + 1);
  serverEvents.push({ event: "request", name });
  const rows = pending.get(name) ?? [];
  rows.push({ response, startedAt: performance.now() });
  pending.set(name, rows);
  response.on("close", () => {
    if (!response.writableEnded) serverEvents.push({ event: "closed-before-release", name });
  });
});
function encodedProjectDir(cwd: string): string {
  return cwd.replace(/[^\dA-Za-z]/g, "-");
}
function transcriptPath(sessionId: string): string {
  return path.join(homedir(), ".claude/projects", encodedProjectDir(boxRoot), `${sessionId}.jsonl`);
}
function numbered(label: string, count: number): string {
  return Array.from({ length: count }, (_, index) => `${String(index + 1).padStart(3, "0")} ${label}`).join("\n");
}
function userLine(input: { sessionId: string; imageUrl: string; placement: "above" | "below" }): string {
  const { sessionId, imageUrl, placement } = input;
  const marker = `${placement.toUpperCase()} STABLE MARKER INSIDE TALL USER MESSAGE`;
  const image = { type: "image", source: { type: "url", url: imageUrl } };
  const content = placement === "above"
    ? [
        { type: "text", text: numbered("pre image", 20) },
        image,
        { type: "text", text: `${numbered("between image and marker", 50)}\n${marker}\n${numbered("trailing", 140)}` },
      ]
    : [
        { type: "text", text: `${numbered("pre marker", 20)}\n${marker}\n${numbered("between marker and image", 50)}` },
        image,
        { type: "text", text: numbered("trailing", 140) },
      ];
  return `${JSON.stringify({
    type: "user",
    uuid: `lazy-image-${placement}-${sessionId}`,
    timestamp: "2026-09-04T23:30:00.000Z",
    message: { role: "user", content },
  })}\n`;
}

async function browse(...args: string[]): Promise<string> {
  const result = await execFileAsync(path.join(root, "bin/browse"), ["--session", sessionName, ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: 8 * 1024 * 1024,
    // Preserve the CLI environment while pinning the dedicated test box.
    env: { ...process.env, BROWSE_BOX: boxName },
  });
  return result.stdout.trim();
}

async function evaluate(script: string): Promise<unknown> {
  return JSON.parse(await browse("eval", "--no-wait", script));
}
async function awaitRendering(): Promise<void> {
  await evaluate(`new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('No rendered frame within 5 seconds')), 5000);
    requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(timer); resolve(null); }));
  })`);
}

function measurementScript(marker: string, initialize: boolean): string {
  return `(() => {
    const scroller = document.querySelector('[data-testid=chat-scroller]');
    const image = document.querySelector('img[alt="Attached image 2"]');
    if (!scroller || !image) throw Error('Shipping chat scroller or user image missing');
    const markerRange = () => {
      const walker = document.createTreeWalker(scroller, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) if (node.data.includes(${JSON.stringify(marker)})) break;
      if (!node) throw Error('Stable marker missing inside user message');
      const range = document.createRange();
      const start = node.data.indexOf(${JSON.stringify(marker)});
      range.setStart(node, start);
      range.setEnd(node, start + ${marker.length});
      return range;
    };
    if (${String(initialize)}) {
      const range = markerRange();
      const markerElement = document.createElement('span');
      markerElement.id = ${JSON.stringify(`bbx-lazy-image-marker-${marker.toLowerCase().startsWith("above") ? "above" : "below"}`)};
      range.surroundContents(markerElement);
      window.__lazyImageRepro = { image, markerElement };
    }
    const state = window.__lazyImageRepro;
    return {
      clientHeight: scroller.clientHeight, complete: image.complete, currentSrc: image.currentSrc,
      imageHeight: image.getBoundingClientRect().height,
      imageTop: image.getBoundingClientRect().top - scroller.getBoundingClientRect().top,
      markerTop: state.markerElement.getBoundingClientRect().top - scroller.getBoundingClientRect().top,
      markerConnected: state.markerElement.isConnected,
      naturalHeight: image.naturalHeight, naturalWidth: image.naturalWidth,
      sameNode: image === state.image, scrollHeight: scroller.scrollHeight, scrollTop: scroller.scrollTop,
    };
  })()`;
}

async function waitForRequest(name: string): Promise<void> {
  const deadline = performance.now() + 5_000;
  while ((requestCounts.get(name) ?? 0) === 0) {
    if (performance.now() >= deadline) {
      throw new LazyImageReproError({ reason: "image did not enter lazy range", name });
    }
    await wait(50);
  }
}

function release(name: string): void {
  const rows = pending.get(name) ?? [];
  if (rows.length !== 1) {
    throw new LazyImageReproError({ reason: "unexpected pending request count", name, count: rows.length });
  }
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#864"/></svg>';
  for (const row of rows) {
    row.response.writeHead(200, {
      "Content-Type": "image/svg+xml",
      "Content-Length": Buffer.byteLength(svg),
      "Cache-Control": "no-store",
    });
    row.response.end(svg);
    serverEvents.push({ event: "released", name, elapsedMs: Math.round(performance.now() - row.startedAt) });
  }
  pending.delete(name);
}

async function runArm(name: "above" | "below", sessionId: string): Promise<ArmResult> {
  const marker = `${name.toUpperCase()} STABLE MARKER INSIDE TALL USER MESSAGE`;
  await browse("network", "requests", "--clear");
  await browse("open", `/chat?session=${sessionId}&lazy-image-arm=${name}`);
  await awaitRendering();
  await evaluate("document.getElementById('bbx-composer-input')?.select(); null");
  await browse("press", "Backspace");
  await wait(200);
  await evaluate(measurementScript(marker, true));
  await wait(2_500);
  const initial = geometrySchema.parse(await evaluate(measurementScript(marker, false)));
  const initialRequestCount = requestCounts.get(name) ?? 0;
  if (initialRequestCount !== 0 || initial.currentSrc !== "" || initial.complete) {
    throw new LazyImageReproError({ reason: "image was not deferred", name, initialRequestCount, initial });
  }
  await browse("scroll", "up", String(Math.ceil(-initial.imageTop + 100)), "--selector", "[data-testid=chat-scroller]");
  await browse("screenshot", path.join(output, `${name}-lazy-trigger.png`));
  await waitForRequest(name);
  await evaluate(`(() => {
    const scroller = document.querySelector('[data-testid=chat-scroller]');
    const markerElement = window.__lazyImageRepro.markerElement;
    scroller.scrollTop += markerElement.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 106;
    return null;
  })()`);
  await wait(300);
  const beforeRelease = geometrySchema.parse(await evaluate(measurementScript(marker, false)));
  if (name === "above") await browse("screenshot", path.join(output, "above-before.png"));
  release(name);
  await evaluate(`(async () => {
    const image = document.querySelector('img[alt="Attached image 2"]');
    await image.decode();
    return null;
  })()`);
  await awaitRendering();
  const afterDecode = geometrySchema.parse(await evaluate(measurementScript(marker, false)));
  if (name === "above") await browse("screenshot", path.join(output, "above-after.png"));
  const requestCount = requestCounts.get(name) ?? 0;
  if (
    requestCount !== 1 || !afterDecode.sameNode || afterDecode.naturalWidth !== 800
    || afterDecode.naturalHeight !== 600
  ) {
    throw new LazyImageReproError({
      reason: "image request, node identity, or intrinsic dimensions were wrong",
      name,
      requestCount,
      afterDecode,
    });
  }
  const markerVisible = beforeRelease.markerTop >= 0 && beforeRelease.markerTop <= beforeRelease.clientHeight;
  const markerConnected = beforeRelease.markerConnected && afterDecode.markerConnected;
  const imageOnExpectedSide = name === "above"
    ? beforeRelease.imageTop + beforeRelease.imageHeight < beforeRelease.markerTop
    : beforeRelease.imageTop > beforeRelease.markerTop;
  const growth = afterDecode.imageHeight - beforeRelease.imageHeight;
  if (!markerVisible || !markerConnected || !imageOnExpectedSide || growth <= 50) {
    throw new LazyImageReproError({
      reason: "marker visibility, image placement, or positive growth setup was wrong",
      name,
      markerVisible,
      markerConnected,
      imageOnExpectedSide,
      growth,
      beforeRelease,
      afterDecode,
    });
  }
  return {
    name,
    initial,
    beforeRelease,
    afterDecode,
    initialRequestCount,
    requestCount,
    growth,
    markerDrift: afterDecode.markerTop - beforeRelease.markerTop,
    scrollCompensation: afterDecode.scrollTop - beforeRelease.scrollTop,
  };
}

let cleanupFailed = false;
const transcriptFiles: string[] = [];
try {
  await mkdir(output, { recursive: true });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new LazyImageReproError({ reason: "could not allocate image server port" });
  }

  const sessions = { above: randomUUID(), below: randomUUID() };
  for (const name of ["above", "below"] as const) {
    const file = transcriptPath(sessions[name]);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, userLine({
      sessionId: sessions[name],
      imageUrl: `http://127.0.0.1:${String(address.port)}/${name}.svg`,
      placement: name,
    }), {
      flag: "wx",
    });
    transcriptFiles.push(file);
  }

  const results = [await runArm("above", sessions.above), await runArm("below", sessions.below)];
  await writeFile(path.join(output, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
  await writeFile(
    path.join(output, "server.ndjson"),
    `${serverEvents.map((event) => JSON.stringify(event)).join("\n")}\n`,
  );
  const [above, below] = results;
  if (above === undefined || below === undefined) {
    throw new LazyImageReproError({ reason: "both image placement arms must run" });
  }
  const aboveStable = Math.abs(above.markerDrift) <= 2;
  const belowStable = Math.abs(below.markerDrift) <= 2 && Math.abs(below.scrollCompensation) <= 2;
  console.log(JSON.stringify({ output, aboveStable, belowStable, results }, null, 2));
  process.exitCode = aboveStable && belowStable ? 0 : 1;
} catch (error: unknown) {
  console.error("Lazy user-image reproduction setup or execution failed:", error);
  process.exitCode = 2;
} finally {
  server.close();
  for (const file of transcriptFiles) {
    try {
      await rm(file, { force: true });
    } catch (error: unknown) {
      cleanupFailed = true;
      console.error("Could not remove synthetic transcript:", error);
    }
  }
  try {
    await browse("close");
  } catch (error: unknown) {
    cleanupFailed = true;
    console.error("Could not close dedicated reproduction browser:", error);
  }
  if (cleanupFailed) process.exitCode = 2;
}
