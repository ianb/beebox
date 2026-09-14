# The per-target run loop

`runTarget` is the orchestration in `src/run-target.ts`: walk → settle gate →
identity snapshot → hash → batch check → PUT unknowns → **restat before
disposition**. Each scenario below runs a real `runTarget` against a fake
HTTP server (`test/fake-scan-server.ts`) and a real folder on disk, so the
filesystem side effects (or their absence) are the actual assertion, not a
mock's call log.

```ts setup
import { writeFileSync } from "node:fs";
import { mkdir, readdir, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { runTarget } from "../src/run-target.js";
import type { TargetConfig } from "../src/config.js";
import { startFakeScanServer, type FakeScanServer } from "./fake-scan-server.js";
import { makeTmpDir, removeTmpDir } from "./tmp-dir.js";

const dir = await makeTmpDir("run-target");
const tokenPath = join(dir, "token.txt");
await writeFile(tokenPath, "test-token\n");

// A file "settled" a full settle-window ago, so scenarios don't have to wait
// out the real 10s gate.
async function writeSettledFile(folder: string, name: string, content: string): Promise<string> {
  const filePath = join(folder, name);
  await writeFile(filePath, content);
  const past = new Date(Date.now() - 60_000);
  await utimes(filePath, past, past);
  return filePath;
}

function targetFor(params: { folder: string; serverUrl: string; disposition: TargetConfig["disposition"] }): TargetConfig {
  return {
    folder: params.folder,
    serverUrl: params.serverUrl,
    box: "family",
    tokenPath,
    disposition: params.disposition,
  };
}
```

## A fresh, unsettled file is skipped entirely

No hash, no check, no PUT — the settle gate runs before anything else.

```
const unsettledFolder = join(dir, "unsettled");
await mkdir(unsettledFolder);
await writeFile(join(unsettledFolder, "just-scanned.pdf"), "still writing");
const serverA: FakeScanServer = await startFakeScanServer({
  checkState: () => ({ state: "unknown" }),
  putOutcome: () => ({ status: 200, body: { status: "accepted" } }),
});
const summaryA = await runTarget(targetFor({ folder: unsettledFolder, serverUrl: serverA.url, disposition: "keep" }), { retryRejected: false });
JSON.stringify(summaryA)
=> {"uploaded":0,"duplicate":0,"rejected":0,"rejectedOnUpload":0,"skippedUnsettled":1,"skippedIdentityChanged":0,"errors":0}
```

```continue
serverA.putRequests.length
=> 0
```

```cleanup
await serverA.close();
```

## An unknown file uploads, then archives

`unknown` on check → PUT → `accepted` → restat unchanged → `archive` moves
the file into `imported/`.

```
const archiveFolder = join(dir, "archive-target");
await mkdir(archiveFolder);
await writeSettledFile(archiveFolder, "scan1.pdf", "brand new scan");
const serverB: FakeScanServer = await startFakeScanServer({
  checkState: () => ({ state: "unknown" }),
  putOutcome: () => ({ status: 200, body: { status: "accepted" } }),
});
const summaryB = await runTarget(targetFor({ folder: archiveFolder, serverUrl: serverB.url, disposition: "archive" }), { retryRejected: false });
JSON.stringify(summaryB)
=> {"uploaded":1,"duplicate":0,"rejected":0,"rejectedOnUpload":0,"skippedUnsettled":0,"skippedIdentityChanged":0,"errors":0}
```

```continue
(await readdir(archiveFolder)).sort().join(",")
=> imported
```

```continue
(await readdir(join(archiveFolder, "imported"))).join(",")
=> scan1.pdf
```

```cleanup
await serverB.close();
```

## A file already `imported` on the server is a no-op disposition

`pending`/`imported` count as confirmed without a PUT at all — this is the
crash-recovery path (a prior run that died between PUT and disposition
converges here on the next sweep). Disposition is `keep`, so the file just
stays put.

