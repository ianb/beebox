// # Mobile device store: locked, crash-safe read-modify-write
//
// The device store is written from more than one process — `bbx hub` stamps
// `lastUsedAt` when it verifies a bearer before proxying, and the per-box
// `bbx serve` child verifies it again and can revoke it. An unsynchronized
// read-modify-write there is a genuine lost update: a verify that read the record
// before a revoke could write the pre-revoke copy back and silently un-revoke the
// device. Every mutation now runs through the cross-process `file-lock.ts`
// primitive and lands via temp-file + fsync + atomic rename (mirroring the sibling
// credential store `webapp/local-users.ts`).

import { test } from "tap";
import "agent-doctest/tap";
import { any, instanceOf, isoDate, optional } from "agent-doctest/check";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import {
  createMobilePairingTicket,
  redeemMobilePairingTicket,
  revokeMobileDevice,
  resolveMobileBearerIdentity,
  listMobileDevices,
  isMobileDeviceActive,
  DeviceStoreUnreadableError,
} from "../../../src/core/mobile/pairing.js";

const STORE = ".beebox/mobile-devices.secret.json";

// ## The async round-trip: pair, verify, revoke, re-verify
//
// Verification returns the device identity and no longer un-revokes anything.
void test("Verification returns the device identity and no longer un-revokes anything.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
      await box2.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L35
  const box = await makeTmpBox();
  const ticket = createMobilePairingTicket(box.root, { createdBy: "rosa@example.com" });
  const device = await redeemMobilePairingTicket(box.root, { pairingToken: ticket.token, deviceLabel: "phone" });
  assert.ok(device);

  // doctest:L40
  const identity = await resolveMobileBearerIdentity(box.root, `Bearer ${device.deviceToken}`);
  t.check(identity?.createdBy, "rosa@example.com");

  // A revoked device stops verifying, and stays revoked on the next verify attempt.

  // doctest:L48
  t.check(await revokeMobileDevice(box.root, device.deviceId), true);

  // doctest:L51
  t.check(await resolveMobileBearerIdentity(box.root, `Bearer ${device.deviceToken}`), null);

  // ## A verify concurrent with a revoke cannot un-revoke the device
  //
  // Fire the `lastUsedAt`-stamping verify and the revoke at the same time. Whichever
  // wins the lock, the device must end up revoked — the lock makes the verify read
  // the post-revoke record instead of clobbering it with a stale one.

  // doctest:L62
  const box2 = await makeTmpBox();
  const ticket2 = createMobilePairingTicket(box2.root, { createdBy: "tomas@example.com" });
  const device2 = await redeemMobilePairingTicket(box2.root, { pairingToken: ticket2.token, deviceLabel: "phone2" });
  assert.ok(device2);

  // doctest:L67
  // Verify (RMW: stamps lastUsedAt) racing revoke (RMW: sets revokedAt).
  await Promise.all([
    resolveMobileBearerIdentity(box2.root, `Bearer ${device2.deviceToken}`),
    revokeMobileDevice(box2.root, device2.deviceId),
  ]);

  // doctest:L73
  const devices = listMobileDevices(box2.root);
  // lastUsedAt is stamped only when the verify wins the lock before the revoke.
  t.check(devices, [{
    id: device2.deviceId,
    label: "phone2",
    createdAt: isoDate(),
    createdBy: "tomas@example.com",
    lastUsedAt: optional(isoDate()),
    revokedAt: isoDate(),
    push: null,
  }]);

  // The device no longer authenticates, and never will again from this token.

  // doctest:L81
  t.check(await resolveMobileBearerIdentity(box2.root, `Bearer ${device2.deviceToken}`), null);

  // ## The store stays valid JSON and 0600, with no temp files left behind
  //
  // The atomic rename means a reader never sees a half-written file, and the fsync'd
  // temp sibling is always renamed away — a concurrent burst leaves exactly one
  // `mode 600` store and no `.tmp-*` litter.

  // doctest:L92
  t.check(JSON.parse(fs.readFileSync(path.join(box2.root, STORE), "utf-8")), {
    devices: [{
      id: device2.deviceId,
      label: "phone2",
      tokenHash: any(String),
      createdAt: isoDate(),
      createdBy: "tomas@example.com",
      lastUsedAt: optional(isoDate()),
      revokedAt: isoDate(),
    }],
  });

  // doctest:L95
  t.check((fs.statSync(path.join(box2.root, STORE)).mode & 0o777).toString(8), "600");

  // doctest:L98
  t.check(fs.readdirSync(path.join(box2.root, ".beebox")).filter((f) => f.startsWith("mobile-devices.secret.json.tmp")), []);
});

