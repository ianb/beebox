/**
 * A free TCP port for a child server to bind (docs/implemented-plans/small-dependency-sweep.md;
 * it replaces get-port). Binds port 0 on the default host, which is dual-stack,
 * so a port an IPv4 or IPv6 listener holds is never returned. The port is free
 * when returned, not reserved: a caller still races anyone else between this
 * and its own bind, as with get-port.
 *
 * Like get-port, it does not hand out the same port twice within 15 s in this
 * process, because a closed port is often the next one the OS gives out. The
 * check and the reservation run together after the bind, with no await
 * between them, so parallel calls get distinct ports.
 */

import net from "node:net";

const RESERVE_MS = 15_000;
const MAX_ATTEMPTS = 50;
const reserved = new Map<number, number>();

export class NoFreePortError extends Error {
  override name = "NoFreePortError";
  constructor() {
    super(`No free port after ${String(MAX_ATTEMPTS)} attempts`);
  }
}

function probe(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

/** `now` is injectable so the reservation window can be tested without waiting. */
export async function freePort(options?: { now?: () => number }): Promise<number> {
  const now = options?.now ?? Date.now;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const port = await probe();
    const at = now();
    for (const [held, since] of reserved) if (at - since >= RESERVE_MS) reserved.delete(held);
    if (port !== 0 && !reserved.has(port)) {
      reserved.set(port, at);
      return port;
    }
  }
  throw new NoFreePortError();
}
