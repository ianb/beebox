/**
 * The dashboard relay (docs/plans/shared-browser.md, Track B): a Unix socket
 * that forwards each connection to the dashboard's loopback port.
 *
 * On a unit host the dashboard listens inside the box's private network
 * namespace, where nothing outside can reach it; the socket file lives in the
 * box user's state directory, which the filesystem shares, so it is the one
 * way in, and its mode (0600, in a 0700 directory) keeps it to the box user.
 * The relay copies bytes and knows nothing of HTTP, so WebSocket upgrades and
 * streamed responses pass through unchanged.
 */

import * as fs from "node:fs/promises";
import net from "node:net";
import { errnoCode } from "../../../shared/error-guards.js";

export interface Relay {
  close(): Promise<void>;
}

function pipeTo(port: number, open: Set<net.Socket>): (conn: net.Socket) => void {
  return (conn) => {
    const upstream = net.connect({ host: "127.0.0.1", port });
    open.add(conn);
    conn.on("close", () => open.delete(conn));
    conn.pipe(upstream);
    upstream.pipe(conn);
    // Either side failing ends the pair; a reset by a closing tab is ordinary.
    conn.on("error", (e) => {
      if (errnoCode(e) !== "ECONNRESET" && errnoCode(e) !== "EPIPE") console.warn("Relay client error:", e);
      upstream.destroy();
    });
    upstream.on("error", (e) => {
      console.warn(`Relay upstream 127.0.0.1:${String(port)} error:`, e);
      conn.destroy();
    });
  };
}

/** Listen on `socketPath` (replacing a stale file) and forward to `127.0.0.1:<port>`. */
export async function startRelay({ socketPath, port }: { socketPath: string; port: number }): Promise<Relay> {
  // A host that was killed leaves its socket file; listening on it fails with EADDRINUSE.
  await fs.rm(socketPath, { force: true });
  // Tracked so close() can end live streams; server.close() alone waits for them.
  const open = new Set<net.Socket>();
  const server = net.createServer(pipeTo(port, open));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });
  await fs.chmod(socketPath, 0o600);
  server.on("error", (e) => console.error("Relay socket error:", e));
  return {
    close: async () => {
      const closed = new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
      for (const conn of open) conn.destroy();
      await closed;
      await fs.rm(socketPath, { force: true });
    },
  };
}
