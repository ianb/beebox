// # The scan preHandler accepts exactly two credentials — and nothing else accepts it
//
// `makeScanAuthPreHandler` is the child-side gate for the `/api/scan/…` upload
// routes (Track 2). It accepts a scan-upload bearer or a full owner identity. The
// point of the dedicated store is what this file spends most of its space proving:
// a scan token gets through NOTHING else — not the box's general auth preHandler,
// not a tRPC procedure, not `/api/pairing/session` — and a mobile device token
// gets through the scan gate's token path not at all.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import Fastify from "fastify";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import { makeTestServer } from "../../../helpers/test-route-server.js";
import { createScanToken, revokeScanToken } from "../../../../src/core/scan/tokens.js";
import { createMobilePairingTicket, redeemMobilePairingTicket } from "../../../../src/core/mobile/pairing.js";
import { makeScanAuthPreHandler, scanAuthOf } from "../../../../src/webapp/routes/scan-upload/scan-auth.js";
import { registerPairingRoutes } from "../../../../src/webapp/routes/pairing.js";
import { updateBoxConfigFields } from "../../../../src/webapp/box-config-write.js";
import { appRouter } from "../../../../src/webapp/trpc/routers.js";
import { trpcContext } from "../../../helpers/trpc-context.js";

const ORIGINAL_HUB_SECRET = process.env.BBX_HUB_SECRET;
const ORIGINAL_OWNER_EMAIL = process.env.BBX_OWNER_EMAIL;

/** A minimal box scope with the scan preHandler and one echo route behind it —
 *  the shape Track 2's routes will register. */
async function makeScanServer(boxRoot: string) {
  const server = Fastify({ logger: false });
  server.decorate("openAccess", false);
  server.register(async (instance) => {
    instance.addHook("preHandler", makeScanAuthPreHandler({ boxRoot }));
    instance.get("/api/scan/whoami", (request) => scanAuthOf(request));
  });
  await server.ready();
  return server;
}

