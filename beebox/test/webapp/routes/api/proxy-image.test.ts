// # Image proxy SSRF guard
//
// `/api/proxy-image` fetches arbitrary image URLs server-side for the frozen-page
// hot-link fallback, so it must refuse anything that could reach an internal
// address. `isBlockedAddress` classifies resolved IPs; `assertPublicHttpUrl`
// gates schemes, local hostnames, and literal IPs (hostname resolution adds a DNS
// check on top, not exercised here).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { isBlockedAddress, assertPublicHttpUrl, UnsafeProxyUrlError } from "../../../../src/webapp/routes/api/proxy-image.js";

async function guard(url: string) {
  try {
    await assertPublicHttpUrl(url);
    return "ok";
  } catch (e) {
    return e instanceof UnsafeProxyUrlError ? e.reason : "other";
  }
}

// ## Private, loopback, link-local, and mapped addresses are blocked
void test("Private, loopback, link-local, and mapped addresses are blocked", async (t) => {
  // doctest:L25
  t.check(
    [
      isBlockedAddress("127.0.0.1"),
      isBlockedAddress("10.0.0.5"),
      isBlockedAddress("192.168.1.1"),
      isBlockedAddress("172.16.0.1"),
      isBlockedAddress("169.254.169.254"),
      isBlockedAddress("::1"),
      isBlockedAddress("fe80::1"),
      isBlockedAddress("fc00::1"),
      isBlockedAddress("::ffff:127.0.0.1"),
    ].join(","),
    "true,true,true,true,true,true,true,true,true",
  );
});

// ## Public addresses are allowed
void test("Public addresses are allowed", async (t) => {
  // doctest:L42
  t.check(
    [
      isBlockedAddress("8.8.8.8"),
      isBlockedAddress("93.184.216.34"),
      isBlockedAddress("172.32.0.1"),
      isBlockedAddress("2606:4700:4700::1111"),
    ].join(","),
    "false,false,false,false",
  );
});

// ## assertPublicHttpUrl rejects bad schemes, local hosts, literal private IPs, and junk
void test("assertPublicHttpUrl rejects bad schemes, local hosts, literal private IPs, and junk", async (t) => {
  // doctest:L54
  t.check(
    await guard("ftp://example.com/a.png")
    ,
    "only http(s) URLs are proxied",
  );

  // doctest:L57
  t.check(
    await guard("http://localhost/a.png")
    ,
    "local hostnames are not proxied",
  );

  // doctest:L60
  t.check(
    await guard("http://127.0.0.1/a.png")
    ,
    "resolves to a non-public address",
  );

  // doctest:L63
  t.check(
    await guard("http://169.254.169.254/latest/meta-data/")
    ,
    "resolves to a non-public address",
  );

  // doctest:L66
  t.check(await guard("not a url"), "malformed URL");
});

// ## A public literal-IP URL passes
void test("A public literal-IP URL passes", async (t) => {
  // doctest:L73
  t.check(
    await guard("https://8.8.8.8/logo.png")
    ,
    "ok",
  );
});
