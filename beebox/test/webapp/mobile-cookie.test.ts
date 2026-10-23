// # Issuing and renewing the `bbx_mobile` cookie
//
// A paired device authenticates with its durable token in an `Authorization`
// header; the box answers with a short-lived `bbx_mobile` cookie that carries
// everything after — including the WebSocket upgrade, which the browser API
// cannot attach headers to.
//
// The renewal rules are what make the short TTL safe rather than merely annoying,
// so they get the most coverage here: a signed cookie cannot be revoked before it
// expires, so renewal is the only place revocation can take effect.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import Fastify from "fastify";
import type { CookieSerializeOptions } from "@fastify/cookie";
import * as fs from "node:fs";
import * as path from "node:path";
import fastifyCookie from "@fastify/cookie";
import { any, str } from "@ianbicking/tap-check/check";
import { makeTmpBox } from "../helpers/test-helpers.js";
import { createMobilePairingTicket, redeemMobilePairingTicket, revokeMobileDevice } from "../../src/core/mobile/pairing.js";
import { MOBILE_COOKIE_NAME, MOBILE_SESSION_TTL_MS, signMobileSession, verifyMobileSession } from "../../src/core/mobile/session.js";
import { resolveMobileRequestAuth } from "../../src/core/mobile/request-auth.js";
import { renewMobileSessionCookie, type CookieReply } from "../../src/webapp/mobile-cookie.js";
import { registerPairingRoutes } from "../../src/webapp/routes/pairing.js";

const INVALID_DEVICE_TOKEN = '{"error":"Mobile device token is invalid or revoked."}';

/** Captures what a handler did to the reply's cookies. */
function fakeReply() {
  const calls: string[] = [];
  const reply: CookieReply = {
    setCookie(...[name, value, opts]: Parameters<CookieReply["setCookie"]>) {
      calls.push(`set ${name} path=${String(opts?.path)} httpOnly=${String(opts?.httpOnly)} sameSite=${String(opts?.sameSite)}`);
      calls.push(`value ${value}`);
    },
    clearCookie(name: string, opts?: CookieSerializeOptions) {
      calls.push(`clear ${name} path=${String(opts?.path)}`);
    },
  };
  return { calls, reply };
}

