# Shutting the hub down does not wait forever on a live connection

`server.close()` stops accepting new connections and then waits for every
existing one to end. The hub serves WebSocket upgrades and keep-alive HTTP, so
a single open chat tab could hold that callback forever: the handler logged
"shutting down hub…" and hung until systemd's `TimeoutStopSec=60` expired and
SIGKILLed the control group
(`issues/bugs/2026-09-09-hub-shutdown-hits-the-sigterm-timeout.md`).

The cost was not just a 60-second outage. `supervisor.stopAll()` runs *after*
the close, and exists to SIGTERM each box child and wait for it — "a git killed
mid-index-write leaves the box unable to commit at all". Hanging here meant it
never ran on any deploy.

```ts setup
import * as http from "node:http";
import * as net from "node:net";
import { closeServer } from "../../src/cli/commands/hub.js";

/** A listening server plus one client socket held deliberately open. */
async function serverWithLiveConnection() {
  const server = http.createServer((_req, res) => res.end("ok"));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  const socket = net.connect(port, "127.0.0.1");
  await new Promise<void>((resolve) => socket.once("connect", () => resolve()));
  return { server, socket, port };
}
```

An open connection no longer blocks the close. The socket is never touched by
the test — `closeServer` is what ends it. It does not finish instantly: a
socket that connected without sending a request is not "idle" to Node, so it
survives `closeIdleConnections()` and waits out the 2s linger window before being
forced. What matters is that it is BOUNDED, and nowhere near the 8s deadline
or the old infinite wait.

```ts
const { server, socket } = await serverWithLiveConnection();
const started = Date.now();
await closeServer(server);
const elapsedMs = Date.now() - started;
JSON.stringify({ bounded: elapsedMs < 5_000, hitDeadline: elapsedMs >= 8_000, listening: server.listening })
=> {"bounded":true,"hitDeadline":false,"listening":false}
```

```ts continue
socket.destroy();
```

With no connections at all it returns immediately, so an idle hub is not made
slower by the guard that rescues a busy one.

```ts continue
const idle = http.createServer();
await new Promise<void>((resolve) => idle.listen(0, "127.0.0.1", () => resolve()));
const idleStart = Date.now();
await closeServer(idle);
Date.now() - idleStart < 1_000
=> true
```
