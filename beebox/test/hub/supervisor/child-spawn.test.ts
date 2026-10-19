// # Child IPC survives the launcher without inheriting hub secrets
//
// Use a real shell that execs Node, matching the `bbx` launcher's process boundary.
// The reload request and acknowledgement travel over IPC. Ambient hub secrets must
// remain absent even though execa normally extends the parent's environment.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { once } from "node:events";
import { defaultSpawnChild } from "../../../src/hub/supervisor/child-spawn.js";
import { buildChildEnv } from "../../../src/hub/supervisor/child-env.js";
import { createServer, type Server } from "node:http";
import assert from "node:assert/strict";
import { waitForHttp } from "../../../src/hub/child-process-utils.js";

// # Readiness rejects a listening maintenance response
function portOf(server: Server): number {
  const address = server.address();
  assert.ok(address && typeof address === "object", "server is listening on a TCP port");
  return address.port;
}

void test("line 13", async (t) => {
  t.teardown(async () => {
    try {
      child.kill();
      if (previousSecret === undefined) delete process.env.BBX_SESSION_SECRET;
      else process.env.BBX_SESSION_SECRET = previousSecret;
    } catch (error) {
      t.error(error);
    }
  });
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
  t.check(message, {
    type: "reload-request",
    leaked: false,
  });

  child.send({ type: "reload-now" });
  t.check((await child).stdout, "acknowledged");
});

void test("line 60", async (t) => {
  t.teardown(async () => {
    try {
      await new Promise((resolve) => server.close(resolve));
    } catch (error) {
      t.error(error);
    }
  });
  let responseCode = 503;
  const server = createServer((_request, response) => {
    response.writeHead(responseCode).end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  await t.checkThrows(async () => (await waitForHttp({ port: portOf(server), reqPath: "/healthz", timeoutMs: 50, label: "fixture" })), "HttpReadinessTimeoutError");

  responseCode = 200;
  await waitForHttp({ port: portOf(server), reqPath: "/healthz", timeoutMs: 2000, label: "fixture" });
  t.check(responseCode, 200);
});
