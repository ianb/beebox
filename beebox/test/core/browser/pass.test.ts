// The box browser pass: it verifies only for the box that signed it, only before it
// expires, only from the box's own pages or a typed navigation, and never as
// (or from) a mobile cookie.

import { test, type Test } from "tap";
import {
  BROWSER_PASS_COOKIE,
  passSiteOk,
  signBrowserPass,
  stripForeignBrowserPasses,
  verifyBrowserPass,
} from "../../../src/core/browser/pass.js";
import { clearMobileSessionSecretCache, signMobileSession, verifyMobileSession } from "../../../src/core/mobile/session.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";

const NOW = 1_800_000_000_000;
const APP = "https://box.example.com";
const SAME_ORIGIN = { "sec-fetch-site": "same-origin" } as const;

async function freshBox(t: Test): Promise<string> {
  const box = await makeTmpBox();
  t.teardown(() => {
    clearMobileSessionSecretCache();
    return box.cleanup();
  });
  return box.root;
}

function cookie(value: string): string {
  return `${BROWSER_PASS_COOKIE}=${value}`;
}

void test("a pass verifies until it expires", async (t) => {
  const root = await freshBox(t);
  const pass = signBrowserPass(root, { ttlMs: 60_000, now: NOW });
  const check = (now: number): boolean =>
    verifyBrowserPass(root, { appOrigin: APP, headers: { ...SAME_ORIGIN, cookie: cookie(pass.value) }, now });
  t.check(
    { exp: pass.exp, live: check(NOW + 59_999), atExp: check(NOW + 60_000) },
    // A pass whose exp is exactly now has no validity left.
    { exp: NOW + 60_000, live: true, atExp: false },
  );
});

void test("a tampered pass, junk, and a pass from another box are refused", async (t) => {
  const root = await freshBox(t);
  const other = await freshBox(t);
  const good = signBrowserPass(root, { ttlMs: 60_000, now: NOW }).value;
  const foreign = signBrowserPass(other, { ttlMs: 60_000, now: NOW }).value;
  const [payload, sig] = good.split(".");
  const forged = `${Buffer.from(JSON.stringify({ exp: NOW + 10_000_000 })).toString("base64url")}.${sig ?? ""}`;
  const verify = (value: string): boolean =>
    verifyBrowserPass(root, { appOrigin: APP, headers: { ...SAME_ORIGIN, cookie: cookie(value) }, now: NOW });
  t.check(
    { forged: verify(forged), noDot: verify(payload ?? ""), junk: verify("x.y"), foreign: verify(foreign), good: verify(good) },
    { forged: false, noDot: false, junk: false, foreign: false, good: true },
  );
});

void test("a mobile cookie is not a pass, and a pass is not a mobile cookie", async (t) => {
  const root = await freshBox(t);
  const mobile = signMobileSession(root, { deviceId: "d1", createdBy: "owner@example.com", ttlMs: 60_000 });
  const pass = signBrowserPass(root, { ttlMs: 60_000, now: Date.now() }).value;
  t.check(
    {
      mobileAsPass: verifyBrowserPass(root, { appOrigin: APP, headers: { ...SAME_ORIGIN, cookie: cookie(mobile) } }),
      passAsMobile: verifyMobileSession(root, pass),
    },
    { mobileAsPass: false, passAsMobile: null },
  );
});

void test("one good value among several is enough", async (t) => {
  const root = await freshBox(t);
  const good = signBrowserPass(root, { ttlMs: 60_000, now: NOW }).value;
  const header = `${cookie("junk.value")}; other=1; ${cookie(good)}`;
  t.check(verifyBrowserPass(root, { appOrigin: APP, headers: { ...SAME_ORIGIN, cookie: header }, now: NOW }), true);
});

void test("a box that never minted verifies nothing", async (t) => {
  const root = await freshBox(t);
  const elsewhere = await freshBox(t);
  const value = signBrowserPass(elsewhere, { ttlMs: 60_000, now: NOW }).value;
  t.check(verifyBrowserPass(root, { appOrigin: APP, headers: { ...SAME_ORIGIN, cookie: cookie(value) }, now: NOW }), false);
});

void test("only the box's own pages and typed navigations may use a pass", (t) => {
  const ws = { upgrade: "websocket" };
  t.check(
    {
      sameOrigin: passSiteOk({ "sec-fetch-site": "same-origin" }, APP),
      typed: passSiteOk({ "sec-fetch-site": "none" }, APP),
      // A sibling subdomain is same-site: a Strict cookie still rides its requests.
      sameSite: passSiteOk({ "sec-fetch-site": "same-site" }, APP),
      crossSite: passSiteOk({ "sec-fetch-site": "cross-site" }, APP),
      // Chrome labels no WebSocket handshake, so the Origin decides.
      wsOwnOrigin: passSiteOk({ ...ws, origin: APP }, APP),
      wsSibling: passSiteOk({ ...ws, origin: "https://other.example.com" }, APP),
      wsNoAppOrigin: passSiteOk({ ...ws, origin: APP }, null),
      unlabelledHttp: passSiteOk({ origin: APP }, APP),
    },
    {
      sameOrigin: true,
      typed: true,
      sameSite: false,
      crossSite: false,
      wsOwnOrigin: true,
      wsSibling: false,
      wsNoAppOrigin: false,
      unlabelledHttp: false,
    },
  );
  t.end();
});

void test("a cross-site request with a good pass is refused", async (t) => {
  const root = await freshBox(t);
  const good = signBrowserPass(root, { ttlMs: 60_000, now: NOW }).value;
  t.check(
    verifyBrowserPass(root, { appOrigin: APP, headers: { "sec-fetch-site": "cross-site", cookie: cookie(good) }, now: NOW }),
    false,
  );
});

void test("stripping keeps other cookies and only the passes the target accepts", (t) => {
  const keepOnly = (value: string): boolean => value === "mine";
  t.check(
    {
      mixed: stripForeignBrowserPasses(`a=1; ${cookie("theirs")}; ${cookie("mine")}; b=2`, keepOnly),
      onlyForeign: stripForeignBrowserPasses(cookie("theirs"), keepOnly),
      none: stripForeignBrowserPasses(undefined, keepOnly),
    },
    { mixed: `a=1; ${cookie("mine")}; b=2`, onlyForeign: undefined, none: undefined },
  );
  t.end();
});
