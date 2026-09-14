# Health check — stale scan uploaders

A copied `scan-uploader.mjs` never updates itself, so an old copy keeps sweeping
against a box that has moved on. It might *work* and still be missing features.
The box records what each uploader says it is (see
`test/core/scan/tokens.doctest.md`) and this check is where a person sees that
one is behind.

Health rather than a notification, on purpose: push and Telegram reach nobody
unless the boxholder wired a channel, and there is no notification history to
look back at. A stale uploader is also a *sticky* condition — true on every
request until someone re-copies the bundle — and a pull surface reports a
standing condition without nagging. Same reasoning as `template-updates`.

```ts setup
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { createScanToken, resolveScanRequestAuth, revokeScanToken } from "../../../src/core/scan/tokens.js";
import { scanUploaderFreshnessCheck } from "../../../src/webapp/trpc/routers/health-scan-uploaders.js";

const BOX_DEPLOYED_AT = "2026-09-10T00:00:00.000Z";
const BOX_CONTRACT = 2;

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
  });
  return `${result.name} ok=${String(result.ok)} severity=${result.severity}`;
}

function message(boxRoot: string): string {
  return scanUploaderFreshnessCheck(boxRoot, {
    deployedAt: BOX_DEPLOYED_AT,
    contractVersion: BOX_CONTRACT,
  }).message;
}
```

## A box with no uploaders has nothing to report

```ts
const emptyBox = await makeTmpBox();
check(emptyBox.root)
=> scan-uploaders ok=true severity=warning
```

```ts continue
message(emptyBox.root)
=> No scan uploaders configured
```

## A current uploader passes

Built after the box's deploy and speaking the box's contract.

```ts continue
const currentBox = await makeTmpBox();
await uploaderCalled(currentBox.root, {
  name: "scansnap-laptop",
  contract: "2",
  build: "16e177c0",
  builtAt: "2026-09-12T00:00:00.000Z",
});
check(currentBox.root)
=> scan-uploaders ok=true severity=warning
```

```ts continue
message(currentBox.root)
=> 1 scan uploader configured; none reported an out-of-date build
```

## A build older than the box's deploy is out of date

The comparison is two timestamps from the same monorepo, which is ordered and
honest in a way comparing git hashes could never be — an uploader's revision
hash says nothing about which is newer.

```ts continue
const oldBuildBox = await makeTmpBox();
await uploaderCalled(oldBuildBox.root, {
  name: "scansnap-laptop",
  contract: "2",
  build: "aaaa1111",
  builtAt: "2026-03-11T00:00:00.000Z",
});
check(oldBuildBox.root)
=> scan-uploaders ok=false severity=warning
```

Severity stays `warning` even when it fires: an old uploader still uploads, and
this must never fail a deploy.

The message names the uploader, what it reported, and the remedy — which has to
be spelled out, because nothing fetches the bundle and there is no update path
except copying the file again:

```ts continue
message(oldBuildBox.root)
=> «*»scansnap-laptop (build aaaa1111, built 2026-03-11T00:00:00.000Z, contract v2)«*»re-copy dist/scan-uploader.mjs«*»
```

```ts continue
message(oldBuildBox.root)
=> «*»rules for when a scanned file is safe to move or delete«*»
```

## A contract version below the box's is out of date

Independent of the build date — an uploader can be freshly built off a stale
branch.

```ts continue
const oldContractBox = await makeTmpBox();
await uploaderCalled(oldContractBox.root, {
  name: "scansnap-laptop",
  contract: "1",
  build: "bbbb2222",
  builtAt: "2026-09-12T00:00:00.000Z",
});
check(oldContractBox.root)
=> scan-uploaders ok=false severity=warning
```

## An uploader that reported nothing is not stale

This is the case that decides whether the check is usable at all. Every
uploader in existence reported nothing before these headers shipped, so
treating "unknown" as "stale" would light up the whole fleet on day one.

