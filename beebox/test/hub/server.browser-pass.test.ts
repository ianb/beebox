// The hub and the box browser pass (docs/plans/agent-self-view.md, Track A):
// a box's own pass passes the hub's wall for that box like the agent bearer,
// wins over a session cookie on the same request (no identity headers), lists
// only its own box at `/api/boxes`, opens a WebSocket only from the app's own
// origin, and is never forwarded to another box.

import { t as tap, test } from "tap";
import "@ianbicking/tap-check/tap";
import http from "node:http";
import net from "node:net";
import assert from "node:assert/strict";
import { z } from "zod";
import * as os from "node:os";
import * as path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { createHubServer } from "../../src/hub/server/core.js";
import { staticEndpointProvider } from "../../src/hub/endpoints.js";
import { signSession, COOKIE_NAME } from "../../src/webapp/auth.js";
import { BROWSER_PASS_COOKIE, signBrowserPass } from "../../src/core/browser/pass.js";
import { makeTmpBox } from "../helpers/test-helpers.js";

process.env.BBX_SESSION_SECRET = "test-session-secret-for-hub-browser-pass-test";
process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client-id-for-hub-browser-pass-test";
process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-client-secret-for-hub-browser-pass-test";
const authDir = await mkdtemp(path.join(os.tmpdir(), "bbx-hub-pass-"));
process.env.BBX_AUTH_FILE = path.join(authDir, "auth.json");
delete process.env.BBX_DEV_APP_URL;
delete process.env.PUBLIC_URL;

const BoxEcho = z.object({ url: z.string(), email: z.string().nullable(), cookie: z.string().nullable() });

function portOf(server: http.Server): number {
  const address = server.address();
  assert.ok(address && typeof address === "object", "server is listening on a TCP port");
  return address.port;
}

async function listen(server: http.Server): Promise<number> {
  await new Promise<void>((resolve) => { server.listen(0, "127.0.0.1", resolve); });
  return portOf(server);
}

/** A fake box that echoes what reached it and accepts any WebSocket upgrade. */
async function startFakeBox(): Promise<{ server: http.Server; origin: string }> {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      url: req.url,
      email: req.headers["x-bbx-authenticated-email"] ?? null,
      cookie: req.headers.cookie ?? null,
    }));
  });
  server.on("upgrade", (_req, socket: net.Socket) => {
    socket.end("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
  });
  const port = await listen(server);
  return { server, origin: `http://127.0.0.1:${port}` };
}

const boxA = await makeTmpBox();
const boxB = await makeTmpBox();
const fakeA = await startFakeBox();
const fakeB = await startFakeBox();
const hubServer = await createHubServer({
  endpoints: staticEndpointProvider([{ slug: "alpha", origin: fakeA.origin }, { slug: "beta", origin: fakeB.origin }]),
  getHealth: () => ({ status: "ok", boxes: [] }),
  hubSecret: "test-hub-secret-for-browser-pass",
  boxes: [{ slug: "alpha", boxRoot: boxA.root }, { slug: "beta", boxRoot: boxB.root }],
  baseUrl: "http://127.0.0.1",
});
const hubBase = `http://127.0.0.1:${await listen(hubServer)}`;
// The app origin the pass's WebSocket check compares with.
process.env.BBX_PUBLIC_URL = hubBase;

const passA = `${BROWSER_PASS_COOKIE}=${signBrowserPass(boxA.root, { ttlMs: 60_000, now: Date.now() }).value}`;
const passB = `${BROWSER_PASS_COOKIE}=${signBrowserPass(boxB.root, { ttlMs: 60_000, now: Date.now() }).value}`;
const ownerSession = `${COOKIE_NAME}=${signSession({ email: "owner@example.com", name: "Owner" })}`;

async function get(url: string, headers: Record<string, string>): Promise<{ status: number; echo: z.infer<typeof BoxEcho> | null }> {
  const response = await fetch(`${hubBase}${url}`, { headers: { accept: "application/json", ...headers }, redirect: "manual" });
  return { status: response.status, echo: response.status === 200 ? BoxEcho.parse(await response.json()) : null };
}

/** The status line of a raw WebSocket upgrade through the hub. */
async function upgradeStatus(url: string, headers: Record<string, string>): Promise<string> {
  const socket = net.connect(portOf(hubServer), "127.0.0.1");
  const lines = Object.entries({ host: "127.0.0.1", upgrade: "websocket", connection: "Upgrade", "sec-websocket-version": "13", "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==", ...headers })
    .map(([k, v]) => `${k}: ${v}`).join("\r\n");
  socket.write(`GET ${url} HTTP/1.1\r\n${lines}\r\n\r\n`);
  const first = await new Promise<string>((resolve) => { socket.once("data", (chunk: Buffer) => { resolve(chunk.toString("utf8").split("\r\n")[0] ?? ""); }); });
  socket.destroy();
  return first;
}

tap.teardown(async () => {
  for (const server of [hubServer, fakeA.server, fakeB.server]) server.closeAllConnections();
  await Promise.all([hubServer, fakeA.server, fakeB.server].map((server) => new Promise<void>((resolve) => { server.close(() => { resolve(); }); })));
  await boxA.cleanup();
  await boxB.cleanup();
});

void test("a box's own pass reaches that box, and wins over a session on the same request", async (t) => {
  t.check(await get("/alpha/views/x", { cookie: `${passA}; ${ownerSession}`, "sec-fetch-site": "none" }), {
    status: 200,
    // No identity header: the box browser acts as the agent, not the owner.
    echo: { url: "/alpha/views/x", email: null, cookie: `${passA}; ${ownerSession}` },
  });
});

void test("a pass from a same-site page, or for another box, does not pass the wall", async (t) => {
  t.check(
    {
      sameSite: (await get("/alpha/api/x", { cookie: passA, "sec-fetch-site": "same-site" })).status,
      otherBox: (await get("/beta/api/x", { cookie: passA, "sec-fetch-site": "same-origin" })).status,
    },
    { sameSite: 401, otherBox: 401 },
  );
});

void test("only the target box's own pass is forwarded", async (t) => {
  // Box beta's request carries both passes (a `/`-path cookie rides every box path).
  t.check(await get("/beta/api/x", { cookie: `a=1; ${passA}; ${passB}`, "sec-fetch-site": "same-origin" }), {
    status: 200,
    echo: { url: "/beta/api/x", email: null, cookie: `a=1; ${passB}` },
  });
});

void test("/api/boxes lists only the pass's own box", async (t) => {
  const response = await fetch(`${hubBase}/api/boxes`, { headers: { cookie: `${passA}; ${ownerSession}`, "sec-fetch-site": "same-origin" } });
  const body = z.object({ boxes: z.array(z.object({ slug: z.string() }).passthrough()) }).parse(await response.json());
  t.check(body.boxes.map((box) => box.slug), ["alpha"]);
});

void test("a WebSocket with a pass opens only from the app's own origin", async (t) => {
  t.check(
    {
      ownOrigin: await upgradeStatus("/alpha/api/trpc", { cookie: passA, origin: hubBase }),
      otherOrigin: await upgradeStatus("/alpha/api/trpc", { cookie: passA, origin: "https://sibling.example.com" }),
    },
    { ownOrigin: "HTTP/1.1 101 Switching Protocols", otherOrigin: "HTTP/1.1 401 Unauthorized" },
  );
});
