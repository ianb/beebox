# Child IPC survives the launcher without inheriting hub secrets

Use a real shell that execs Node, matching the `bbx` launcher's process boundary.
The reload request and acknowledgement travel over IPC. Ambient hub secrets must
remain absent even though execa normally extends the parent's environment.

```ts setup
import { once } from "node:events";
import { defaultSpawnChild } from "../../src/hub/child-spawn.js";
import { buildChildEnv } from "../../src/hub/child-env.js";
```

```ts
const previousSecret = process.env.BBX_SESSION_SECRET;
process.env.BBX_SESSION_SECRET = "hub-only-test-sentinel";
const child = defaultSpawnChild({
  bbxBinary: "/bin/bash",
  args: ["-c", 'exec "$@"', "launcher", process.execPath, "--input-type=module", "-e", `
    process.on("message", (message) => {
      if (message.type === "reload-now") {
        process.stdout.write("acknowledged");
        process.disconnect();
      }
    });
    process.send({ type: "reload-request", leaked: process.env.BBX_SESSION_SECRET !== undefined });
  `],
  cwd: process.cwd(),
  env: buildChildEnv({ sourceEnv: process.env, hubExtras: {} }),
});
child.catch(() => {});
const [message] = await once(child, "message");
JSON.stringify(message)
=> {"type":"reload-request","leaked":false}

child.send({ type: "reload-now" });
(await child).stdout
=> acknowledged
```

```ts cleanup
child.kill();
if (previousSecret === undefined) delete process.env.BBX_SESSION_SECRET;
else process.env.BBX_SESSION_SECRET = previousSecret;
```

# Readiness rejects a listening maintenance response

```ts setup
import { createServer } from "node:http";
import { waitForHttp } from "../../src/hub/child-process-utils.js";
```

```ts
let responseCode = 503;
const server = createServer((_request, response) => {
  response.writeHead(responseCode).end();
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
await waitForHttp({ port: server.address().port, reqPath: "/healthz", timeoutMs: 50, label: "fixture" })
=> throws HttpReadinessTimeoutError

responseCode = 200;
await waitForHttp({ port: server.address().port, reqPath: "/healthz", timeoutMs: 2000, label: "fixture" });
responseCode
=> 200
```

```ts cleanup
await new Promise((resolve) => server.close(resolve));
```
