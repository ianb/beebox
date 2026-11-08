// `screenshot --card` through a real box browser host and Chrome
// (docs/implemented-plans/agent-self-view.md, "What will hold this"). A fixture page lays a
// card out like the app does: inside a panel that fills the window below a
// header and scrolls on its own, which is what clips a plain element capture.
// The card's bottom is a red block; the image must contain it at phone and
// desktop widths. A loading block (`aria-busy`) 5000px tall clears after
// three seconds: the capture must wait for it, or the card measures 7500px.
// A card taller than the capture limit is reported partial and cropped to
// what was painted.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import * as fs from "node:fs/promises";
import http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { PACKAGE_ROOT } from "../../../../src/lib/package-root.js";
import { ensureBrowserHost, stopBrowserHosts } from "../../../../src/core/browser/host/start.js";
import { sendBrowserCommand, sendFullOutputCommand } from "../../../../src/core/browser/command-socket.js";
import { captureCard, cardPanelId, MAX_CAPTURE_HEIGHT } from "../../../../src/core/browser/card-shot/run.js";

const execFileAsync = promisify(execFile);

function findChrome(): string | undefined {
  const given = process.env.AGENT_BROWSER_EXECUTABLE_PATH;
  if (given !== undefined && given !== "") return given;
  const root = path.join(os.userInfo().homedir, ".agent-browser", "browsers");
  if (!existsSync(root)) return undefined;
  for (const version of readdirSync(root).toSorted().toReversed()) {
    for (const candidate of [
      path.join(root, version, "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
      path.join(root, version, "chrome-linux64", "chrome"),
      path.join(root, version, "chrome"),
    ]) {
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

const chrome = findChrome();

/** A page shaped like the app: header, then a panel that fills the rest and scrolls. */
function fixture(cardPath: string, cardHeight: number): string {
  return `<!DOCTYPE html><html><head><title>fixture</title><style>
html,body{height:100%;margin:0}body{display:flex;flex-direction:column}
header{height:60px;flex:none}#p{flex:1;min-height:0;overflow:auto}
article{background:#eee}.body{height:${String(cardHeight - 120)}px}
.wide{white-space:nowrap;height:20px;overflow:visible}.bottom{height:100px;background:#f00}
</style></head><body><header>app</header><div id="p"><article>
<div id="loading" aria-busy="true" style="height:5000px">Loading view...</div>
<div class="wide">${"wide text that will not wrap ".repeat(8)}</div><div class="body"></div><div class="bottom"></div>
</article></div><script>document.getElementById('p').id=${JSON.stringify(cardPanelId(cardPath))};
setTimeout(()=>document.getElementById('loading').remove(),3000)</script></body></html>`;
}

/** The colour of the image's pixel at (x, y from the bottom). */
async function pixelFromBottom(imagePath: string, fromBottom: number): Promise<{ width: number; height: number; rgb: number[] }> {
  const { default: Sharp } = await import("sharp");
  const { data, info } = await Sharp(imagePath).raw().toBuffer({ resolveWithObject: true });
  const y = info.height - fromBottom;
  const offset = (y * info.width + Math.floor(info.width / 2)) * info.channels;
  return { width: info.width, height: info.height, rgb: [data[offset] ?? -1, data[offset + 1] ?? -1, data[offset + 2] ?? -1] };
}

void test("A card in a scrolling panel is captured whole at both widths; a card past the limit is partial", { skip: chrome === undefined ? "no Chrome for agent-browser (run `agent-browser install`)" : false }, async (t) => {
  process.env.AGENT_BROWSER_EXECUTABLE_PATH = chrome;
  const stateDir = await fs.mkdtemp("/tmp/bbxc-");
  const boxRoot = await fs.mkdtemp("/tmp/bbxcbox-");
  const site = http.createServer((req, res) => {
    const tall = (req.url ?? "").includes("tall.card");
    res.setHeader("content-type", "text/html");
    res.end(fixture(tall ? "tall.card" : "short.card", tall ? MAX_CAPTURE_HEIGHT + 2000 : 2500));
  });
  await new Promise<void>((resolve) => site.listen(0, "127.0.0.1", resolve));
  const address = site.address();
  const origin = `http://127.0.0.1:${String(typeof address === "object" && address !== null ? address.port : 0)}`;
  t.teardown(async () => {
    await stopBrowserHosts();
    site.close();
    await fs.rm(stateDir, { recursive: true, force: true });
    await fs.rm(boxRoot, { recursive: true, force: true });
  });
  // A stale dev bundle is rebuilt on first run; do that outside the host's 20 s start window.
  await execFileAsync(path.join(PACKAGE_ROOT, "bin", "bbx"), ["--version"]);
  const host = await ensureBrowserHost({ boxRoot, stateDir });
  const io = {
    send: (args: readonly string[]) => sendBrowserCommand(host.paths.cliSocket, args),
    sendFull: (args: readonly string[]) => sendFullOutputCommand(host.paths.cliSocket, args),
  };
  const box = { base: new URL(`${origin}/wt`), slug: "test1", outDir: path.join(boxRoot, "_tmp", "browser"), now: new Date() };

  const results: Record<string, unknown> = {};
  for (const width of [390, 1280]) {
    await io.send(["set", "viewport", String(width), "844"]);
    await io.send(["open", `${origin}/wt/test1/views/short.card`]);
    const shot = await captureCard(io, box);
    if (!shot.ok) throw new Error(shot.message);
    const bottom = await pixelFromBottom(shot.shot.imagePath, 50);
    const size = await io.sendFull(["eval", "`${String(innerWidth)}x${String(innerHeight)}`"]);
    results[`w${String(width)}`] = {
      fit: shot.output.split("\n")[1],
      overflow: shot.output.split("\n").some((line) => line.startsWith("overflow:")),
      imageHeight: bottom.height,
      bottomIsRed: bottom.rgb[0] === 255 && bottom.rgb[1] === 0 && bottom.rgb[2] === 0,
      // The viewport is put back after the capture.
      viewportAfter: JSON.parse(size.stdout),
    };
  }
  await io.send(["set", "viewport", "390", "844"]);
  await io.send(["open", `${origin}/wt/test1/views/tall.card`]);
  const tall = await captureCard(io, box);
  if (!tall.ok) throw new Error(tall.message);
  const tallImage = await pixelFromBottom(tall.shot.imagePath, 1);
  results.tall = {
    fit: tall.output.split("\n")[1],
    // Cropped to what was painted: no blank rows below the painted part.
    imageMatchesPainted: tallImage.height === Math.round(tall.shot.measure.painted.height * tall.shot.measure.dpr),
  };

  t.check(results, {
    w390: { fit: "card: short.card at 390px wide — whole card (390×2500)", overflow: true, imageHeight: 2500, bottomIsRed: true, viewportAfter: "390x844" },
    w1280: { fit: "card: short.card at 1280px wide — whole card (1280×2500)", overflow: true, imageHeight: 2500, bottomIsRed: true, viewportAfter: "1280x844" },
    tall: { fit: "card: tall.card at 390px wide — partial: the image shows 7940px of the card's 10000px height, from 0px down", imageMatchesPainted: true },
  });
});
