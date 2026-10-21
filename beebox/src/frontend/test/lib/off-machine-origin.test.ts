// A printed card gets a QR code only when a phone could reach the page's
// origin: never for loopback addresses, which name only this machine.
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { isOffMachineOrigin } from "../../src/lib/off-machine-origin.js";

void test("loopback origins are this machine only", async (t) => {
  const urls = [
    "http://localhost:3210/main/test1/browse",
    "http://box.localhost/",
    "http://127.0.0.1:3000/",
    "http://127.4.5.6/",
    "http://[::1]:3000/",
    "http://0.0.0.0:3000/",
    "http://[::ffff:127.0.0.1]:3000/",
  ];
  t.check(urls.map((u) => isOffMachineOrigin(new URL(u))), [false, false, false, false, false, false, false]);
});

void test("LAN, tailnet and public origins can be reached from a phone", async (t) => {
  // `::ffff:7f00:1:1` is an ordinary IPv6 address, not a mapped loopback.
  const urls = ["http://192.168.1.20:3000/kitchen", "http://box.tail1234.ts.net/", "https://kitchen.example.org/", "http://[fd00::2]/", "http://[::ffff:7f00:1:1]/"];
  t.check(urls.map((u) => isOffMachineOrigin(new URL(u))), [true, true, true, true, true]);
});

void test("a non-web origin is not an address to print", async (t) => {
  t.check(isOffMachineOrigin(new URL("file:///tmp/card.html")), false);
});
