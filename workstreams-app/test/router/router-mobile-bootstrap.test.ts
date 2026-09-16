import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";

import {
  bootstrapMobileSessionCookie,
  type BootstrapOutcome,
  mobileBootstrapTarget,
} from "../../src/router/router-mobile-bootstrap.js";
import type { RouterAuthDecision } from "../../src/router/router-auth.js";

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
    const outcome = await bootstrapMobileSessionCookie({
      authorization: "Bearer device-token",
      backendPort: address.port,
      boxSlug: "test1",
      worktree: "main",
    });
    assert.deepEqual(outcome, {
      ok: true,
      cookies: ["bbx_mobile=signed; Max-Age=3600; Path=/main; HttpOnly; SameSite=Lax"],
    });
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

// --- why the box said no -----------------------------------------------------
// Every failure used to collapse to `null`, which is how a transient port race
// read as a revoked device pairing on 2026-09-15.

/** Serve one canned response on loopback, and hand back its port. */
async function boxReplying(
  t: { after: (fn: () => Promise<void>) => void },
  reply: { status: number; body?: string; setCookie?: string },
): Promise<number> {
  const server = http.createServer((_request, response) => {
    const headers: Record<string, string> = {};
    if (reply.setCookie !== undefined) headers["set-cookie"] = reply.setCookie;
    response.writeHead(reply.status, headers);
    response.end(reply.body ?? "");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return address.port;
}

function ask(backendPort: number): Promise<BootstrapOutcome> {
  return bootstrapMobileSessionCookie({
    authorization: "Bearer device-token",
    backendPort,
    boxSlug: "test1",
    worktree: "main",
  });
}

test("the box's own 401 is a rejection, carrying the box's own reason", async (t) => {
  const port = await boxReplying(t, {
    status: 401,
    body: JSON.stringify({ error: "Mobile device token is invalid or revoked" }),
  });
  assert.deepEqual(await ask(port), {
    ok: false,
    kind: "rejected",
    status: 401,
    reason: "Mobile device token is invalid or revoked",
  });
});

test("a plain-text refusal survives when the body is not JSON", async (t) => {
  const port = await boxReplying(t, { status: 403, body: "device is not paired with this box" });
  assert.deepEqual(await ask(port), {
    ok: false,
    kind: "rejected",
    status: 403,
    reason: "device is not paired with this box",
  });
});

test("a 404 is transient, not a bad token — it means the wrong process is on the port", async (t) => {
  // issues/bugs/2026-08-21-ipv4-ipv6-port-collision-serves-wrong-process.md:
  // a box can be handed a port another process already holds. Retrying
  // re-resolves the generation, so this must not tell the device to re-pair.
  const port = await boxReplying(t, { status: 404, body: "Cannot POST /test1/api/pairing/session" });
  assert.deepEqual(await ask(port), { ok: false, kind: "transient", detail: "box returned 404" });
});

test("a 5xx is transient", async (t) => {
  const port = await boxReplying(t, { status: 503 });
  assert.deepEqual(await ask(port), { ok: false, kind: "transient", detail: "box returned 503" });
});

test("a dead port is transient — the kill/restart race the retry loop exists for", async () => {
  // The bootstrap POST going to a port whose box child was replaced 30 seconds
  // into its life is the 2026-09-15 sequence. Port 9 (discard) is reserved and
  // nothing listens on it here, so the connection is refused the same way.
  const outcome = await ask(9);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.ok === false ? outcome.kind : "", "transient");
});

test("a 204 with no session cookie is a rejection that says so, not a token problem", async (t) => {
  const port = await boxReplying(t, { status: 204 });
  assert.deepEqual(await ask(port), {
    ok: false,
    kind: "rejected",
    status: 204,
    reason: "box accepted the device token but set no session cookie",
  });
});

test("an oversized error body is truncated rather than quoted whole", async (t) => {
  const port = await boxReplying(t, { status: 401, body: "x".repeat(5_000) });
  const outcome = await ask(port);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.ok === false && outcome.kind === "rejected" ? outcome.reason.length : -1, 200);
});
