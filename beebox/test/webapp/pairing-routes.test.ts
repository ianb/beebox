import t from "tap";
import { isPairingRedeemUrl } from "../../src/webapp/routes/pairing.js";

t.test("pairing redeem URL matcher accepts only bare and box-prefixed routes", (st) => {
  st.equal(isPairingRedeemUrl("/api/pairing/redeem"), true);
  st.equal(isPairingRedeemUrl("/api/pairing/redeem?x=1"), true);
  st.equal(isPairingRedeemUrl("/box-slug/api/pairing/redeem"), true);
  st.equal(isPairingRedeemUrl("/box-slug/api/pairing/redeem?x=1"), true);
  st.equal(isPairingRedeemUrl("/anything/box-slug/api/pairing/redeem"), false);
  st.equal(isPairingRedeemUrl("/api/pairing/redeem/extra"), false);
  st.equal(isPairingRedeemUrl("/box-slug/api/pairing/other"), false);
  st.end();
});

// A device carries the identity of whoever paired it. Before this, the mobile
// path authenticated a DEVICE and no person: the tRPC context left `user` null,
// so a paired phone could never be its owner — nor correctly fail to be, when a
// non-owner paired it. `resolveMobileBearerIdentity` is the seam that carries
// `createdBy` out to the context, so this pins that contract.
t.test("a paired device resolves to the person who paired it", async (st) => {
  const { makeTmpBox } = await import("../helpers/doctest-helpers.js");
  const { createMobilePairingTicket, redeemMobilePairingTicket, resolveMobileBearerIdentity } =
    await import("../../src/core/mobile/pairing.js");

  const box = await makeTmpBox();
  try {
    // A non-owner pairs their own phone — the case the owner-only gate blocked.
    const ticket = createMobilePairingTicket(box.root, { createdBy: "guest@example.com" });
    const device = await redeemMobilePairingTicket(box.root, {
      pairingToken: ticket.token,
      deviceLabel: "guest phone",
    });
    st.ok(device, "the ticket redeems");
    if (!device) return;

    const identity = await resolveMobileBearerIdentity(box.root, `Bearer ${device.deviceToken}`);
    st.equal(identity?.createdBy, "guest@example.com", "the device acts as its pairer, not the owner");
    st.equal(identity?.deviceId, device.deviceId);

    const anonymous = await resolveMobileBearerIdentity(box.root, "Bearer not-a-real-token");
    st.equal(anonymous, null, "an unknown token resolves to nobody");
  } finally {
    await box.cleanup();
  }
});
