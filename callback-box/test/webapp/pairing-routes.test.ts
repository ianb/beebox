import t from "tap";
import { isPairingRedeemUrl } from "../../src/webapp/routes/pairing.js";

t.test("pairing redeem URL matcher accepts box-prefixed routes", (t) => {
  t.equal(isPairingRedeemUrl("/api/pairing/redeem"), true);
  t.equal(isPairingRedeemUrl("/api/pairing/redeem?x=1"), true);
  t.equal(isPairingRedeemUrl("/box-slug/api/pairing/redeem"), true);
  t.equal(isPairingRedeemUrl("/box-slug/api/pairing/redeem?x=1"), true);
  t.equal(isPairingRedeemUrl("/api/pairing/redeem/extra"), false);
  t.equal(isPairingRedeemUrl("/box-slug/api/pairing/other"), false);
  t.end();
});
