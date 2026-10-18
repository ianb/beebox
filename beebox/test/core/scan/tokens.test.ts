// # Scan upload tokens: a store mobile auth can never read
//
// The scan upload credential shares its *mechanics* with the mobile device store
// (hashed tokens, cross-process locking, `lastUsedAt`, revocation — all in
// `core/token-store.ts`) but lives in its own file behind its own `TokenStore`
// instance. That separation is the security property: every mobile gate reduces
// identity to a boolean, and any valid device bearer can mint a full session
// cookie, so a "scope" field on one shared store could not be contained (see
// `docs/plans/scanner-ingest.review.md` finding 1). Two stores, two files, no
// cross-resolution.

import { test } from "tap";
import "agent-doctest/tap";
import { printed } from "agent-doctest/check";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import {
  createScanToken,
  listScanTokens,
  revokeScanToken,
  verifyScanToken,
  resolveScanRequestAuth,
} from "../../../src/core/scan/tokens.js";
import {
  createMobilePairingTicket,
  redeemMobilePairingTicket,
} from "../../../src/core/mobile/pairing.js";
import { resolveMobileRequestAuth } from "../../../src/core/mobile/request-auth.js";

const SCAN_STORE = ".beebox/scan-tokens.secret.json";
const MOBILE_STORE = ".beebox/mobile-devices.secret.json";

