// # The hub proxies a scan token to `/api/scan/…` and nowhere else
//
// Scan-upload tokens are enforced at two independent boundaries. The hub is the
// outer one, and it adds a restriction the box child cannot: the PATH. A scan
// bearer aimed at `/<slug>/api/scan/…` verifies against that box's own store file
// and proxies; the same bearer on any other path never reaches the child, never
// cold-starts a box, and never earns hub-injected identity headers — it is a bare
// 401 (or a login redirect, for a page navigation) at the hub.

import { test } from "tap";
import "agent-doctest/tap";
import http from "node:http";
import type net from "node:net";
import assert from "node:assert/strict";
import { z } from "zod";
import * as os from "node:os";
import * as path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { createHubServer } from "../../src/hub/server/core.js";
import { staticEndpointProvider } from "../../src/hub/endpoints.js";
import { createScanToken, revokeScanToken } from "../../src/core/scan/tokens.js";
import { makeTmpBox } from "../helpers/test-helpers.js";

const HUB_SECRET = "test-hub-secret-for-scan-token-doctest";

process.env.BBX_SESSION_SECRET = "test-session-secret-for-scan-token-doctest";
process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client-id-for-scan-token-doctest";
process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-client-secret-for-scan-token-doctest";

const authDir = await mkdtemp(path.join(os.tmpdir(), "bbx-hub-scan-auth-"));
process.env.BBX_AUTH_FILE = path.join(authDir, "auth.json");
process.env.BBX_AUTH_SCRYPT_N = "1024";

/** What the fake box echoes back: the request URL and the credentials it received. */
const BoxEcho = z.object({
  url: z.string(),
  authorization: z.string().nullable(),
  xBbxAuthenticatedEmail: z.string().nullable(),
  xBbxHubSecret: z.string().nullable(),
});

function portOf(server: http.Server): number {
  const address = server.address();
  assert.ok(address && typeof address === "object", "server is listening on a TCP port");
  return address.port;
}

function listen(server: http.Server): Promise<void> {
  return new Promise<void>((resolve) => { server.listen(0, "127.0.0.1", resolve); });
}

function close(server: http.Server): Promise<void> {
  return new Promise<void>((resolve) => { server.close(() => { resolve(); }); });
}

/** Echoes back what the child would see, so the test can assert that no
 *  hub-injected identity rides along with a scan-token request. */
async function startFakeBox() {
  const sockets: net.Socket[] = [];
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      url: req.url,
      authorization: req.headers["authorization"] ?? null,
      xBbxAuthenticatedEmail: req.headers["x-bbx-authenticated-email"] ?? null,
      xBbxHubSecret: req.headers["x-bbx-hub-secret"] ?? null,
    }));
  });
  server.on("connection", (socket) => sockets.push(socket));
  await listen(server);
  return { server, sockets, origin: `http://127.0.0.1:${portOf(server)}` };
}

const box = await startFakeBox();
const scanBox = await makeTmpBox();
const scan = await createScanToken(scanBox.root, { name: "laptop-scansnap", createdBy: null });
const hubServer = await createHubServer({
  endpoints: staticEndpointProvider([{ slug: "test1", origin: box.origin }]),
  getHealth: () => ({ status: "ok", boxes: [] }),
  hubSecret: HUB_SECRET,
  boxes: [{ slug: "test1", boxRoot: scanBox.root }],
  baseUrl: "http://127.0.0.1",
});
const hubSockets: net.Socket[] = [];
hubServer.on("connection", (socket) => hubSockets.push(socket));
await listen(hubServer);
const hubBase = `http://127.0.0.1:${portOf(hubServer)}`;
const scanAuth = { authorization: `Bearer ${scan.token}` };

