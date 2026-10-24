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
import { canAccessBox } from "../../../src/webapp/box-access.js";
import { getOrCreateAgentToken } from "../../../src/core/agent/token.js";
import { createScanToken } from "../../../src/core/scan/tokens.js";
import { createMobilePairingTicket, redeemMobilePairingTicket } from "../../../src/core/mobile/pairing.js";
import { grantBoxAccess } from "../../../src/webapp/box-config-write.js";
import { chmod, rm } from "node:fs/promises";

void test("each credential is accepted by hash and refused when junk, with no read of the box's own files", async (t) => {
  const box = await makeTmpBox({ git: true });
  t.teardown(() => box.cleanup());
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
    device: await mobileAuthed(box.root, { authorization: `Bearer ${device?.deviceToken ?? ""}` }),
    deviceJunk: await mobileAuthed(box.root, { authorization: "Bearer nope" }),
    // The box verifies its own cookie; the hub passes a cookie-shaped request on (open question 7).
    cookie: await mobileAuthed(box.root, { cookie: "bbx_mobile=anything" }),
    noCookie: await mobileAuthed(box.root, { cookie: "other=1" }),
    friend: await canAccessBox({ boxRoot: box.root, email: "friend@example.com", ownerEmail: "owner@example.com" }),
    owner: await canAccessBox({ boxRoot: box.root, email: "owner@example.com", ownerEmail: "owner@example.com" }),
    stranger: await canAccessBox({ boxRoot: box.root, email: "stranger@example.com", ownerEmail: "owner@example.com" }),
  }, {
    agent: true, agentJunk: false, scan: true, scanJunk: false, device: true, deviceJunk: false,
    cookie: true, noCookie: false, friend: true, owner: true, stranger: false,
  });

  // No metadata: every credential is refused, and only the owner may enter.
  await rm(hubMetaPath(box.root));
  await new Promise((resolve) => setTimeout(resolve, 1_100));
  t.check({
    agent: agentAuthed(box.root, `Bearer ${agent}`),
    device: await mobileAuthed(box.root, { authorization: `Bearer ${device?.deviceToken ?? ""}` }),
    friend: await canAccessBox({ boxRoot: box.root, email: "friend@example.com", ownerEmail: "owner@example.com" }),
    owner: await canAccessBox({ boxRoot: box.root, email: "owner@example.com", ownerEmail: "owner@example.com" }),
  }, { agent: false, device: false, friend: false, owner: true });
});