// ## Mint returns the secret once; the store keeps only a hash
void test("Mint returns the secret once; the store keeps only a hash", async (t) => {
  const out = printed();
  const print = out.print;
  t.teardown(async () => {
    try {
      await idBox.cleanup();
      await oldBox.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L39
  const box = await makeTmpBox();
  const minted = await createScanToken(box.root, { name: "laptop-scansnap", createdBy: "owner@example.com" });

  // doctest:L42
  await t.checkText(out.with(minted.token.length > 20), "true");

  // The plaintext never lands on disk — the store holds a SHA-256 hash, so a lost
  // token is re-minted, never recovered.

  // doctest:L50
  const raw = fs.readFileSync(path.join(box.root, SCAN_STORE), "utf-8");
  print(`stores plaintext: ${raw.includes(minted.token)}`);
  print(`stores a hash: ${/"tokenHash": "[\da-f]{64}"/.test(raw)}`);
  await t.checkText(out.with(print(`mode: ${(fs.statSync(path.join(box.root, SCAN_STORE)).mode & 0o777).toString(8)}`)), `stores plaintext: false
stores a hash: true
mode: 600`);

  // ## Verify returns the record; a wrong token returns null

  // doctest:L63
  await t.checkText(out.with((await verifyScanToken(box.root, minted.token))?.name), "laptop-scansnap");

  // doctest:L66
  await t.checkText(out.with(await verifyScanToken(box.root, "not-a-real-token")), "null");

  // doctest:L69
  await t.checkText(out.with(await verifyScanToken(box.root, undefined)), "null");

  // Bearer parsing is shared by the box preHandler and the hub gate, so it is
  // exercised directly: only a well-formed `Bearer <token>` resolves.

  // doctest:L77
  await t.checkText(out.with((await resolveScanRequestAuth(box.root, { authorization: `Bearer ${minted.token}` }))?.name), "laptop-scansnap");

  // doctest:L80
  await t.checkText(out.with(await resolveScanRequestAuth(box.root, { authorization: minted.token })), "null");

  // doctest:L83
  await t.checkText(out.with(await resolveScanRequestAuth(box.root, {})), "null");

  // ## `list` shows names and usage, never secrets
  //
  // Verifying stamped `lastUsedAt`, which is how the boxholder tells a live uploader
  // from an abandoned credential.

  // doctest:L93
  const listed = listScanTokens(box.root);
  const [listedFirst] = listed;
  assert.ok(listedFirst);
  await t.checkText(
    out.with(JSON.stringify({
      count: listed.length,
      name: listedFirst.name,
      revoked: listedFirst.revoked,
      usedRecently: typeof listedFirst.lastUsedAt === "string",
      fields: Object.keys(listedFirst).toSorted().join(","),
    })),
    "{\"count\":1,\"name\":\"laptop-scansnap\",\"revoked\":false,\"usedRecently\":true,\"fields\":\"createdAt,createdBy,lastClient,lastUsedAt,name,revoked\"}",
  );

  // ## Revocation is immediate and one-way

  // doctest:L109
  await t.checkText(out.with(await revokeScanToken(box.root, "laptop-scansnap")), "true");

  // doctest:L112
  await t.checkText(out.with(await verifyScanToken(box.root, minted.token)), "null");

  // A second revoke reports false (nothing left to revoke), and the record stays
  // listed so the boxholder can see the credential existed.

  // doctest:L120
  await t.checkText(out.with(await revokeScanToken(box.root, "laptop-scansnap")), "false");

  // doctest:L123
  await t.checkText(out.with(await revokeScanToken(box.root, "never-existed")), "false");

  // doctest:L126
  await t.checkText(out.with(JSON.stringify(listScanTokens(box.root).map((r) => [r.name, r.revoked]))), "[[\"laptop-scansnap\",true]]");

  // ## Names are the revoke handle, so they're unique and constrained
  //
  // A name also travels into card provenance as `scan-upload/<name>`, so the
  // charset is conservative.

  // doctest:L136
  await createScanToken(box.root, { name: "desk-scanner", createdBy: null });
  const nameError = (name: string) =>
    createScanToken(box.root, { name, createdBy: null }).then(
      () => "no error",
      (e: unknown) => (e instanceof Error ? e.name : String(e)),
    );

  // doctest:L143
  await t.checkText(out.with(await nameError("desk-scanner")), "DuplicateScanTokenNameError");

  // doctest:L146
  await t.checkText(out.with(await nameError("../../etc/passwd")), "InvalidScanTokenNameError");

  // doctest:L149
  await t.checkText(out.with(await nameError("")), "InvalidScanTokenNameError");

  // ## The two stores cannot resolve each other's credentials
  //
  // This is the structural claim Track 1 rests on. A mobile device token is not a
  // scan token, and a scan token resolves to no mobile identity — not because a
  // check rejects it, but because each resolver reads a different file.

  // doctest:L160
  const ticket = createMobilePairingTicket(box.root, { createdBy: "owner@example.com" });
  const device = await redeemMobilePairingTicket(box.root, { pairingToken: ticket.token, deviceLabel: "phone" });
  assert.ok(device);
  const scan = await createScanToken(box.root, { name: "uploader", createdBy: null });

  // doctest:L165
  await t.checkText(
    out.with(// A mobile device token is worthless against the scan store...
    await verifyScanToken(box.root, device.deviceToken)),
    "null",
  );

  // doctest:L169
  await t.checkText(
    out.with(// ...and a scan token is worthless against every mobile gate.
    await resolveMobileRequestAuth(box.root, { authorization: `Bearer ${scan.token}` })),
    "null",
  );

  // The files themselves are disjoint: neither store's bytes mention the other's
  // tokens or hashes.

  // doctest:L178
  const scanBytes = fs.readFileSync(path.join(box.root, SCAN_STORE), "utf-8");
  const mobileBytes = fs.readFileSync(path.join(box.root, MOBILE_STORE), "utf-8");
  print(`scan store holds only scan names: ${scanBytes.includes("uploader") && !scanBytes.includes("phone")}`);
  await t.checkText(out.with(print(`mobile store holds only devices: ${mobileBytes.includes("phone") && !mobileBytes.includes("uploader")}`)), `scan store holds only scan names: true
mobile store holds only devices: true`);

  // ## A concurrent verify and revoke cannot un-revoke the token
  //
  // Both are read-modify-writes on the same file from possibly different processes
  // (the hub verifies before proxying; the box child revokes). The shared lock makes
  // the verify read the post-revoke record instead of clobbering it.

  // doctest:L194
  const racy = await createScanToken(box.root, { name: "racy", createdBy: null });
  await Promise.all([
    verifyScanToken(box.root, racy.token),
    revokeScanToken(box.root, "racy"),
  ]);

  // doctest:L200
  await t.checkText(out.with(await verifyScanToken(box.root, racy.token)), "null");

  // doctest:L203
  await t.checkText(out.with(fs.readdirSync(path.join(box.root, ".beebox")).filter((f) => f.startsWith("scan-tokens.secret.json.tmp")).length), "0");

  // ## The request path records what the uploader said it was
  //
  // An uploader volunteers its contract version and build on every request. The box
  // records them and never acts on them at the gate — an old uploader is reported,
  // not refused — so this is provenance, not a credential check.

  // doctest:L214
  const idBox = await makeTmpBox();
  const idToken = await createScanToken(idBox.root, { name: "scansnap-laptop", createdBy: null });
  await resolveScanRequestAuth(idBox.root, {
    authorization: `Bearer ${idToken.token}`,
    "x-scan-contract": "1",
    "x-scan-client-build": "16e177c0",
    "x-scan-client-built-at": "2026-09-14T18:46:01.243Z",
  });
  await t.checkText(out.with(JSON.stringify(listScanTokens(idBox.root)[0]?.lastClient)), "{\"contract\":\"1\",\"build\":\"16e177c0\",\"builtAt\":\"2026-09-14T18:46:01.243Z\"}");

  // A checkout reports `source` instead of a build, which is the honest answer: it
  // runs current source every sweep and cannot drift.

  // doctest:L230
  await resolveScanRequestAuth(idBox.root, {
    authorization: `Bearer ${idToken.token}`,
    "x-scan-contract": "1",
    "x-scan-client-build": "source",
  });
  await t.checkText(out.with(JSON.stringify(listScanTokens(idBox.root)[0]?.lastClient)), "{\"contract\":\"1\",\"build\":\"source\",\"builtAt\":null}");

  // A later request that reports nothing CLEARS what was recorded, rather than
  // leaving the previous uploader's identity in place. One token can be used by
  // more than one uploader — a second laptop, or the same laptop after an older
  // bundle is copied over the newer one — and keeping the newer identity would
  // answer the stale-uploader question backwards, reporting a current build for a
  // request an older uploader made.

  // doctest:L247
  await resolveScanRequestAuth(idBox.root, { authorization: `Bearer ${idToken.token}` });
  await t.checkText(out.with(JSON.stringify(listScanTokens(idBox.root)[0]?.lastClient)), "null");

  // An uploader too old to send the headers leaves `lastClient` null rather than
  // recording a blank. "Not reported" and "reported as nothing" have to stay
  // distinct, because the freshness health check treats the first as no opinion and
  // would otherwise call every pre-existing uploader stale.

  // doctest:L258
  const oldBox = await makeTmpBox();
  const oldToken = await createScanToken(oldBox.root, { name: "older-uploader", createdBy: null });
  await resolveScanRequestAuth(oldBox.root, { authorization: `Bearer ${oldToken.token}` });
  await t.checkText(out.with(JSON.stringify(listScanTokens(oldBox.root)[0]?.lastClient)), "null");

  // Untrusted header text is capped, so a hostile or broken client cannot bloat the
  // credential store:

  // doctest:L269
  await resolveScanRequestAuth(oldBox.root, {
    authorization: `Bearer ${oldToken.token}`,
    "x-scan-client-build": "x".repeat(5000),
  });
  await t.checkText(out.with(listScanTokens(oldBox.root)[0]?.lastClient?.build?.length), "100");
});
