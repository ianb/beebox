/**
 * The live view's WebSocket, bridged from the person's browser to the
 * dashboard (docs/plans/shared-browser.md, Track C).
 *
 * The dashboard's viewport opens `/api/session/<port>/stream` on its own
 * origin: frames come down it and mouse and key input goes up it. The box
 * server owns WebSocket upgrades through `@fastify/websocket`, so instead of
 * handing the raw socket to a proxy, the route accepts the upgrade and opens
 * a second WebSocket to the dashboard over the relay socket, copying messages
 * both ways. Either side closing closes the other.
 *
 * The dashboard refuses non-loopback origins, so the upstream half says
 * `Origin: http://localhost`; the person's own origin was checked by the
 * route before the upgrade.
 */

import { WebSocket, type RawData } from "ws";

/** WebSocket close codes an endpoint may send; others (1005, 1006, 1015) only describe a close. */
function sendableCode(code: number): number {
  return code === 1000 || (code >= 1001 && code <= 1014 && code !== 1005 && code !== 1006) || (code >= 3000 && code <= 4999) ? code : 1000;
}

function closeQuietly(socket: WebSocket, { code, reason }: { code: number; reason: string }): void {
  if (socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) return;
  if (socket.readyState === WebSocket.CONNECTING) {
    socket.terminate();
    return;
  }
  socket.close(sendableCode(code), reason.slice(0, 120));
}

/**
 * Copy messages between `client` and the dashboard's stream for `port`. The
 * relay socket arrives as a promise because the host may still be starting;
 * the client's handlers are attached at once, so input sent meanwhile waits.
 */
export function bridgeStream(client: WebSocket, target: { relaySocket: Promise<string>; port: number }): void {
  // Input sent before the upstream opens waits here, in order.
  const pending: { data: RawData; isBinary: boolean }[] = [];
  let upstream: WebSocket | null = null;
  let clientClosed = false;
  client.on("message", (data, isBinary) => {
    if (upstream?.readyState === WebSocket.OPEN) upstream.send(data, { binary: isBinary });
    else pending.push({ data, isBinary });
  });
  client.on("close", (code, reason) => {
    clientClosed = true;
    if (upstream !== null) closeQuietly(upstream, { code, reason: reason.toString() });
  });
  // An error is followed by a close on the same socket, which ends the pair.
  client.on("error", (e) => console.warn("Box browser stream: client error:", e.message));
  void target.relaySocket.then(
    (relaySocket) => {
      if (clientClosed) return;
      upstream = connectUpstream({ client, relaySocket, port: target.port, pending });
    },
    (e: unknown) => {
      console.warn("Box browser stream: no browser host:", e);
      closeQuietly(client, { code: 1011, reason: "the box browser is not running" });
    },
  );
}

function connectUpstream({ client, relaySocket, port, pending }: { client: WebSocket; relaySocket: string; port: number; pending: { data: RawData; isBinary: boolean }[] }): WebSocket {
  const upstream = new WebSocket(`ws+unix://${relaySocket}:/api/session/${String(port)}/stream`, {
    origin: "http://localhost",
    headers: { host: "localhost" },
  });
  upstream.on("open", () => {
    for (const message of pending.splice(0)) upstream.send(message.data, { binary: message.isBinary });
  });
  upstream.on("message", (data, isBinary) => {
    if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
  });
  upstream.on("close", (code, reason) => closeQuietly(client, { code, reason: reason.toString() }));
  upstream.on("error", (e) => {
    console.warn("Box browser stream: dashboard error:", e.message);
    closeQuietly(client, { code: 1011, reason: "the browser dashboard stream failed" });
  });
  return upstream;
}
