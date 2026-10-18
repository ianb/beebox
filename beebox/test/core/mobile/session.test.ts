// Mobile session cookie: signing, verification, and every way it fails closed.
//
// `bbx_mobile` is the short-lived credential that lets a paired mobile device
// authenticate a navigation or a WebSocket upgrade without putting its durable
// device token in a URL. Verification is pure HMAC over a per-box secret, so
// it costs no filesystem access on the request path. The whole cookie is
// attacker-controlled input, so every malformed shape must return null rather
// than throw.

import { test } from "tap";
import "agent-doctest/tap";
import { any } from "agent-doctest/check";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  MOBILE_COOKIE_NAME,
  MOBILE_SESSION_TTL_MS,
  clearMobileSessionSecretCache,
  signMobileSession,
  verifyMobileSession,
} from "../../../src/core/mobile/session.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";

// docs/mobile-contract.md §8 pins the cookie name; a rename here is a
// contract break that must move both sides together.
void test("the constants are the mirrored contract", async (t) => {
  t.check(MOBILE_COOKIE_NAME, "bbx_mobile");
  t.check(MOBILE_SESSION_TTL_MS, 3_600_000);
});

void test("a minted cookie verifies back to its device", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  clearMobileSessionSecretCache();
  const cookie = signMobileSession(box.root, { deviceId: "device-1", createdBy: "owner@example.com", ttlMs: MOBILE_SESSION_TTL_MS });

  // The payload carries the whole mobile identity. `createdBy` is what
  // capture-request-owner.ts uses to enforce cross-user isolation, so a
  // cookie that dropped it would silently weaken that check.
  t.check(verifyMobileSession(box.root, cookie), { deviceId: "device-1", createdBy: "owner@example.com", exp: any(Number).int() });

  // The secret is created on first use inside the box's .beebox/ directory,
  // readable only by the box owner: the same placement and mode as the
  // device store it complements.
  const secretFile = path.join(box.root, ".beebox/mobile-session.secret");
  t.check((fs.statSync(secretFile).mode & 0o777).toString(8), "600");

  // A second mint reuses that secret, so cookies minted across requests stay
  // mutually valid.
  const second = signMobileSession(box.root, { deviceId: "device-2", createdBy: null, ttlMs: 60_000 });
  t.check(verifyMobileSession(box.root, second), { deviceId: "device-2", createdBy: null, exp: any(Number).int() });
  t.check(verifyMobileSession(box.root, cookie), { deviceId: "device-1", createdBy: "owner@example.com", exp: any(Number).int() });
});

void test("every forged, expired, or malformed cookie is null", async (t) => {
  const box = await makeTmpBox();
  const otherBox = await makeTmpBox();
  t.teardown(async () => {
    await box.cleanup();
    await otherBox.cleanup();
    clearMobileSessionSecretCache();
  });
  const sign = (root: string, opts: { ttlMs?: number; deviceId?: string }) =>
    signMobileSession(root, { deviceId: opts.deviceId ?? "device-1", createdBy: null, ttlMs: opts.ttlMs ?? 60_000 });
  const cookie = sign(box.root, {});
  const [payloadB64, signature] = cookie.split(".");
  const forgedPayload = Buffer.from(JSON.stringify({ deviceId: "attacker", exp: Date.now() + 60_000 })).toString("base64url");

  const rejected: Record<string, string | undefined> = {
    // `exp` is stamped at mint time, so a zero TTL is already in the past.
    "expired (zero TTL)": sign(box.root, { ttlMs: 0 }),
    "expired (negative TTL)": sign(box.root, { ttlMs: -60_000 }),
    // Flipping the payload while keeping the signature: the HMAC no longer matches.
    "forged payload": `${forgedPayload}.${signature}`,
    // A signature of a different length matters because crypto.timingSafeEqual
    // throws on a length mismatch rather than returning false.
    "longer signature": `${payloadB64}.${signature}00`,
    "empty signature": `${payloadB64}.`,
    "non-hex signature": `${payloadB64}.notevenhex`,
    // Box B cannot verify, and so could never forge, box A's cookie. The
    // reverse case is below, so this is mutual.
    "another box's cookie": sign(otherBox.root, {}),
    // Garbage from a hostile client; none may reach a catch in a caller.
    "no cookie": undefined,
    "empty": "",
    "no dot": "no-dot-at-all",
    "only a dot": ".",
    "not base64": "!!!not-base64!!!.abc",
    // The schema runs after the HMAC, so a payload we signed but cannot
    // parse fails closed rather than being trusted for its signature.
    "signed but invalid payload": sign(box.root, { deviceId: "" }),
  };
  const results = Object.fromEntries(Object.entries(rejected).map(([name, c]) => [name, verifyMobileSession(box.root, c)]));
  t.check(results, {
    "expired (zero TTL)": null,
    "expired (negative TTL)": null,
    "forged payload": null,
    "longer signature": null,
    "empty signature": null,
    "non-hex signature": null,
    "another box's cookie": null,
    "no cookie": null,
    "empty": null,
    "no dot": null,
    "only a dot": null,
    "not base64": null,
    "signed but invalid payload": null,
  });
  t.check(verifyMobileSession(otherBox.root, cookie), null);
  t.check(verifyMobileSession(otherBox.root, sign(otherBox.root, {})), { deviceId: "device-1", createdBy: null, exp: any(Number).int() });
});
