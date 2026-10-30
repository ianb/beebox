/**
 * Scratch harness server: serves the probe pages and audio, appends whatever
 * the page POSTs to /log onto a JSONL file so a run needs no CDP driver.
 *
 *   node --experimental-strip-types server.ts <port> <audioDir> <logFile>
 */
import { appendFileSync, createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const [portArg, audioDir, logFile] = process.argv.slice(2);
if (!portArg || !audioDir || !logFile) throw new Error("usage: server.ts <port> <audioDir> <logFile>");
const here = dirname(fileURLToPath(import.meta.url));
const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".wav": "audio/wav", ".json": "application/json", ".wasm": "application/wasm" };

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (req.method === "POST" && url.pathname === "/log") {
    let body = "";
    req.on("data", (c: Buffer) => (body += c.toString()));
    req.on("end", () => {
      appendFileSync(logFile, `${body}\n`);
      res.writeHead(204).end();
    });
    return;
  }
  const rel = normalize(url.pathname).replace(/^\/+/, "");
  const file = rel.startsWith("audio/")
    ? join(audioDir, rel.slice(6))
    : rel.startsWith("whistle-files/")
      ? join(process.env.WHISTLE_DIR ?? "", rel.slice(14))
      : rel === "pcm-processor.worklet.js"
        ? join(here, "../../../beebox/src/frontend/src/lib/audio/pcm-processor.worklet.js")
        : join(here, rel);
  if (!existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, {
    "content-type": TYPES[extname(file)] ?? "application/octet-stream",
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-embedder-policy": "require-corp",
    "cross-origin-resource-policy": "cross-origin",
  });
  createReadStream(file).pipe(res);
}).listen(Number(portArg), "127.0.0.1");