```
const keepFolder = join(dir, "keep-target");
await mkdir(keepFolder);
await writeSettledFile(keepFolder, "already-imported.pdf", "previously uploaded");
const serverC: FakeScanServer = await startFakeScanServer({
  checkState: () => ({ state: "imported" }),
  putOutcome: () => ({ status: 200, body: { status: "accepted" } }),
});
const summaryC = await runTarget(targetFor({ folder: keepFolder, serverUrl: serverC.url, disposition: "keep" }), { retryRejected: false });
JSON.stringify(summaryC)
=> {"uploaded":0,"duplicate":1,"rejected":0,"rejectedOnUpload":0,"skippedUnsettled":0,"skippedIdentityChanged":0,"errors":0}
```

```continue
serverC.putRequests.length
=> 0
```

```continue
(await readdir(keepFolder)).join(",")
=> already-imported.pdf
```

```cleanup
await serverC.close();
```

## A rejected file is never dispositioned

The server's rejection reason surfaces in the summary count; the file is
left exactly where it was — never moved, never deleted — so a human (or a
future `--retry-rejected` run) can act on it.

```
const rejectFolder = join(dir, "reject-target");
await mkdir(rejectFolder);
await writeSettledFile(rejectFolder, "smuggled.pdf", "<html>not a pdf</html>");
const serverD: FakeScanServer = await startFakeScanServer({
  checkState: () => ({ state: "rejected", reason: "magic bytes say text/html but extension is .pdf" }),
  putOutcome: () => ({ status: 200, body: { status: "accepted" } }),
});
const summaryD = await runTarget(targetFor({ folder: rejectFolder, serverUrl: serverD.url, disposition: "archive" }), { retryRejected: false });
JSON.stringify(summaryD)
=> {"uploaded":0,"duplicate":0,"rejected":1,"rejectedOnUpload":0,"skippedUnsettled":0,"skippedIdentityChanged":0,"errors":0}
```

```continue
(await readdir(rejectFolder)).join(",")
=> smuggled.pdf
```

`--retry-rejected` re-PUTs it instead of trusting the cached check verdict:

```continue
const serverD2: FakeScanServer = await startFakeScanServer({
  checkState: () => ({ state: "rejected", reason: "stale verdict, should not be trusted" }),
  putOutcome: () => ({ status: 200, body: { status: "accepted" } }),
});
const summaryD2 = await runTarget(targetFor({ folder: rejectFolder, serverUrl: serverD2.url, disposition: "archive" }), { retryRejected: true });
JSON.stringify(summaryD2)
=> {"uploaded":1,"duplicate":0,"rejected":0,"rejectedOnUpload":0,"skippedUnsettled":0,"skippedIdentityChanged":0,"errors":0}
```

```continue
serverD2.putRequests.length
=> 1
```

```cleanup
await serverD.close();
await serverD2.close();
```

## `rejectedOnUpload` separates a new rejection from a remembered one

`summaryD` above counted `rejected: 1` with `rejectedOnUpload: 0` — the
`check` endpoint reported a verdict the server had already reached on some
earlier run. A rejection the server reaches on *this* run's PUT counts in
both. The distinction is what lets the desktop notifier (`src/notify.ts`)
report a refusal once: the file stays in place and the server keeps
remembering its hash, so `rejected` is 1 on every sweep from then on, while
`rejectedOnUpload` is 1 only on the sweep that learned it.

```
const newRejectFolder = join(dir, "new-reject-target");
await mkdir(newRejectFolder);
await writeSettledFile(newRejectFolder, "first-sight.pdf", "<html>not a pdf</html>");
const serverR: FakeScanServer = await startFakeScanServer({
  checkState: () => ({ state: "unknown" }),
  putOutcome: () => ({ status: 422, body: { status: "rejected", reason: "magic bytes say text/html" } }),
});
const summaryR = await runTarget(targetFor({ folder: newRejectFolder, serverUrl: serverR.url, disposition: "archive" }), { retryRejected: false });
JSON.stringify(summaryR)
=> {"uploaded":0,"duplicate":0,"rejected":1,"rejectedOnUpload":1,"skippedUnsettled":0,"skippedIdentityChanged":0,"errors":0}
```

