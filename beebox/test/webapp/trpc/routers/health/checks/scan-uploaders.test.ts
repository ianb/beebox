// # Health check — stale scan uploaders
//
// A copied `scan-uploader.mjs` never updates itself, so an old copy keeps sweeping
// against a box that has moved on. It might *work* and still be missing features.
// The box records what each uploader says it is (see
// `test/core/scan/tokens.doctest.md`) and this check is where a person sees that
// one is behind.
//
// Health rather than a notification, on purpose: a push alert reaches nobody
// unless the boxholder wired a channel, and there is no notification history to
// look back at. A stale uploader is also a *sticky* condition — true on every
// request until someone re-copies the bundle — and a pull surface reports a
// standing condition without nagging. Same reasoning as `template-updates`.

import { test } from "tap";
import "agent-doctest/tap";
import { any, str } from "agent-doctest/check";
import { makeTmpBox } from "../../../../../helpers/doctest-helpers.js";
import { createScanToken, resolveScanRequestAuth, revokeScanToken } from "../../../../../../src/core/scan/tokens.js";
import { scanUploaderFreshnessCheck } from "../../../../../../src/webapp/trpc/routers/health/checks/scan-uploaders.js";

const BOX_DEPLOYED_AT = "2026-09-10T00:00:00.000Z";
const BOX_CONTRACT = 2;
const NOW = new Date("2026-09-14T00:00:00.000Z");

/** Mints a token and makes one request as an uploader with the given identity,
 * which is how a real box learns what is talking to it. */
async function uploaderCalled(boxRoot: string, params: {
  name: string;
  contract?: string;
  build?: string;
  builtAt?: string;
}): Promise<void> {
  const minted = await createScanToken(boxRoot, { name: params.name, createdBy: null });
  await resolveScanRequestAuth(boxRoot, {
    authorization: `Bearer ${minted.token}`,
    ...(params.contract === undefined ? {} : { "x-scan-contract": params.contract }),
    ...(params.build === undefined ? {} : { "x-scan-client-build": params.build }),
    ...(params.builtAt === undefined ? {} : { "x-scan-client-built-at": params.builtAt }),
  });
}

function check(boxRoot: string): string {
  const result = scanUploaderFreshnessCheck(boxRoot, {
    deployedAt: BOX_DEPLOYED_AT,
    contractVersion: BOX_CONTRACT,
    now: NOW,
  });
  return `${result.name} ok=${String(result.ok)} severity=${result.severity}`;
}

function message(boxRoot: string): string {
  return scanUploaderFreshnessCheck(boxRoot, {
    deployedAt: BOX_DEPLOYED_AT,
    contractVersion: BOX_CONTRACT,
    now: NOW,
  }).message;
}