// ## The mint endpoint trades a device token for a cookie
void test("The mint endpoint trades a device token for a cookie", async (t) => {
  t.teardown(async () => {
    try {
      await server.close();
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const server = Fastify();
  await server.register(fastifyCookie);
  registerPairingRoutes(server, { boxRoot: box.root, boxSlug: "test" });

  const ticket = createMobilePairingTicket(box.root);
  const redeemed = await redeemMobilePairingTicket(box.root, { pairingToken: ticket.token, deviceLabel: "test" });
  if (!redeemed) throw new Error("pairing failed");

  const minted = await server.inject({
    method: "POST",
    url: "/api/pairing/session",
    headers: { authorization: `Bearer ${redeemed.deviceToken}` },
  });
  t.check(
    { status: minted.statusCode, body: minted.body, setCookie: minted.headers["set-cookie"] },
    { status: 204, body: "", setCookie: str`bbx_mobile=${any(String)}; Max-Age=3600; Path=/test; HttpOnly; SameSite=Lax` },
  );

  // The cookie it sets is scoped to this box's path and unreadable from page JS —
  // `HttpOnly` is what keeps the iframe/XSS exfiltration route that the old
  // localStorage channel had from reappearing.

  const setCookie = String(minted.headers["set-cookie"]);

  // And it verifies back to the device that minted it.

  const value = setCookie.split(";")[0]?.split("=").slice(1).join("=") ?? "";
  t.check(verifyMobileSession(box.root, decodeURIComponent(value)), {
    deviceId: redeemed.deviceId,
    createdBy: null,
    exp: any(Number).above(Date.now()),
  });

  // ## A bad or absent token mints nothing

  const noToken = await server.inject({ method: "POST", url: "/api/pairing/session" });
  t.check(
    { status: noToken.statusCode, body: noToken.body },
    { status: 401, body: INVALID_DEVICE_TOKEN },
  );

  const badToken = await server.inject({
    method: "POST",
    url: "/api/pairing/session",
    headers: { authorization: "Bearer not-a-real-token" },
  });
  t.check(
    { status: badToken.statusCode, body: badToken.body },
    { status: 401, body: INVALID_DEVICE_TOKEN },
  );

  // A revoked device can no longer mint, which is what stops it renewing its way
  // past the TTL bound.

  t.check(await revokeMobileDevice(box.root, redeemed.deviceId), true);

  const revokedMint = await server.inject({
    method: "POST",
    url: "/api/pairing/session",
    headers: { authorization: `Bearer ${redeemed.deviceToken}` },
  });
  t.check(
    { status: revokedMint.statusCode, body: revokedMint.body },
    { status: 401, body: INVALID_DEVICE_TOKEN },
  );
});

// ## Both credentials resolve to the same identity
//
// The cookie carries `createdBy`, not just the device id — `capture-request-owner.ts`
// uses it as the authenticated email for capture-session ownership, so a cookie
// that dropped it would silently weaken cross-user isolation.
void test("The cookie carries createdBy, not just the device id — capture-request-owner....", async (t) => {
  t.teardown(async () => {
    try {
      await box2.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box2 = await makeTmpBox();
  // A paired phone works only while its pairer can open the box.
  await fs.promises.mkdir(path.join(box2.root, "_config"), { recursive: true });
  await fs.promises.writeFile(path.join(box2.root, "_config", "box.json"), JSON.stringify({ allowedEmails: ["rosa@example.com"] }));
  const ticket2 = createMobilePairingTicket(box2.root, { createdBy: "rosa@example.com" });
  const device = await redeemMobilePairingTicket(box2.root, { pairingToken: ticket2.token, deviceLabel: "test" });
  if (!device) throw new Error("pairing failed");

  const viaBearer = await resolveMobileRequestAuth(box2.root, { authorization: `Bearer ${device.deviceToken}` });
  t.check(viaBearer, { deviceId: device.deviceId, createdBy: "rosa@example.com", source: "bearer", expiresAt: null });

  const cookie = signMobileSession(box2.root, { deviceId: device.deviceId, createdBy: "rosa@example.com", ttlMs: MOBILE_SESSION_TTL_MS });
  const viaCookie = await resolveMobileRequestAuth(box2.root, { cookie: `${MOBILE_COOKIE_NAME}=${cookie}` });
  t.check(viaCookie, { deviceId: device.deviceId, createdBy: "rosa@example.com", source: "cookie", expiresAt: any(Number).above(Date.now()) });

  // A request carrying neither resolves to nothing, and a bogus cookie does not
  // fall through to some laxer check.

  t.check(await resolveMobileRequestAuth(box2.root, {}), null);

  t.check(await resolveMobileRequestAuth(box2.root, { cookie: `${MOBILE_COOKIE_NAME}=forged` }), null);

  // ## A shadowing cookie from a sibling box cannot lock the real one out
  //
  // Boxes are path siblings on one origin, so a script under box A can set
  // `bbx_mobile=junk; Path=/` and the browser will send that value alongside box B's
  // real `Path=/<slug>` cookie on every request to B. Checking only the first value
  // would make that a one-line cross-box denial of service.
  //
  // It was never an escalation risk — the signature is per-box, so a forged value
  // can't authenticate — but crowding out the real cookie is enough to break a
  // sibling.

  const shadowed = await resolveMobileRequestAuth(box2.root, {
    cookie: `${MOBILE_COOKIE_NAME}=junk-from-a-sibling-box; ${MOBILE_COOKIE_NAME}=${cookie}`,
  });
  t.check(shadowed, { deviceId: device.deviceId, createdBy: "rosa@example.com", source: "cookie", expiresAt: any(Number).above(Date.now()) });

  // Order doesn't matter — the real cookie wins from either side.

  const shadowedAfter = await resolveMobileRequestAuth(box2.root, {
    cookie: `${MOBILE_COOKIE_NAME}=${cookie}; ${MOBILE_COOKIE_NAME}=junk-from-a-sibling-box`,
  });
  t.check(shadowedAfter, { deviceId: device.deviceId, createdBy: "rosa@example.com", source: "cookie", expiresAt: any(Number).above(Date.now()) });

  // And a pile of junk with no real cookie among it still authenticates nothing.

  t.check(
    await resolveMobileRequestAuth(box2.root, {
      cookie: `${MOBILE_COOKIE_NAME}=junk-one; ${MOBILE_COOKIE_NAME}=junk-two`,
    }),
    null,
  );

  // ## Verification never creates a signing secret
  //
  // The box and the hub both verify these cookies, in separate processes with
  // separate caches and no way to invalidate each other's. If verifying could
  // generate a secret, whichever process first saw a missing file would mint one
  // and cache it while the other kept signing with the old value — every cookie
  // would verify in one process and fail in the other, indefinitely and silently.

  const untouchedBox = await makeTmpBox();
  const secretFile = path.join(untouchedBox.root, ".beebox/mobile-session.secret");

  t.check(verifyMobileSession(untouchedBox.root, cookie), null);

  t.check(fs.existsSync(secretFile), false);

  // Minting is the only thing that creates one.

  t.check(signMobileSession(untouchedBox.root, { deviceId: "d", createdBy: null, ttlMs: 60_000 }), any(String).matches(/^[\w-]+\.[\da-f]{64}$/));

  t.check(fs.existsSync(secretFile), true);

  await untouchedBox.cleanup();

  // ## Renewal only re-reads the device store past the halfway point
  //
  // A fresh cookie is left alone, so an active session costs no filesystem access
  // per request.

  const fresh = await resolveMobileRequestAuth(box2.root, { cookie: `${MOBILE_COOKIE_NAME}=${cookie}` });
  if (!fresh) throw new Error("expected a session");
  const untouched = fakeReply();
  renewMobileSessionCookie(untouched.reply, { boxRoot: box2.root, boxSlug: "test", auth: fresh });
  t.check(untouched.calls, []);

  // Past halfway it re-issues.

  const agedCookie = signMobileSession(box2.root, { deviceId: device.deviceId, createdBy: null, ttlMs: MOBILE_SESSION_TTL_MS / 4 });
  const aged = await resolveMobileRequestAuth(box2.root, { cookie: `${MOBILE_COOKIE_NAME}=${agedCookie}` });
  if (!aged) throw new Error("expected a session");
  const renewed = fakeReply();
  renewMobileSessionCookie(renewed.reply, { boxRoot: box2.root, boxSlug: "test", auth: aged });
  t.check(renewed.calls, ["set bbx_mobile path=/test httpOnly=true sameSite=lax", str`value ${any(String)}`]);

  // A bearer-authenticated request always (re)issues — verifying the bearer already
  // read the device store, so there's nothing to save by waiting.

  const bearerAuth = await resolveMobileRequestAuth(box2.root, { authorization: `Bearer ${device.deviceToken}` });
  if (!bearerAuth) throw new Error("expected a session");
  const issued = fakeReply();
  renewMobileSessionCookie(issued.reply, { boxRoot: box2.root, boxSlug: "test", auth: bearerAuth });
  t.check(issued.calls, ["set bbx_mobile path=/test httpOnly=true sameSite=lax", str`value ${any(String)}`]);

  // ## A revoked device is cleared, not merely denied a renewal
  //
  // This is the bound the design claims: revocation takes effect within one TTL,
  // and on the next renewal attempt the stale cookie is actively cleared rather
  // than left to run out.

  t.check(await revokeMobileDevice(box2.root, device.deviceId), true);

  const afterRevoke = fakeReply();
  renewMobileSessionCookie(afterRevoke.reply, { boxRoot: box2.root, boxSlug: "test", auth: aged });
  t.check(afterRevoke.calls, ["clear bbx_mobile path=/test"]);

  // The already-issued cookie still verifies until it expires — that IS the
  // revocation latency, stated rather than hidden.

  t.check(verifyMobileSession(box2.root, agedCookie), { deviceId: device.deviceId, createdBy: null, exp: any(Number).above(Date.now()) });
});
