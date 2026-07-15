import t from "tap";
import { isPairingRedeemUrl } from "../../src/webapp/routes/pairing.js";

t.test("pairing redeem URL matcher accepts box-prefixed routes", (st) => {
  st.equal(isPairingRedeemUrl("/api/pairing/redeem"), true);
  st.equal(isPairingRedeemUrl("/api/pairing/redeem?x=1"), true);
  st.equal(isPairingRedeemUrl("/box-slug/api/pairing/redeem"), true);
  st.equal(isPairingRedeemUrl("/box-slug/api/pairing/redeem?x=1"), true);
  st.equal(isPairingRedeemUrl("/api/pairing/redeem/extra"), false);
  st.equal(isPairingRedeemUrl("/box-slug/api/pairing/other"), false);
  st.end();
});