// ## A box with no uploaders has nothing to report
void test("A box with no uploaders has nothing to report", async (t) => {
  t.teardown(async () => {
    try {
      await emptyBox.cleanup();
      await currentBox.cleanup();
      await oldBuildBox.cleanup();
      await oldContractBox.cleanup();
      await silentBox.cleanup();
      await sourceBox.cleanup();
      await staleCheckoutBox.cleanup();
      await skewedBox.cleanup();
      await revokedBox.cleanup();
      await localBox.cleanup();
      await junkBox.cleanup();
      await fleetBox.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L62
  const emptyBox = await makeTmpBox();
  t.check(check(emptyBox.root), "scan-uploaders ok=true severity=warning");

  // doctest:L68
  t.check(message(emptyBox.root), "No scan uploaders configured");

  // ## A current uploader passes
  //
  // Built after the box's deploy and speaking the box's contract.

  // doctest:L77
  const currentBox = await makeTmpBox();
  await uploaderCalled(currentBox.root, {
    name: "scansnap-laptop",
    contract: "2",
    build: "16e177c0",
    builtAt: "2026-09-12T00:00:00.000Z",
  });
  t.check(check(currentBox.root), "scan-uploaders ok=true severity=warning");

  // doctest:L89
  t.check(message(currentBox.root), "1 scan uploader configured; none reported an out-of-date build");

  // ## A build older than the box's deploy is out of date
  //
  // The comparison is two timestamps from the same monorepo, which is ordered and
  // honest in a way comparing git hashes could never be — an uploader's revision
  // hash says nothing about which is newer.

  // doctest:L100
  const oldBuildBox = await makeTmpBox();
  await uploaderCalled(oldBuildBox.root, {
    name: "scansnap-laptop",
    contract: "2",
    build: "aaaa1111",
    builtAt: "2026-03-11T00:00:00.000Z",
  });
  t.check(check(oldBuildBox.root), "scan-uploaders ok=false severity=warning");

  // Severity stays `warning` even when it fires: an old uploader still uploads, and
  // this must never fail a deploy.
  //
  // The message names the uploader, what it reported, and the remedy — which has to
  // be spelled out, because nothing fetches the bundle and there is no update path
  // except copying the file again:

  // doctest:L119
  t.check(message(oldBuildBox.root), str`${any(String)}scansnap-laptop (build aaaa1111, built 2026-03-11T00:00:00.000Z, contract v2)${any(String)}re-copy dist/scan-uploader.mjs${any(String)}`);

  // ## A contract version below the box's is out of date
  //
  // Independent of the build date — an uploader can be freshly built off a stale
  // branch.

  // doctest:L129
  const oldContractBox = await makeTmpBox();
  await uploaderCalled(oldContractBox.root, {
    name: "scansnap-laptop",
    contract: "1",
    build: "bbbb2222",
    builtAt: "2026-09-12T00:00:00.000Z",
  });
  t.check(check(oldContractBox.root), "scan-uploaders ok=false severity=warning");

  // ## An uploader that reported nothing is not stale
  //
  // This is the case that decides whether the check is usable at all. Every
  // uploader in existence reported nothing before these headers shipped, so
  // treating "unknown" as "stale" would light up the whole fleet on day one.

  // doctest:L147
  const silentBox = await makeTmpBox();
  await uploaderCalled(silentBox.root, { name: "older-uploader" });
  t.check(check(silentBox.root), "scan-uploaders ok=true severity=warning");

  // ## A checkout is exempt from the build date, not from the contract
  //
  // `source` means "not a copied bundle", which is not the same as "current". There
  // is no build, so there is no date to compare and a clone date would say nothing
  // about the code being run — but a checkout sitting on an old branch runs old code
  // on every sweep and reports the old contract version itself. That report is the
  // signal to believe, so `source` exempts the date test only.
  //
  // A checkout at the box's contract passes:

  // doctest:L164
  const sourceBox = await makeTmpBox();
  await uploaderCalled(sourceBox.root, { name: "dev-checkout", contract: "2", build: "source" });
  t.check(check(sourceBox.root), "scan-uploaders ok=true severity=warning");

  // A checkout below it does not:

  // doctest:L173
  const staleCheckoutBox = await makeTmpBox();
  await uploaderCalled(staleCheckoutBox.root, { name: "old-branch-checkout", contract: "1", build: "source" });
  t.check(check(staleCheckoutBox.root), "scan-uploaders ok=false severity=warning");

  // ## A revoked uploader is not reported
  //
  // A revoked credential cannot upload, so its build is not a problem anyone needs
  // to act on.

  // doctest:L185
  const revokedBox = await makeTmpBox();
  await uploaderCalled(revokedBox.root, {
    name: "retired-laptop",
    contract: "1",
    build: "cccc3333",
    builtAt: "2026-01-01T00:00:00.000Z",
  });
  await revokeScanToken(revokedBox.root, "retired-laptop");
  t.check(check(revokedBox.root), "scan-uploaders ok=true severity=warning");

  // doctest:L198
  t.check(message(revokedBox.root), "No scan uploaders configured");

  // ## With no deploy time, the check judges nothing
  //
  // `deploy-info.json` is absent in local dev and in every worktree, so there is no
  // deploy for a build to be older than. The contract comparison still applies —
  // that number is known without a deploy.

  // doctest:L209
  const localBox = await makeTmpBox();
  await uploaderCalled(localBox.root, {
    name: "scansnap-laptop",
    contract: "2",
    build: "dddd4444",
    builtAt: "2026-01-01T00:00:00.000Z",
  });
  const local = scanUploaderFreshnessCheck(localBox.root, { deployedAt: null, contractVersion: BOX_CONTRACT, now: NOW });
  t.check(`ok=${String(local.ok)}`, "ok=true");

  // doctest:L222
  const localBehind = scanUploaderFreshnessCheck(localBox.root, { deployedAt: null, contractVersion: 9, now: NOW });
  t.check(`ok=${String(localBehind.ok)}`, "ok=false");

  // ## An unreadable build time or contract is no opinion, never a verdict
  //
  // These are untrusted client strings. A diagnostic field must not manufacture a
  // stale verdict out of something it could not parse.

  // doctest:L233
  const junkBox = await makeTmpBox();
  await uploaderCalled(junkBox.root, {
    name: "confused-uploader",
    contract: "not-a-number",
    build: "eeee5555",
    builtAt: "the day before yesterday",
  });
  t.check(check(junkBox.root), "scan-uploaders ok=true severity=warning");

  // ## A build stamp claiming the future is reported, not trusted
  //
  // The stamp comes from the build machine's clock. A skewed clock produces a build
  // time no deploy can ever be later than, which would report a genuinely old
  // bundle as fine forever — the one failure worse than having no check, because it
  // answers the question wrongly rather than not at all.

  // doctest:L252
  const skewedBox = await makeTmpBox();
  await uploaderCalled(skewedBox.root, {
    name: "clock-skewed-laptop",
    contract: "2",
    build: "9999abcd",
    builtAt: "2099-01-01T00:00:00.000Z",
  });
  t.check(check(skewedBox.root), "scan-uploaders ok=false severity=warning");

  // ## Several uploaders are named individually
  //
  // The boxholder has to know *which* machine to go and re-copy the file on.

  // doctest:L268
  const fleetBox = await makeTmpBox();
  await uploaderCalled(fleetBox.root, { name: "desk-laptop", contract: "2", build: "f1", builtAt: "2026-03-01T00:00:00.000Z" });
  await uploaderCalled(fleetBox.root, { name: "travel-laptop", contract: "2", build: "f2", builtAt: "2026-09-13T00:00:00.000Z" });
  await uploaderCalled(fleetBox.root, { name: "spare-laptop", contract: "2", build: "f3", builtAt: "2026-04-01T00:00:00.000Z" });
  t.check(message(fleetBox.root), str`${any(String)}2 scan uploaders out of date: desk-laptop (build f1${any(String)}); spare-laptop (build f3${any(String)}`);
});
