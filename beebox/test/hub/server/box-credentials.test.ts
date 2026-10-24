// # The hub's credential gates on a unit host: hashes from the box's metadata
//
// With `enableHubMetaReads()` on (what `bbx engine hub` does on a unit host),
// the hub verifies a bearer by hashing it against `.beebox/hub-meta.json`
// (`src/hub/server/box-credentials.ts`) and never opens the box's own stores.
// The switch is process-wide, so this file is the only one that turns it on.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import { enableHubMetaReads, hubMetaPath } from "../../../src/core/hub-meta.js";
import { agentAuthed, mobileAuthed, scanAuthed } from "../../../src/hub/server/box-credentials.js";
import { clearMobileSessionSecretCache, signMobileSession } from "../../../src/core/mobile/session.js";
import { canAccessBox } from "../../../src/webapp/box-access.js";
import { getOrCreateAgentToken } from "../../../src/core/agent/token.js";
import { createScanToken } from "../../../src/core/scan/tokens.js";
import { createMobilePairingTicket, redeemMobilePairingTicket } from "../../../src/core/mobile/pairing.js";
import { grantBoxAccess } from "../../../src/webapp/box-config-write.js";
import { chmod, rm } from "node:fs/promises";

void test("each credential is accepted by hash and refused when junk, with no read of the box's own files", async (t) => {
  const box = await makeTmpBox({ git: true });
  const env = { unitHost: process.env.BBX_UNIT_HOST, hubSecret: process.env.BBX_HUB_SECRET };
  t.teardown(async () => {
    await box.cleanup();
    if (env.unitHost === undefined) delete process.env.BBX_UNIT_HOST; else process.env.BBX_UNIT_HOST = env.unitHost;
    if (env.hubSecret === undefined) delete process.env.BBX_HUB_SECRET; else process.env.BBX_HUB_SECRET = env.hubSecret;
    clearMobileSessionSecretCache();
  });
  // The box unit's view: on a unit host it signs cookies with a key derived
  // from its hub secret (a systemd credential), and the hub holds that secret.
  const hubSecret = "a".repeat(64);
  process.env.BBX_UNIT_HOST = "1";
  process.env.BBX_HUB_SECRET = hubSecret;
  clearMobileSessionSecretCache();
  const cookie = signMobileSession(box.root, { deviceId: "phone", createdBy: "owner@example.com", ttlMs: 60_000 });
  const expired = signMobileSession(box.root, { deviceId: "phone", createdBy: "owner@example.com", ttlMs: 0 });
  const hub = { boxRoot: box.root, hubSecret };
  const agent = getOrCreateAgentToken(box.root);
  const scan = await createScanToken(box.root, { name: "laptop", createdBy: null });
  const ticket = createMobilePairingTicket(box.root, { createdBy: "owner@example.com" });
  const device = await redeemMobilePairingTicket(box.root, { pairingToken: ticket.token, deviceLabel: "phone" });
  await grantBoxAccess({ boxRoot: box.root, email: "Friend@Example.com" });

  enableHubMetaReads();
  // Prove nothing but the metadata is read: the stores and the config become unreadable.
  await chmod(box.path(".beebox/agent-token"), 0o000);
  await chmod(box.path(".beebox/scan-tokens.secret.json"), 0o000);
  await chmod(box.path(".beebox/mobile-devices.secret.json"), 0o000);
  await chmod(box.path("_config/box.json"), 0o000);

  t.check({
    agent: agentAuthed(box.root, `Bearer ${agent}`),
    agentJunk: agentAuthed(box.root, "Bearer nope"),
    scan: await scanAuthed(box.root, { authorization: `Bearer ${scan.token}` }),
    scanJunk: await scanAuthed(box.root, { authorization: "Bearer nope" }),
    device: await mobileAuthed(hub, { authorization: `Bearer ${device?.deviceToken ?? ""}` }),
    deviceJunk: await mobileAuthed(hub, { authorization: "Bearer nope" }),
    // The cookie: verified at the hub with the derived key (question 7), so a
    // junk, expired, planted or sibling-signed cookie wakes nothing.
    cookie: await mobileAuthed(hub, { cookie: `bbx_mobile=${cookie}` }),
    cookieBesideJunk: await mobileAuthed(hub, { cookie: `bbx_mobile=junk; bbx_mobile=${cookie}` }),
    cookieJunk: await mobileAuthed(hub, { cookie: "bbx_mobile=anything" }),
    cookieExpired: await mobileAuthed(hub, { cookie: `bbx_mobile=${expired}` }),
    cookieOtherBoxSecret: await mobileAuthed({ boxRoot: box.root, hubSecret: "b".repeat(64) }, { cookie: `bbx_mobile=${cookie}` }),
    cookieNoSecret: await mobileAuthed({ boxRoot: box.root, hubSecret: "" }, { cookie: `bbx_mobile=${cookie}` }),
    noCookie: await mobileAuthed(hub, { cookie: "other=1" }),
    friend: await canAccessBox({ boxRoot: box.root, email: "friend@example.com", ownerEmail: "owner@example.com" }),
    owner: await canAccessBox({ boxRoot: box.root, email: "owner@example.com", ownerEmail: "owner@example.com" }),
    stranger: await canAccessBox({ boxRoot: box.root, email: "stranger@example.com", ownerEmail: "owner@example.com" }),
  }, {
    agent: true, agentJunk: false, scan: true, scanJunk: false, device: true, deviceJunk: false,
    cookie: true, cookieBesideJunk: true, cookieJunk: false, cookieExpired: false, cookieOtherBoxSecret: false, cookieNoSecret: false,
    noCookie: false, friend: true, owner: true, stranger: false,
  });

  // No metadata: every credential is refused, and only the owner may enter.
  await rm(hubMetaPath(box.root));
  await new Promise((resolve) => setTimeout(resolve, 1_100));
  t.check({
    agent: agentAuthed(box.root, `Bearer ${agent}`),
    device: await mobileAuthed(hub, { authorization: `Bearer ${device?.deviceToken ?? ""}` }),
    friend: await canAccessBox({ boxRoot: box.root, email: "friend@example.com", ownerEmail: "owner@example.com" }),
    owner: await canAccessBox({ boxRoot: box.root, email: "owner@example.com", ownerEmail: "owner@example.com" }),
  }, { agent: false, device: false, friend: false, owner: true });
});
