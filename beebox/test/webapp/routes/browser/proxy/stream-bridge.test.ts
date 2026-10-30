// # The live view's WebSocket bridge caps input queued before the dashboard answers
//
// docs/plans/shared-browser.md, Failure modes. The bridge accepts the
// person's socket at once and queues their input until the upstream stream
// opens; a host that never comes up must not let that queue grow without
// bound. Here the relay socket never arrives, so everything sent queues.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { WebSocket, WebSocketServer } from "ws";
import { bridgeStream, PENDING_CAP_BYTES } from "../../../../../src/webapp/routes/browser/proxy/stream-bridge.js";

void test("Input past 1 MiB before the upstream opens closes the client with 1009", async (t) => {
  const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  t.teardown(() => new Promise((resolve) => server.close(resolve)));
  server.on("connection", (socket) => bridgeStream(socket, { relaySocket: new Promise<string>(() => {}), port: 9222 }));
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;

  const client = new WebSocket(`ws://127.0.0.1:${String(port)}`);
  t.teardown(() => client.terminate());
  await new Promise<void>((resolve, reject) => {
    client.once("open", resolve);
    client.once("error", reject);
  });
  const closed = new Promise<{ code: number; reason: string }>((resolve) => {
    client.once("close", (code, reason) => resolve({ code, reason: reason.toString() }));
  });
  // Exactly the cap is still queued; one byte more is not.
  client.send(Buffer.alloc(PENDING_CAP_BYTES));
  client.send(Buffer.alloc(1));
  t.check(await closed, { code: 1009, reason: "too much input before the box browser was ready" });
});