// ## An unreadable store fails closed — a write never clobbers it
//
// If the store file exists but is corrupt (unparseable), a mutation must NOT
// overwrite it with just the new device (that would silently drop every device it
// failed to load). `readDeviceStore` throws `DeviceStoreUnreadableError`, so the
// redemption aborts and the file is left byte-for-byte intact.
void test("If the store file exists but is corrupt (unparseable), a mutation must NOT ov...", async (t) => {
  t.teardown(async () => {
    try {
      await box3.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L115
  const box3 = await makeTmpBox();
  const storeFile = path.join(box3.root, STORE);
  fs.mkdirSync(path.dirname(storeFile), { recursive: true });
  fs.writeFileSync(storeFile, "{ this is not valid json ", "utf-8");

  // doctest:L120
  const ticket3 = createMobilePairingTicket(box3.root, { createdBy: "carol@example.com" });
  const caught = await redeemMobilePairingTicket(box3.root, { pairingToken: ticket3.token, deviceLabel: "phone3" })
    .then(() => null, (e) => e);
  t.check(caught, instanceOf(DeviceStoreUnreadableError));
  t.check(fs.readFileSync(storeFile, "utf-8"), "{ this is not valid json ");
});

// ## isMobileDeviceActive fails closed on an unreadable store
//
// The lock-free renewal check must deny (return `false`) rather than throw or mint
// a cookie when the store can't be read.
void test("The lock-free renewal check must deny (return false) rather than throw or min...", async (t) => {
  t.teardown(async () => {
    try {
      await box4.cleanup();
      await box5.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L140
  const box4 = await makeTmpBox();
  const storeFile4 = path.join(box4.root, STORE);
  fs.mkdirSync(path.dirname(storeFile4), { recursive: true });
  fs.writeFileSync(storeFile4, "corrupt", "utf-8");

  // doctest:L145
  t.check(isMobileDeviceActive(box4.root, "any-device-id"), false);

  // An absent store is genuinely empty (not unreadable) — no throw, just inactive.

  // doctest:L152
  const box5 = await makeTmpBox();
  t.check(isMobileDeviceActive(box5.root, "any-device-id"), false);
});

// ## Large store round-trips intact (looped writeSync lands the whole buffer)
//
// A store far bigger than a single `writeSync` might return in one call must be
// written completely — the write loops until every byte lands.
void test("A store far bigger than a single writeSync might return in one call must be w...", async (t) => {
  t.teardown(async () => {
    try {
      await box6.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L168
  const box6 = await makeTmpBox();
  let ticket6;
  for (let i = 0; i < 200; i++) {
    ticket6 = createMobilePairingTicket(box6.root, { createdBy: `user${i}@example.com` });
    await redeemMobilePairingTicket(box6.root, { pairingToken: ticket6.token, deviceLabel: `device-${i}` });
  }
  const devices6 = listMobileDevices(box6.root);
  const expectedLabels = Array.from({ length: 200 }, (_, i) => `device-${i}`);
  t.check(devices6.map((d) => d.label), expectedLabels);
  t.check(JSON.parse(fs.readFileSync(path.join(box6.root, STORE), "utf-8")).devices.map((d: { label: string }) => d.label), expectedLabels);
  t.check(fs.readdirSync(path.join(box6.root, ".beebox")).filter((f) => f.includes(".tmp-")), []);
});
