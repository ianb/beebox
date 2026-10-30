// # Chat sends from a paired mobile device are attributed to a user
//
// `getSessionUser` only reads the `bbx_session` cookie, but a paired mobile device
// authenticates every native and mobile-web send with a bearer token (or a
// `bbx_mobile` cookie) and carries no cookie session. Before this fix those sends
// landed in the transcript with `user: null` — attributed to nobody.
// `resolveMobileSender` closes that gap: it resolves the request's mobile identity
// to the device record's `createdBy` (the email that paired it) so the send is
// attributed to a real user.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, capture, uuid } from "@ianbicking/tap-check/check";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import { createFirstUser } from "../../../../src/webapp/local-users.js";
import { createMobilePairingTicket, redeemMobilePairingTicket } from "../../../../src/core/mobile/pairing.js";
import { resolveMobileSender, injectUserAttr } from "../../../../src/webapp/routes/chat/helpers.js";

// A throwaway credential store with a small scrypt work factor keeps the
// display-name lookup fast; BBX_AUTH_SCRYPT_N is a test-only seam.
process.env.BBX_AUTH_SCRYPT_N = String(2 ** 14);
const authDir = await mkdtemp(join(tmpdir(), "bbx-auth-sender-"));
process.env.BBX_AUTH_FILE = join(authDir, "auth.json");
delete process.env.BBX_OWNER_EMAIL;

// ## A bearer-authenticated send resolves to the pairing owner
//
// Pair a device whose `createdBy` is the owner, then resolve a request that
// carries only the durable device token in an `Authorization` header. The store
// has a matching local user, so the sender gets that user's display name.
void test("Pair a device whose createdBy is the owner, then resolve a request that carri...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
      await rm(authDir, { recursive: true, force: true });
      delete process.env.BBX_AUTH_FILE;
      delete process.env.BBX_AUTH_SCRYPT_N;
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  // Rosa is the local owner; Tomas is a member. A paired phone works only
  // while its pairer can open the box.
  await mkdir(join(box.root, "_config"), { recursive: true });
  await writeFile(join(box.root, "_config", "box.json"), JSON.stringify({ allowedEmails: ["tomas@example.com"] }));
  await createFirstUser({ email: "rosa@example.com", password: "correct-horse", name: "Rosa Okafor" });

  const ticket = createMobilePairingTicket(box.root, { createdBy: "rosa@example.com" });
  const device = await redeemMobilePairingTicket(box.root, { pairingToken: ticket.token, deviceLabel: "iPhone" });
  const deviceToken = capture(any(String));
  t.check(device, { deviceId: uuid(), deviceToken, label: "iPhone" });

  const sender = await resolveMobileSender(box.root, { authorization: `Bearer ${deviceToken.value}` });
  t.check(sender, {
    email: "rosa@example.com",
    name: "Rosa Okafor",
  });

  // That identity is what flows into the message tag, so the transcript shows a real
  // sender instead of an unattributed `<typed>`:

  if (sender === null) throw new Error("expected a sender");
  t.check(injectUserAttr("<typed>hello from my phone</typed>", sender), "<typed user=\"Rosa Okafor\" user-email=\"rosa@example.com\">hello from my phone</typed>");

  // Attributes already on the wrapper stay, after the sender. The box screen's
  // thoughts carry `source="box-screen"`, typed or spoken:

  const priya = { email: "priya@example.com", name: "Priya Marlowe" };
  t.check(injectUserAttr('<typed source="box-screen">Buy stamps</typed>', priya), "<typed user=\"Priya Marlowe\" user-email=\"priya@example.com\" source=\"box-screen\">Buy stamps</typed>");

  t.check(injectUserAttr('<speech source="box-screen">Call the plumber</speech>', priya), "<speech user=\"Priya Marlowe\" user-email=\"priya@example.com\" source=\"box-screen\">Call the plumber</speech>");

  // ## Without a local record the email stands in for the name
  //
  // A device paired against an identity that has no local-user record (e.g. a
  // Google-only login) still attributes — the display name degrades to the email
  // rather than failing.

  const ticket2 = createMobilePairingTicket(box.root, { createdBy: "tomas@example.com" });
  const device2 = await redeemMobilePairingTicket(box.root, { pairingToken: ticket2.token, deviceLabel: "iPad" });
  t.check(await resolveMobileSender(box.root, { authorization: `Bearer ${device2?.deviceToken}` }), {
    email: "tomas@example.com",
    name: "tomas@example.com",
  });

  // ## No identity to attribute returns null
  //
  // A device paired in open mode carries no `createdBy`, so there is genuinely no
  // user — matching the cookie path's `null` for an unauthenticated request.

  const openTicket = createMobilePairingTicket(box.root);
  const openDevice = await redeemMobilePairingTicket(box.root, { pairingToken: openTicket.token, deviceLabel: "kiosk" });
  t.check(await resolveMobileSender(box.root, { authorization: `Bearer ${openDevice?.deviceToken}` }), null);

  // A request with no mobile credentials at all is also null (nothing to resolve),
  // and a bogus bearer token never matches a device.

  t.check(await resolveMobileSender(box.root, {}), null);

  t.check(await resolveMobileSender(box.root, { authorization: "Bearer not-a-real-token" }), null);
});

// </content>
// </invoke>
