// # The hub answers the phone's box screen from a sleeping box's snapshot
//
// A verified mobile credential asking `GET quickChat.home` of a box the
// provider reports asleep gets the box's last answer, marked `asleep`, and the
// box is not woken. Every other request takes the ordinary path
// (docs/implemented-plans/ios-box-screen-stale-list.md, Track 3).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import http from "node:http";
import type net from "node:net";
import assert from "node:assert/strict";
import * as os from "node:os";
import * as path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { createHubServer } from "../../../src/hub/server/core.js";
import type { Endpoint, EndpointProvider } from "../../../src/hub/endpoints.js";
import { createMobilePairingTicket, redeemMobilePairingTicket } from "../../../src/core/mobile/pairing.js";
import { removeHomeSnapshot, writeHomeSnapshot } from "../../../src/core/chat/routing/home-snapshot.js";
import { hashToken } from "../../../src/core/token-store.js";
import { refreshHubMeta } from "../../../src/core/hub-meta.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";

const HUB_SECRET = "test-hub-secret-for-home-snapshot-route";
process.env.BBX_SESSION_SECRET = "test-session-secret-for-home-snapshot-route";
const authDir = await mkdtemp(path.join(os.tmpdir(), "bbx-hub-home-snapshot-auth-"));
process.env.BBX_AUTH_FILE = path.join(authDir, "auth.json");
process.env.BBX_AUTH_SCRYPT_N = "1024";

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

// The box, once woken, answers with a marker so a test can tell it was reached.
const sockets: net.Socket[] = [];
const fakeBox = http.createServer((_req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ from: "box" }));
});
fakeBox.on("connection", (socket) => sockets.push(socket));
await listen(fakeBox);
const boxEndpoint: Endpoint = { slug: "test1", origin: `http://127.0.0.1:${portOf(fakeBox)}` };

/** A lazy provider: `get` reports the box only while awake; `ensureRunning` wakes it and counts. */
const state = { awake: false, wakes: 0 };
const endpoints: EndpointProvider = {
  get: (slug) => (slug === "test1" && state.awake ? boxEndpoint : undefined),
  slugs: () => ["test1"],
  ensureRunning: (slug) => {
    if (slug !== "test1") return Promise.resolve(undefined);
    state.wakes += 1;
    state.awake = true;
    return Promise.resolve(boxEndpoint);
  },
};

const box = await makeTmpBox();
refreshHubMeta(box.root);
const ticket = createMobilePairingTicket(box.root);
const redeemed = await redeemMobilePairingTicket(box.root, { pairingToken: ticket.token, deviceLabel: "test mobile" });
if (!redeemed) throw new Error("test mobile pairing failed");
const deviceToken = redeemed.deviceToken;
const mobile = { authorization: `Bearer ${deviceToken}` };
// A paired device the snapshot does not list: its pairer lost access before the box slept.
const otherTicket = createMobilePairingTicket(box.root);
const other = await redeemMobilePairingTicket(box.root, { pairingToken: otherTicket.token, deviceLabel: "removed member" });
if (!other) throw new Error("test mobile pairing failed");
const unlisted = { authorization: `Bearer ${other.deviceToken}` };

const hubServer = await createHubServer({
  endpoints,
  getHealth: () => ({ status: "ok", boxes: [] }),
  hubSecret: HUB_SECRET,
  boxes: [{ slug: "test1", boxRoot: box.root }],
  baseUrl: "http://127.0.0.1",
});
const hubSockets: net.Socket[] = [];
hubServer.on("connection", (socket) => hubSockets.push(socket));
await listen(hubServer);
const homeUrl = `http://127.0.0.1:${portOf(hubServer)}/test1/api/trpc/quickChat.home`;

const home = {
  open: [], recentlySent: [], shortcuts: [],
  recentChats: [{ sessionId: "s-bike", label: "Fix the bike brakes", lastActivity: "2026-10-26T15:10:00.000Z", landmark: null }],
};

async function ask(headers: Record<string, string>): Promise<{ status: number; cacheControl: string | null; body: unknown; wakes: number }> {
  const response = await fetch(homeUrl, { headers });
  return { status: response.status, cacheControl: response.headers.get("cache-control"), body: await response.json(), wakes: state.wakes };
}

function sleepBox(withSnapshot: boolean, allowedEmails: string[]): void {
  state.awake = false;
  state.wakes = 0;
  removeHomeSnapshot(box.root);
  if (withSnapshot) writeHomeSnapshot(box.root, { slug: "test1", hubSecret: HUB_SECRET, snapshot: { savedAt: "2026-10-26T15:12:00.000Z", home, deviceTokenHashes: [hashToken(deviceToken)], allowedEmails } });
}

void test("home snapshot route", async (t) => {
  t.teardown(async () => {
    for (const socket of [...sockets, ...hubSockets]) socket.destroy();
    await close(hubServer);
    await close(fakeBox);
    await box.cleanup();
    await rm(authDir, { recursive: true, force: true });
  });

  // ## Asleep, with a snapshot: the box's last answer, and no wake
  sleepBox(true, []);
  await t.check(ask(mobile), {
    status: 200,
    cacheControl: "no-store",
    body: { result: { data: { ...home, asleep: { savedAt: "2026-10-26T15:12:00.000Z" } } } },
    wakes: 0,
  });

  // ## Without a credential: the wall, and no wake
  await t.check(ask({}), { status: 401, cacheControl: null, body: { error: "Not authenticated" }, wakes: 0 });

  // ## A device the snapshot does not list: the ordinary path, where the box checks its pairer
  await t.check(ask(unlisted), { status: 200, cacheControl: null, body: { from: "box" }, wakes: 1 });

  // ## The member list changed while the box slept: the ordinary path, where the box checks the pairer
  sleepBox(true, ["removed@example.com"]);
  await t.check(ask(mobile), { status: 200, cacheControl: null, body: { from: "box" }, wakes: 1 });

  // ## Asleep, with no snapshot: the ordinary path wakes the box
  sleepBox(false, []);
  await t.check(ask(mobile), { status: 200, cacheControl: null, body: { from: "box" }, wakes: 1 });

  // ## Awake: the box answers, even with a snapshot on disk
  sleepBox(true, []);
  state.awake = true;
  await t.check(ask(mobile), { status: 200, cacheControl: null, body: { from: "box" }, wakes: 1 });
});
