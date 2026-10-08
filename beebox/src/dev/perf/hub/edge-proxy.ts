/**
 * A stand-in for the production edge (Cloudflare) in front of the local perf
 * hub.
 *
 * Production never sends the browser the hub's raw bytes: Cloudflare
 * compresses JS, CSS, HTML, and JSON on the fly (probed 2026-10-07: the
 * 2.39 MB entry script arrives as 731 KB brotli or 750 KB gzip). The hub
 * itself compresses nothing, so a throttled local measurement without this
 * proxy overstates transfer time about threefold. Brotli quality 4 is close
 * to what the edge produced; streamed tRPC responses and WebSocket upgrades
 * pass through untouched, as they do at the edge.
 */
import * as http from "node:http";
import * as net from "node:net";
import * as zlib from "node:zlib";
import type { Duplex } from "node:stream";

const COMPRESSIBLE = /javascript|css|html|json|svg|text\/plain/;

type Encoding = "br" | "gzip" | null;

function pickEncoding(acceptEncoding: string | undefined): Encoding {
  const accepted = acceptEncoding ?? "";
  if (/\bbr\b/.test(accepted)) return "br";
  if (/\bgzip\b/.test(accepted)) return "gzip";
  return null;
}

function compressor(encoding: "br" | "gzip"): zlib.BrotliCompress | zlib.Gzip {
  return encoding === "br"
    ? zlib.createBrotliCompress({ params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } })
    : zlib.createGzip({ level: 6 });
}

function forwardRequest({ req, res }: { req: http.IncomingMessage; res: http.ServerResponse }, targetPort: number): void {
  const upstream = http.request({ host: "127.0.0.1", port: targetPort, method: req.method, path: req.url, headers: req.headers }, (up) => {
    const type = String(up.headers["content-type"] ?? "");
    const isStream = (req.url ?? "").includes("/api/trpc");
    const encoding = pickEncoding(req.headers["accept-encoding"]);
    if (encoding === null || isStream || up.headers["content-encoding"] !== undefined || !COMPRESSIBLE.test(type)) {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
      return;
    }
    const headers = { ...up.headers, "content-encoding": encoding, vary: "accept-encoding" };
    delete headers["content-length"];
    res.writeHead(up.statusCode ?? 502, headers);
    up.pipe(compressor(encoding)).pipe(res);
  });
  upstream.on("error", (e) => {
    if (!res.headersSent) res.writeHead(502);
    res.end(`edge proxy: upstream error: ${e.message}`);
  });
  req.pipe(upstream);
}

function forwardUpgrade({ req, socket, head }: { req: http.IncomingMessage; socket: Duplex; head: Buffer }, targetPort: number): void {
  const upstream = net.connect(targetPort, "127.0.0.1", () => {
    const headerLines = Object.entries(req.headers).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v ?? ""}`);
    upstream.write(`${req.method ?? "GET"} ${req.url ?? "/"} HTTP/1.1\r\n${headerLines.join("\r\n")}\r\n\r\n`);
    upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
}

/** Listens on `listenPort` and forwards to the hub on `targetPort`. */
export async function startEdgeProxy(ports: { listenPort: number; targetPort: number }): Promise<http.Server> {
  const server = http.createServer((req, res) => forwardRequest({ req, res }, ports.targetPort));
  // Node's upgrade callback has three positional arguments; take them as one tuple.
  server.on("upgrade", (...[req, socket, head]: [http.IncomingMessage, Duplex, Buffer]) => forwardUpgrade({ req, socket, head }, ports.targetPort));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(ports.listenPort, "127.0.0.1", () => resolve());
  });
  return server;
}