```ts continue
const silentBox = await makeTmpBox();
await uploaderCalled(silentBox.root, { name: "older-uploader" });
check(silentBox.root)
=> scan-uploaders ok=true severity=warning
```

## A checkout is never stale

`source` means the uploader runs current source through tsx on every sweep, so
it tracks the box by construction however long ago it was cloned. Reporting it
as stale would be wrong, and would train the reader to ignore this check.

```ts continue
const sourceBox = await makeTmpBox();
await uploaderCalled(sourceBox.root, { name: "dev-checkout", contract: "1", build: "source" });
check(sourceBox.root)
=> scan-uploaders ok=true severity=warning
```

Note that this one reported contract v1 against a box at v2 and still passes:
`source` short-circuits both tests, because a checkout's *next* sweep already
runs current code. The stale-contract signal is for a bundle, which cannot fix
itself.

## A revoked uploader is not reported

A revoked credential cannot upload, so its build is not a problem anyone needs
to act on.

```ts continue
const revokedBox = await makeTmpBox();
await uploaderCalled(revokedBox.root, {
  name: "retired-laptop",
  contract: "1",
  build: "cccc3333",
  builtAt: "2026-01-01T00:00:00.000Z",
});
await revokeScanToken(revokedBox.root, "retired-laptop");
check(revokedBox.root)
=> scan-uploaders ok=true severity=warning
```

```ts continue
message(revokedBox.root)
=> No scan uploaders configured
```

## With no deploy time, the check judges nothing

`deploy-info.json` is absent in local dev and in every worktree, so there is no
deploy for a build to be older than. The contract comparison still applies —
that number is known without a deploy.

```ts continue
const localBox = await makeTmpBox();
await uploaderCalled(localBox.root, {
  name: "scansnap-laptop",
  contract: "2",
  build: "dddd4444",
  builtAt: "2026-01-01T00:00:00.000Z",
});
const local = scanUploaderFreshnessCheck(localBox.root, { deployedAt: null, contractVersion: BOX_CONTRACT });
`ok=${String(local.ok)}`
=> ok=true
```

```ts continue
const localBehind = scanUploaderFreshnessCheck(localBox.root, { deployedAt: null, contractVersion: 9 });
`ok=${String(localBehind.ok)}`
=> ok=false
```

## An unreadable build time or contract is no opinion, never a verdict

These are untrusted client strings. A diagnostic field must not manufacture a
stale verdict out of something it could not parse.

```ts continue
const junkBox = await makeTmpBox();
await uploaderCalled(junkBox.root, {
  name: "confused-uploader",
  contract: "not-a-number",
  build: "eeee5555",
  builtAt: "the day before yesterday",
});
check(junkBox.root)
=> scan-uploaders ok=true severity=warning
```

## Several uploaders are named individually

The boxholder has to know *which* machine to go and re-copy the file on.

```ts continue
const fleetBox = await makeTmpBox();
await uploaderCalled(fleetBox.root, { name: "desk-laptop", contract: "2", build: "f1", builtAt: "2026-03-01T00:00:00.000Z" });
await uploaderCalled(fleetBox.root, { name: "travel-laptop", contract: "2", build: "f2", builtAt: "2026-09-13T00:00:00.000Z" });
await uploaderCalled(fleetBox.root, { name: "spare-laptop", contract: "2", build: "f3", builtAt: "2026-04-01T00:00:00.000Z" });
message(fleetBox.root)
=> «*»2 scan uploaders out of date: desk-laptop (build f1«*»); spare-laptop (build f3«*»
```

```ts cleanup
await emptyBox.cleanup();
await currentBox.cleanup();
await oldBuildBox.cleanup();
await oldContractBox.cleanup();
await silentBox.cleanup();
await sourceBox.cleanup();
await revokedBox.cleanup();
await localBox.cleanup();
await junkBox.cleanup();
await fleetBox.cleanup();
```
