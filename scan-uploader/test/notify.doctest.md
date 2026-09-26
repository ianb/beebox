# Desktop notification

The uploader runs under launchd with its stdout going to a log nobody reads,
so a banner is the only place a person learns a scan arrived — or that the
server refused one. `notifySweep` decides, from a sweep's per-box totals,
which banners that warrants.

The notifier shells out, so these tests put fake `terminal-notifier` and
`osascript` scripts on `PATH` and read back their argv. Nothing here can post
a real banner to the developer's screen.

```ts setup
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";

import { notifySweep } from "../src/notify.js";
import type { BoxSummary } from "../src/run-all.js";
import type { RunSummary } from "../src/run-target.js";
import { makeTmpDir, removeTmpDir } from "./tmp-dir.js";

const dir = await makeTmpDir("notify");
const originalPath = process.env.PATH ?? "";

const summary = (over: Partial<RunSummary>): RunSummary => ({
  uploaded: 0,
  duplicate: 0,
  rejected: 0,
  rejectedOnUpload: 0,
  skippedUnsettled: 0,
  skippedIdentityChanged: 0,
  errors: 0,
  ...over,
});

const box = (name: string, over: Partial<RunSummary>): BoxSummary => ({ box: name, summary: summary(over) });

/** Installs a fake `name` as the ONLY thing on PATH inside a fresh directory,
 * appending one line of argv per invocation to `<dir>/<case>/log`. */
async function fakeBin(params: { case: string; name: string; exitCode: number }): Promise<string> {
  const binDir = join(dir, params.case);
  await mkdir(binDir, { recursive: true });
  const logFile = join(binDir, "log");
  const scriptPath = join(binDir, params.name);
  await writeFile(scriptPath, `#!/bin/sh\necho "$@" >> "${logFile}"\nexit ${String(params.exitCode)}\n`);
  await chmod(scriptPath, 0o755);
  process.env.PATH = binDir;
  return logFile;
}

async function logLines(logFile: string): Promise<string[]> {
  try {
    return (await readFile(logFile, "utf-8")).trim().split("\n").filter((line) => line !== "");
  } catch (e) {
    return [];
  }
}
```

## A quiet sweep says nothing

Most sweeps upload nothing: the interval fires regardless of whether a scan
landed, and the folder-change trigger fires again on the disposition's own
rename. A banner per sweep would train the reader to ignore banners. Nothing
is spawned at all — duplicates, unsettled skips and identity-change skips are
all routine, not news.

```
const quietLog = await fakeBin({ case: "quiet", name: "terminal-notifier", exitCode: 0 });
await notifySweep([box("family", { duplicate: 2, skippedUnsettled: 1, skippedIdentityChanged: 1 })], { platform: "darwin" });
(await logLines(quietLog)).length
=> 0
```

An empty sweep — no target produced a summary — is likewise silent:

```continue
await notifySweep([], { platform: "darwin" });
(await logLines(quietLog)).length
=> 0
```

Newly exported Apple Photos items use the same notifier and stay silent when
no files were exported:

```ts
const photosLog = await fakeBin({ case: "photos", name: "terminal-notifier", exitCode: 0 });
await notifySweep([], { platform: "darwin", photosFound: [{ album: "Bee Box", count: 2 }] });
(await logLines(photosLog))[0]
=> -title Photos queued -message 2 photos from 'Bee Box' queued for upload -group org.beebox.scan-uploader.photos.Bee Box
```

## An upload posts one banner naming the boxes

```
const uploadLog = await fakeBin({ case: "upload", name: "terminal-notifier", exitCode: 0 });
await notifySweep([box("family", { uploaded: 2 }), box("receipts", { uploaded: 1 })], { platform: "darwin" });
(await logLines(uploadLog)).join("\n")
=> -title Scan uploaded -message 3 files uploaded to family, receipts -group org.beebox.scan-uploader.uploaded
```

A box that uploaded nothing is not named, and one file is singular:

```continue
await notifySweep([box("family", { uploaded: 1 }), box("receipts", { duplicate: 4 })], { platform: "darwin" });
(await logLines(uploadLog))[1]
=> -title Scan uploaded -message 1 file uploaded to family -group org.beebox.scan-uploader.uploaded
```

## Only a *newly* refused file is worth a banner

A rejected file is left in place on purpose and the server remembers its hash,
so `rejected` stays at 1 on every sweep from then on. Notifying on that would
nag every 15 minutes about a file the reader already knows about, which is the
same failure as notifying on a quiet run. So the remembered rejection is
silent:

```
const refuseLog = await fakeBin({ case: "refuse", name: "terminal-notifier", exitCode: 0 });
await notifySweep([box("family", { rejected: 1 })], { platform: "darwin" });
(await logLines(refuseLog)).length
=> 0
```

`rejectedOnUpload` is the sweep that actually learned it — the PUT the server
refused — and that one gets a banner, in its own notification group so a
routine "Scan uploaded" cannot replace an unread refusal:

```continue
await notifySweep([box("family", { rejected: 1, rejectedOnUpload: 1 })], { platform: "darwin" });
(await logLines(refuseLog))[0]
=> «*»-group org.beebox.scan-uploader.refused
```

```continue
(await logLines(refuseLog))[0]
=> -title Scan refused -message 1 file rejected by family — left in place.«*»
```

A sweep that both uploaded and was refused posts both, so neither hides the
other:

```
const bothLog = await fakeBin({ case: "both", name: "terminal-notifier", exitCode: 0 });
await notifySweep([box("family", { uploaded: 1 }), box("receipts", { rejected: 1, rejectedOnUpload: 2 })], { platform: "darwin" });
(await logLines(bothLog)).map((line) => line.split(" ")[1]).join(",")
=> Scan,Scan
```

```continue
(await logLines(bothLog)).length
=> 2
```

## `osascript` is the fallback when `terminal-notifier` is absent

`terminal-notifier` is a Homebrew install, and this package's whole story is
running from a single copied file on a machine with no checkout — so the
notifier cannot depend on it. `PATH` here holds only a fake `osascript`.

```
const fallbackLog = await fakeBin({ case: "fallback", name: "osascript", exitCode: 0 });
await notifySweep([box("family", { uploaded: 1 })], { platform: "darwin" });
(await logLines(fallbackLog))[0]
=> -e display notification "1 file uploaded to family" with title "Scan uploaded"
```

## The notifier can never fail the sweep it reports on

Both tools absent (an empty `PATH`), or present and failing — `notifySweep`
still resolves. A sweep that uploaded a scan has done its job whether or not
anyone got told about it.

```
process.env.PATH = "";
await notifySweep([box("family", { uploaded: 1 })], { platform: "darwin" });
"resolved"
=> resolved
```

```
const failLog = await fakeBin({ case: "failing", name: "terminal-notifier", exitCode: 1 });
await notifySweep([box("family", { uploaded: 1 })], { platform: "darwin" });
(await logLines(failLog)).length
=> 1
```

## Non-macOS is a no-op

Same posture as the `trash` disposition: this is a macOS mechanism, and
elsewhere there is nothing to degrade to. It spawns nothing rather than
failing.

```
const linuxLog = await fakeBin({ case: "linux", name: "terminal-notifier", exitCode: 0 });
await notifySweep([box("family", { uploaded: 1, rejectedOnUpload: 1 })], { platform: "linux" });
(await logLines(linuxLog)).length
=> 0
```

```cleanup
process.env.PATH = originalPath;
await removeTmpDir(dir);
```
