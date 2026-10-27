// # A free port for a child server
//
// `freePort` replaced get-port (docs/plans/small-dependency-sweep.md). The hub
// gives each box child a port, and the dev router asks for several at once,
// so a port must be bindable, distinct across parallel calls, and not one an
// IPv6 listener already holds.
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any } from "@ianbicking/tap-check/check";
import net from "node:net";
import { freePort } from "../../src/lib/free-port.js";

function listen(port: number, host?: string): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(port, host, () => resolve(server));
  });
}

function close(server: net.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

test("a returned port can be bound", async (t) => {
  const port = await freePort();
  const server = await listen(port);
  t.teardown(() => close(server));
  // The default host is "::" where IPv6 is on and "0.0.0.0" where it is off.
  t.check(server.address(), { address: any(String), family: any(String), port });
});

test("parallel calls return distinct ports", async (t) => {
  const ports = await Promise.all(Array.from({ length: 8 }, () => freePort()));
  // A repeat would show up as the list differing from itself without repeats.
  t.check(ports, [...new Set(ports)]);
});

test("a port an IPv6-only listener holds is not returned", async (t) => {
  const held = await listen(0, "::1");
  t.teardown(() => close(held));
  const address = held.address();
  const heldPort = typeof address === "object" && address !== null ? address.port : 0;
  const ports = await Promise.all(Array.from({ length: 20 }, () => freePort()));
  t.check(ports.filter((port) => port === heldPort), []);
});
