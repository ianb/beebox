// # A member's phone works only while the member can still open the box
//
// A paired phone acts as the person who paired it (`createdBy`). Any member
// may pair a phone, so the phone must not outlive the member's access: every
// mobile gate re-checks the pairer against the box's `allowedEmails` on each
// request (`core/mobile/request-auth.ts`). Removing the member refuses the
// phone at once, with the same 401 an unknown device gets, and with no revoke
// step. A phone the owner paired is not affected.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeTestServer } from "../../helpers/test-route-server.js";
import { createMobilePairingTicket, redeemMobilePairingTicket } from "../../../src/core/mobile/pairing.js";
import { MOBILE_COOKIE_NAME, MOBILE_SESSION_TTL_MS, signMobileSession } from "../../../src/core/mobile/session.js";
import { updateBoxConfigFields } from "../../../src/webapp/box-config-write.js";

void test("a member's phone is refused once the member is removed from the box", async (t) => {
  const authDir = await mkdtemp(join(tmpdir(), "bbx-device-removal-"));
  const originalAuth = process.env.BBX_AUTH_FILE;
  const originalOwner = process.env.BBX_OWNER_EMAIL;
  process.env.BBX_AUTH_FILE = join(authDir, "auth.json");
  process.env.BBX_OWNER_EMAIL = "priya@example.com";
  const ctx = await makeTestServer({ openAccess: false });
  t.teardown(async () => {
    try {
      await ctx.cleanup();
      if (originalAuth === undefined) delete process.env.BBX_AUTH_FILE;
      else process.env.BBX_AUTH_FILE = originalAuth;
      if (originalOwner === undefined) delete process.env.BBX_OWNER_EMAIL;
      else process.env.BBX_OWNER_EMAIL = originalOwner;
    } catch (error) {
      t.error(error);
    }
  });
  // The same write the owner's member settings make.
  const setAllowedEmails = async (emails: string[]) => {
    const { commitError } = await updateBoxConfigFields({ boxRoot: ctx.boxRoot, allowedEmails: emails });
    if (commitError) throw commitError;
  };
  const pair = async (who: string) => {
    const ticket = createMobilePairingTicket(ctx.boxRoot, { createdBy: who });
    const device = await redeemMobilePairingTicket(ctx.boxRoot, { pairingToken: ticket.token, deviceLabel: who });
    if (!device) throw new Error("the ticket did not redeem");
    const cookie = signMobileSession(ctx.boxRoot, { deviceId: device.deviceId, createdBy: who, ttlMs: MOBILE_SESSION_TTL_MS });
    return { bearer: `Bearer ${device.deviceToken}`, cookie: `${MOBILE_COOKIE_NAME}=${cookie}` };
  };
  /** Status of one authed read, with the device token and with the session cookie. */
  const statuses = async (phone: { bearer: string; cookie: string }) => {
    const url = "/api/trpc/pairing.devices";
    const viaBearer = await ctx.request({ method: "GET", url, headers: { authorization: phone.bearer } });
    const viaCookie = await ctx.request({ method: "GET", url, headers: { cookie: phone.cookie } });
    return { bearer: viaBearer.statusCode, cookie: viaCookie.statusCode };
  };

  await setAllowedEmails(["tomas@example.com"]);
  const memberPhone = await pair("tomas@example.com");
  const ownerPhone = await pair("priya@example.com");

  // While the member is listed, the member's phone passes with either credential.
  t.check(await statuses(memberPhone), { bearer: 200, cookie: 200 });

  await setAllowedEmails([]);

  // Removed from the box: both credentials are refused as an unknown device is.
  t.check(await statuses(memberPhone), { bearer: 401, cookie: 401 });
  t.check(
    await ctx.request({ method: "GET", url: "/api/trpc/pairing.devices", headers: { authorization: memberPhone.bearer } }),
    { statusCode: 401, body: { error: "Not authenticated" } },
  );
  // The owner can always open the box, so the owner's phone still passes.
  t.check(await statuses(ownerPhone), { bearer: 200, cookie: 200 });
  // A refused cookie does not speak for the other credentials on the request:
  // the owner's device token on the same request still authenticates it.
  t.check(
    (await ctx.request({ method: "GET", url: "/api/trpc/pairing.devices", headers: { cookie: memberPhone.cookie, authorization: ownerPhone.bearer } })).statusCode,
    200,
  );

  // Adding the member back restores the phone: the device record was never removed.
  await setAllowedEmails(["tomas@example.com"]);
  t.check(await statuses(memberPhone), { bearer: 200, cookie: 200 });
});
