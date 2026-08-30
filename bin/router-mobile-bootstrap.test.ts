import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";

import {
  bootstrapMobileSessionCookie,
  mobileBootstrapTarget,
} from "./router-mobile-bootstrap.js";
import type { RouterAuthDecision } from "./router-auth.js";

const allowedBox: RouterAuthDecision = {
  allow: true,
  route: { kind: "box", targetWorktree: "main", targetBox: "test1" },
};

test("mobileBootstrapTarget selects an authenticated box document navigation", () => {
  assert.deepEqual(
    mobileBootstrapTarget(
      {
        method: "GET",
        url: "/main/test1/chat?nativeComposer=1",
        headers: { authorization: "Bearer device-token" },
      },
      allowedBox,
    ),
    { authorization: "Bearer device-token", boxSlug: "test1", worktree: "main" },
  );
  assert.equal(
    mobileBootstrapTarget(
      {
        method: "GET",
        url: "/main/test1/api/chat/default",
        headers: { authorization: "Bearer device-token" },
      },
      allowedBox,
    ),
    null,
    "native API requests must not perform a second session exchange",
  );
});

test("bootstrapMobileSessionCookie exchanges the bearer and scopes the cookie over Vite assets", async () => {
  const requests: Array<{ method: string | undefined; authorization: string | undefined; url: string }> = [];
  const server = http.createServer((request, response) => {
    requests.push({
      method: request.method,
      authorization: request.headers.authorization,
      url: request.url ?? "",
    });
    response.writeHead(204, {
      "set-cookie": "bbx_mobile=signed; Max-Age=3600; Path=/test1; HttpOnly; SameSite=Lax",
    });
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const cookies = await bootstrapMobileSessionCookie({
      authorization: "Bearer device-token",
      backendPort: address.port,
      boxSlug: "test1",
      worktree: "main",
    });
    assert.deepEqual(cookies, [
      "bbx_mobile=signed; Max-Age=3600; Path=/main; HttpOnly; SameSite=Lax",
    ]);
    assert.deepEqual(requests, [
      {
        method: "POST",
        authorization: "Bearer device-token",
        url: "/test1/api/pairing/session",
      },
    ]);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