Still never dispositioned — a PUT-time rejection is the same "leave it in
place" outcome as a remembered one:

```continue
(await readdir(newRejectFolder)).join(",")
=> first-sight.pdf
```

`--retry-rejected` re-PUTs a rejection the server already remembers, and that
refusal is the same fact a second time — so it counts in `rejected` but NOT in
`rejectedOnUpload`. Without this, a settle retry (which re-walks the whole
folder in the same sweep) would report one refused file as two:

```continue
const serverR2: FakeScanServer = await startFakeScanServer({
  checkState: () => ({ state: "rejected", reason: "the server already knows" }),
  putOutcome: () => ({ status: 422, body: { status: "rejected", reason: "still not a pdf" } }),
});
const summaryR2 = await runTarget(targetFor({ folder: newRejectFolder, serverUrl: serverR2.url, disposition: "archive" }), { retryRejected: true });
JSON.stringify(summaryR2)
=> {"uploaded":0,"duplicate":0,"rejected":1,"rejectedOnUpload":0,"skippedUnsettled":0,"skippedIdentityChanged":0,"errors":0}
```

```cleanup
await serverR.close();
await serverR2.close();
```

## A file that changes between hash and disposition is left alone

This is the restat-before-disposition rule: the check/PUT round trip
confirms the *hashed* bytes, but the scanner could still be writing. Here the
fake server mutates the file from inside its `checkState` callback — which
`runTarget` calls after hashing but before disposition — to simulate that
race deterministically. The file must **not** be archived, because the
copy the server confirmed is not the copy sitting on disk anymore.

```
const raceFolder = join(dir, "race-target");
await mkdir(raceFolder);
const racePath = await writeSettledFile(raceFolder, "growing.pdf", "first pass bytes");
const serverE: FakeScanServer = await startFakeScanServer({
  checkState: () => {
    writeFileSync(racePath, "scanner appended more bytes after this hash was taken");
    return { state: "unknown" };
  },
  putOutcome: () => ({ status: 200, body: { status: "accepted" } }),
});
const summaryE = await runTarget(targetFor({ folder: raceFolder, serverUrl: serverE.url, disposition: "archive" }), { retryRejected: false });
JSON.stringify(summaryE)
=> {"uploaded":1,"duplicate":0,"rejected":0,"rejectedOnUpload":0,"skippedUnsettled":0,"skippedIdentityChanged":1,"errors":0}
```

```continue
(await readdir(raceFolder)).join(",")
=> growing.pdf
```

```cleanup
await serverE.close();
```

## A 429 is retried, not treated as a failure

`putFile` reports `rate-limited` once; `runTarget` sleeps for the server's
`Retry-After` and resumes the same PUT rather than counting it as an error.

```
const rateFolder = join(dir, "rate-target");
await mkdir(rateFolder);
await writeSettledFile(rateFolder, "throttled.pdf", "scan under load");
let putAttempts = 0;
const serverF: FakeScanServer = await startFakeScanServer({
  checkState: () => ({ state: "unknown" }),
  putOutcome: () => {
    putAttempts += 1;
    if (putAttempts === 1) return { status: 429, retryAfterSeconds: 0 };
    return { status: 200, body: { status: "accepted" } };
  },
});
const summaryF = await runTarget(targetFor({ folder: rateFolder, serverUrl: serverF.url, disposition: "keep" }), { retryRejected: false });
JSON.stringify(summaryF)
=> {"uploaded":1,"duplicate":0,"rejected":0,"rejectedOnUpload":0,"skippedUnsettled":0,"skippedIdentityChanged":0,"errors":0}
```

```continue
serverF.putRequests.length
=> 2
```

```cleanup
await serverF.close();
await removeTmpDir(dir);
```