// ## A scan bearer passes, and the handler learns which token it was
//
// The token name is what Track 2 records as `scan-upload/<name>` provenance, so
// the gate has to hand it downstream rather than answer a bare yes.
void test("The token name is what Track 2 records as scan-upload/<name> provenance, so t...", async (t) => {
  t.teardown(async () => {
    try {
      delete process.env.BBX_HUB_SECRET;
      delete process.env.BBX_OWNER_EMAIL;
      await server.close();
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  delete process.env.BBX_HUB_SECRET;
  // The gate checks that a token's creator can still open the box, so the box needs a known owner.
  process.env.BBX_OWNER_EMAIL = "owner@example.com";
  const box = await makeTmpBox();
  const scan = await createScanToken(box.root, { name: "laptop-scansnap", createdBy: "owner@example.com" });
  const server = await makeScanServer(box.root);

  const ok = await server.inject({
    method: "GET",
    url: "/api/scan/whoami",
    headers: { authorization: `Bearer ${scan.token}` },
  });
  t.check(ok.statusCode, 200);

  await t.checkText(ok.payload, "{\"source\":\"scan-token\",\"tokenName\":\"laptop-scansnap\",\"email\":null}");

  // ## A mobile device token does NOT satisfy the scan gate's token path
  //
  // A paired phone is a full-access credential for every *other* surface; against
  // the scan store it is just an unknown string. Nothing here rejects it by
  // inspecting a scope — the scan store simply doesn't contain it.

  const ticket = createMobilePairingTicket(box.root, { createdBy: "owner@example.com" });
  const device = await redeemMobilePairingTicket(box.root, { pairingToken: ticket.token, deviceLabel: "phone" });

  const mobileAttempt = await server.inject({
    method: "GET",
    url: "/api/scan/whoami",
    headers: { authorization: `Bearer ${device?.deviceToken}` },
  });
  t.check(mobileAttempt.statusCode, 401);

  // An absent, malformed, or bogus credential is the same bare 401 — these routes
  // are machine-facing, so there is no login redirect to fall back to.

  const attempts = await Promise.all(
    [{}, { authorization: "Bearer nope" }, { authorization: scan.token }].map((headers) =>
      server.inject({ method: "GET", url: "/api/scan/whoami", headers }).then((r) => r.statusCode)),
  );
  t.check(attempts, [
    401,
    401,
    401,
  ]);

  // ## Revocation locks the uploader out immediately

  t.check(await revokeScanToken(box.root, "laptop-scansnap"), true);

  t.check(
    (await server.inject({
      method: "GET",
      url: "/api/scan/whoami",
      headers: { authorization: `Bearer ${scan.token}` },
    })).statusCode,
    401,
  );

  // ## A full owner identity also passes — the boxholder can drive these routes by hand
  //
  // Identity comes from `resolveRequestIdentity`, the same resolver the box auth
  // preHandler and the tRPC context use, so ownership can't drift into a second
  // answer. Here it arrives the way a hub-fronted request does; a box member who
  // isn't the owner is not enough.

  process.env.BBX_HUB_SECRET = "scan-auth-test-hub-secret";
  process.env.BBX_OWNER_EMAIL = "owner@example.com";
  const hubHeaders = (email: string) => ({
    "x-bbx-hub-secret": "scan-auth-test-hub-secret",
    "x-bbx-authenticated-email": email,
  });

  const asOwner = await server.inject({ method: "GET", url: "/api/scan/whoami", headers: hubHeaders("owner@example.com") });
  t.check(asOwner.statusCode, 200);

  await t.checkText(asOwner.payload, "{\"source\":\"owner\",\"tokenName\":null,\"email\":\"owner@example.com\"}");

  const asMember = await server.inject({ method: "GET", url: "/api/scan/whoami", headers: hubHeaders("guest@example.com") });
  t.check(asMember.statusCode, 401);
});

// ## A scan token cannot mint a session cookie
//
// `/api/pairing/session` reads the mobile store and only the mobile store, so the
// one endpoint that turns a bearer into a scope-less signed cookie is closed to
// scan tokens by construction. (This is exercised against the raw route, with no
// auth preHandler in front of it, so the 401 is the route's own answer.)
void test("/api/pairing/session reads the mobile store and only the mobile store, so the...", async (t) => {
  t.teardown(async () => {
    try {
      await pairingServer.close();
      await box2.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box2 = await makeTmpBox();
  const scan2 = await createScanToken(box2.root, { name: "uploader", createdBy: null });
  const pairingServer = Fastify({ logger: false });
  registerPairingRoutes(pairingServer, { boxRoot: box2.root, boxSlug: "test" });

  t.check(
    (await pairingServer.inject({
      method: "POST",
      url: "/api/pairing/session",
      headers: { authorization: `Bearer ${scan2.token}` },
    })).statusCode,
    401,
  );
});

// ## The general box auth wall rejects a scan bearer on every other surface
//
// On a real auth-on box server the scan token reaches no route at all: the box
// preHandler resolves mobile auth, agent bearers, browse keys and browser
// identity, and knows nothing of scan tokens. A tRPC call behind
// `authedProcedure` therefore never even builds a context.
void test("On a real auth-on box server the scan token reaches no route at all:", async (t) => {
  t.teardown(async () => {
    try {
      await authedServer.cleanup();
      if (ORIGINAL_HUB_SECRET === undefined) delete process.env.BBX_HUB_SECRET;
      else process.env.BBX_HUB_SECRET = ORIGINAL_HUB_SECRET;
      if (ORIGINAL_OWNER_EMAIL === undefined) delete process.env.BBX_OWNER_EMAIL;
      else process.env.BBX_OWNER_EMAIL = ORIGINAL_OWNER_EMAIL;
    } catch (error) {
      t.error(error);
    }
  });
  delete process.env.BBX_HUB_SECRET;
  const authedServer = await makeTestServer({ openAccess: false });
  const scan3 = await createScanToken(authedServer.boxRoot, { name: "uploader", createdBy: null });
  const scanBearer = { authorization: `Bearer ${scan3.token}` };

  const probes: { method: "GET" | "POST"; url: string }[] = [
    { method: "GET", url: "/api/trpc/health.check" },
    { method: "POST", url: "/api/pairing/session" },
    { method: "GET", url: "/api/health" },
  ];
  const statuses = await Promise.all(
    probes.map((probe) => authedServer.request({ ...probe, headers: scanBearer }).then((r) => r.statusCode)),
  );
  t.check(statuses, [
    401,
    401,
    401,
  ]);
});

// ## A member's scan token works only while the member can still open the box
//
// Any member may mint a scan token, so the token must not outlive the member's
// access. The gate re-checks the token's creator against the box's
// `allowedEmails` on every request. A token the owner minted is not affected.
void test("a member's scan token stops working when the member is removed from the box", async (t) => {
  t.teardown(async () => {
    try {
      await server.close();
      await box.cleanup();
      if (ORIGINAL_HUB_SECRET === undefined) delete process.env.BBX_HUB_SECRET;
      else process.env.BBX_HUB_SECRET = ORIGINAL_HUB_SECRET;
      if (ORIGINAL_OWNER_EMAIL === undefined) delete process.env.BBX_OWNER_EMAIL;
      else process.env.BBX_OWNER_EMAIL = ORIGINAL_OWNER_EMAIL;
    } catch (error) {
      t.error(error);
    }
  });
  delete process.env.BBX_HUB_SECRET;
  process.env.BBX_OWNER_EMAIL = "owner@example.com";
  const box = await makeTmpBox({ git: true });
  // The same write the owner's member settings make.
  const setAllowedEmails = async (emails: string[]) => {
    const { commitError } = await updateBoxConfigFields({ boxRoot: box.root, allowedEmails: emails });
    if (commitError) throw commitError;
  };
  await setAllowedEmails(["member@example.com"]);
  const member = appRouter.createCaller(
    trpcContext({ boxRoot: box.root, user: { email: "member@example.com", name: "Member" }, isOwner: false }),
  );
  const memberToken = await member.scanTokens.create({ name: "member-mac" });
  const ownerToken = await createScanToken(box.root, { name: "owner-mac", createdBy: "owner@example.com" });
  const server = await makeScanServer(box.root);
  const whoami = async (token: string) => {
    const res = await server.inject({ method: "GET", url: "/api/scan/whoami", headers: { authorization: `Bearer ${token}` } });
    return res.statusCode === 200 ? res.json<unknown>() : res.statusCode;
  };

  // While the member is listed, the member's token passes like any other.
  t.check(await whoami(memberToken.token), { source: "scan-token", tokenName: "member-mac", email: null });

  await setAllowedEmails([]);

  // Removed from the box: the member's token is refused at once, with no revoke step.
  t.check(await whoami(memberToken.token), 401);
  // The owner can always open the box, so the owner's token still passes.
  t.check(await whoami(ownerToken.token), { source: "scan-token", tokenName: "owner-mac", email: null });
});
