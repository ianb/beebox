// # The hub metadata file a box publishes
//
// `.beebox/hub-meta.json` mirrors what the hub used to read from a box's own
// files, with hashes in place of secrets (`src/core/hub-meta.ts`). Every writer
// of an input rewrites it: the agent token, a mobile pairing, a scan token, a
// revoke, `allowedEmails`, a chat schedule, and the box's display identity
// (republished by the box's own identity read, since an agent edits the
// landmark card). Nothing in it is a secret, and the hub reads it through a
// one-second cache that follows the file's mtime.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { isoDate } from "@ianbicking/tap-check/check";
import * as crypto from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { makeTmpBox } from "../helpers/test-helpers.js";
import { bearerMatchesHashes, hubMetaPath, readHubMeta, writeHubMeta } from "../../src/core/hub-meta.js";
import { getOrCreateAgentToken } from "../../src/core/agent/token.js";
import { createScanToken, revokeScanToken } from "../../src/core/scan/tokens.js";
import { createMobilePairingTicket, redeemMobilePairingTicket } from "../../src/core/mobile/pairing.js";
import { grantBoxAccess } from "../../src/webapp/box-config-write.js";
import { readBoxIdentity } from "../../src/core/landmark/box-identity.js";

const sha256 = (value: string): string => crypto.createHash("sha256").update(value).digest("hex");
const fixedNow = () => new Date("2026-10-24T12:00:00.000Z");

void test("every input change rewrites the file, with hashes and no secret", async (t) => {
  // The box unit runs with UMask=0077 (deploy/systemd/box-sandbox.conf): the
  // modes below must hold under it, since the hub reads the file from outside.
  const previousUmask = process.umask(0o077);
  const box = await makeTmpBox({ git: true });
  t.teardown(async () => { process.umask(previousUmask); await box.cleanup(); });

  // `bbx engine init` (which makeTmpBox runs) already published the file: no
  // token yet, so nothing to hash, and nobody allowed beyond the owner.
  t.check(JSON.parse(await readFile(hubMetaPath(box.root), "utf8")), {
    allowedEmails: [],
    pendingSchedules: false,
    tokenHashes: { agent: null, mobile: [], scan: [] },
    identity: { name: null, symbol: null },
    writtenAt: isoDate(),
  });
  // The hub reaches the file by path: the root and .beebox/ are traversable, not listable; the file is world-readable.
  t.check({
    root: (await stat(box.root)).mode & 0o777,
    beebox: (await stat(box.path(".beebox"))).mode & 0o777,
    file: (await stat(hubMetaPath(box.root))).mode & 0o777,
  }, { root: 0o751, beebox: 0o751, file: 0o644 });

  // Nothing changed: no rewrite.
  t.check(writeHubMeta(box.root, fixedNow), false);

  const agentToken = getOrCreateAgentToken(box.root);
  const scan = await createScanToken(box.root, { name: "laptop", createdBy: "owner@example.com" });
  const ticket = createMobilePairingTicket(box.root, { createdBy: "owner@example.com" });
  const device = await redeemMobilePairingTicket(box.root, { pairingToken: ticket.token, deviceLabel: "phone" });
  await grantBoxAccess({ boxRoot: box.root, email: "Friend@Example.com" });

  const content = await readFile(hubMetaPath(box.root), "utf8");
  t.check(JSON.parse(content), {
    // As written in box.json; the hub canonicalizes, as it does for the box's own copy.
    allowedEmails: ["friend@example.com"],
    pendingSchedules: false,
    tokenHashes: { agent: sha256(agentToken), mobile: [sha256(device?.deviceToken ?? "")], scan: [sha256(scan.token)] },
    identity: { name: null, symbol: null },
    writtenAt: isoDate(),
  });

  // The box names itself in its root landmark; the box's own identity read
  // (every page load) notices and republishes, so the hub's picker follows.
  await writeFile(box.path("_content/Box.landmark.card"), "---\nsymbol:\n  glyph: 🍳\nnavigation:\n  label: Kitchen\n---\n");
  await readBoxIdentity({ boxRoot: box.root, slug: "kitchen" });
  t.check(JSON.parse(await readFile(hubMetaPath(box.root), "utf8")).identity, { name: "Kitchen", symbol: { glyph: "🍳" } });
  // No plaintext credential reaches the file.
  t.check([agentToken, scan.token, device?.deviceToken ?? "missing"].filter((secret) => content.includes(secret)), []);

  // A revoke drops the hash at once.
  t.check(await revokeScanToken(box.root, "laptop"), true);
  t.check(JSON.parse(await readFile(hubMetaPath(box.root), "utf8")).tokenHashes.scan, []);

  // The hub's bearer check: the live token matches its hash, a revoked or junk one does not.
  const meta = readHubMeta(box.root);
  t.check(meta?.tokenHashes.agent, sha256(agentToken));
  t.check({
    agent: bearerMatchesHashes(`Bearer ${agentToken}`, meta?.tokenHashes.agent === null || meta === undefined ? [] : [meta.tokenHashes.agent]),
    device: bearerMatchesHashes(`Bearer ${device?.deviceToken ?? ""}`, meta?.tokenHashes.mobile ?? []),
    revokedScan: bearerMatchesHashes(`Bearer ${scan.token}`, meta?.tokenHashes.scan ?? []),
    junk: bearerMatchesHashes("Bearer x", meta?.tokenHashes.mobile ?? []),
    noScheme: bearerMatchesHashes(agentToken, meta?.tokenHashes.agent === null || meta === undefined ? [] : [meta.tokenHashes.agent]),
  }, { agent: true, device: true, revokedScan: false, junk: false, noScheme: false });
});

void test("the hub's read follows the file's mtime through a one-second cache, and fails closed on a malformed file", async (t) => {
  const box = await makeTmpBox({ git: true });
  t.teardown(() => box.cleanup());
  let clock = 1_000_000;
  const now = () => clock;
  const published = { allowedEmails: [], pendingSchedules: false, tokenHashes: { agent: null, mobile: [], scan: [] }, identity: { name: null, symbol: null }, writtenAt: isoDate() };

  t.check(readHubMeta(box.root, now), published);
  await writeFile(hubMetaPath(box.root), "{ not json");
  // Within the cache window the last good read still stands.
  t.check(readHubMeta(box.root, now), published);
  clock += 1_000;
  // Malformed: every credential is refused rather than guessed at; the warning names the box.
  t.check(readHubMeta(box.root, now), undefined);
  writeHubMeta(box.root, fixedNow);
  clock += 1_000;
  t.check(readHubMeta(box.root, now), { ...published, writtenAt: "2026-10-24T12:00:00.000Z" });
});