// ## A verified scan bearer proxies on a scan path, carrying no identity
//
// The bearer is forwarded untouched (the child verifies it again against the same
// store), and the hub attaches neither an authenticated email nor its secret —
// this credential is not a person and must not be able to impersonate one.
void test("The bearer is forwarded untouched (the child verifies it again against the sa...", async (t) => {
  t.teardown(async () => {
    try {
      delete process.env.GOOGLE_OAUTH_CLIENT_ID;
      delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
      delete process.env.BBX_SESSION_SECRET;
      delete process.env.BBX_AUTH_FILE;
      delete process.env.BBX_AUTH_SCRYPT_N;
      await rm(authDir, { recursive: true, force: true });
      await scanBox.cleanup();
      for (const socket of hubSockets) socket.destroy();
      for (const socket of box.sockets) socket.destroy();
      await close(hubServer);
      await close(box.server);
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L97
  const accepted = await fetch(`${hubBase}/test1/api/scan/check`, { method: "POST", headers: scanAuth });
  const body = BoxEcho.parse(await accepted.json());
  t.check(
    {
      status: accepted.status,
      url: body.url,
      forwarded: body.authorization === `Bearer ${scan.token}`,
      email: body.xBbxAuthenticatedEmail,
      secret: body.xBbxHubSecret,
    },
    {
    status: 200,
    url: "/test1/api/scan/check",
    forwarded: true,
    email: null,
    secret: null,
  },
  );

  // The PUT path is covered too — with the hash in its contract form (64 lowercase
  // hex).

  // doctest:L113
  const hash = "a".repeat(64);
  const put = await fetch(`${hubBase}/test1/api/scan/files/${hash}`, { method: "PUT", headers: scanAuth, body: "x" });
  t.check(put.status, 200);

  // Only those two shapes. The gate is not the `/api/scan/` subtree: a third route
  // under it, a subpath below a legal one, a trailing slash, and a malformed hash
  // are all just other protected surfaces, 401'd without waking the box.

  // doctest:L124
  const nonScan = ["/test1/api/scan/other", "/test1/api/scan", "/test1/api/scan/", "/test1/api/scan/check/", "/test1/api/scan/check/extra", `/test1/api/scan/files/${hash}/extra`, "/test1/api/scan/files/NOTAHASH", `/test1/api/scan/files/${"A".repeat(64)}`];
  const others = await Promise.all(nonScan.map((p) => fetch(`${hubBase}${p}`, { method: "POST", headers: scanAuth })));
  t.check(others.map((res) => res.status).join(" "), "401 401 401 401 401 401 401 401");

  // ## The same token on any other path, and bogus tokens, stop at the hub
  //
  // An API path gets a bare 401; a page navigation gets the ordinary login redirect.
  // Either way the request stops here: a scan token can never reach chat, tRPC, or
  // a WebSocket upgrade. A near-miss path does not count as a scan path. The prefix
  // must be a real path segment boundary, so `/api/scanner` is just another
  // protected surface.
  //
  // A syntactically valid bearer that verifies against nothing is rejected before
  // the endpoint is resolved, the same no-enumeration, no-box-wake property the
  // mobile gate has. A scan token minted for THIS box is worthless against a slug it
  // doesn't own.

  // doctest:L144
  const gates: Array<[string, string, string, Record<string, string>]> = [
    ["scan token, tRPC path", "GET", "/test1/api/trpc/health.check", scanAuth],
    ["scan token, events path", "GET", "/test1/events", scanAuth],
    ["scan token, page navigation", "GET", "/test1/browse/some-card", scanAuth],
    ["scan token, near-miss /api/scanner", "POST", "/test1/api/scanner/check", scanAuth],
    ["bogus token, scan path", "POST", "/test1/api/scan/check", { authorization: "Bearer not-a-real-scan-token" }],
    ["scan token, slug it doesn't own", "POST", "/nosuchbox/api/scan/check", scanAuth],
  ];
  const gateLines = [];
  for (const [label, method, p, headers] of gates) {
    gateLines.push(`${label} → ${(await fetch(`${hubBase}${p}`, { method, headers, redirect: "manual" })).status}`);
  }
  await t.checkText(gateLines.join("\n"), `scan token, tRPC path → 401
scan token, events path → 401
scan token, page navigation → 302
scan token, near-miss /api/scanner → 401
bogus token, scan path → 401
scan token, slug it doesn't own → 401`);

  // ## Revocation reaches the hub immediately
  //
  // Revocation takes effect at the hub immediately, because the hub reads the same
  // on-disk store the box child does.

  // doctest:L172
  t.check(await revokeScanToken(scanBox.root, "laptop-scansnap"), true);

  // doctest:L175
  const afterRevoke = await fetch(`${hubBase}/test1/api/scan/check`, { method: "POST", headers: scanAuth });
  t.check(afterRevoke.status, 401);
});
