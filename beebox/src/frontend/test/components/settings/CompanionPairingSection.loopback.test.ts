// # The iPhone QR code is withheld on a loopback host
//
// The pairing QR code carries the page's own origin, so on a loopback host it
// would send the phone to itself.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { loopbackHost } from "../../../src/components/settings/CompanionPairingSection.js";

void test("Loopback hosts are refused; a tailnet or public name is not", async (t) => {
  const hosts = ["localhost", "box.localhost", "127.0.0.1", "[::1]", "mac.example.ts.net", "cb.example.org", "192.168.1.5"];
  t.check(hosts.map((host) => [host, loopbackHost(host)]), [
    ["localhost", true],
    ["box.localhost", true],
    ["127.0.0.1", true],
    ["[::1]", true],
    ["mac.example.ts.net", false],
    ["cb.example.org", false],
    ["192.168.1.5", false],
  ]);
});
