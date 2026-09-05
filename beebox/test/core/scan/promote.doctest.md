# The scan promote worker

One pass drains everything `_tmp/scan-quarantine/` owes the box: pending entries
through `bbx upload --as scan`, rejections into question cards, the owed
`bbx wakeup`, and the GC that keeps the directory from growing forever.

The upload and wakeup children are injected here (the services pattern) — what
this file pins is the worker's own contract: the sidecar state machine is the
recovery source of truth, files reach scan-import under their *original* names,
a wakeup is never silently lost, and every GC state still lets `/api/scan/check`
answer truthfully.

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { runScanPromotePass, promotionLockPath } from "../../../src/core/scan/promote.js";
import { collectQuarantine } from "../../../src/core/scan/promote-gc.js";
import { wakeupMarkerPath } from "../../../src/core/scan/promote-wakeup.js";
import {
  ensureQuarantineDir,
  quarantineFilePath,
  readAllQuarantineEntries,
  readQuarantineEntry,
  recordQuarantineEntry,
} from "../../../src/core/scan/quarantine.js";
import { findEntry, loadLedger } from "../../../src/core/commands/upload-helpers.js";
import { acquireLock, releaseLock } from "../../../src/lib/file-lock.js";
import { runCommand, createCollectorContext } from "../../../src/core/commands/index.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

/** Put one validated file in quarantine: sidecar plus the bytes beside it. */
async function quarantine(box, sha256, overrides) {
  const entry = {
    sha256,
    state: "pending",
    storedFilename: `${sha256}.pdf`,
    originalFilename: "Invoice_001.pdf",
    tokenName: "laptop-scansnap",
    receivedAt: "2026-08-01T09:00:00Z",
    ...overrides,
  };
  await ensureQuarantineDir(box.root);
  await recordQuarantineEntry(box.root, entry);
  if (entry.resolvedAt === undefined) {
    await fs.writeFile(quarantineFilePath(box.root, entry.storedFilename), `%PDF-1.4 ${sha256}\n`);
  }
  return entry;
}

/** An upload runner that records what it was handed, and whether it was real. */
function fakeUpload(opts) {
  const calls = [];
  return {
    calls,
    runner: async ({ files, source }) => {
      const existing = [];
      for (const f of files) {
        await fs.access(f);
        existing.push(path.basename(f));
      }
      calls.push({ source, files: existing });
      return opts?.fail ? { ok: false, detail: "scan-import blew up" } : { ok: true, detail: "" };
    },
  };
}

function fakeWakeup(opts) {
  const state = { runs: 0 };
  state.runner = async () => {
    state.runs++;
    return opts?.fail ? { ok: false, detail: "bbx wakeup exited with code 1" } : { ok: true, detail: "" };
  };
  return state;
}

/** Put the manifest-scheme asset ignore block back — what an older `bbx init`
 *  did to an annex-converted box, silently de-annexing it. Driven through the
 *  real `bbx attachments` subcommands so the fixture cannot drift from them. */
async function deAnnex(boxRoot) {
  const { ctx } = createCollectorContext(boxRoot);
  await runCommand({ name: "attachments", args: { subcommand: "init-gitignore" }, ctx });
}

/** Convert it back, the way `bbx attachments to-annex` does. */
async function reAnnex(boxRoot) {
  const { ctx } = createCollectorContext(boxRoot);
  await runCommand({ name: "attachments", args: { subcommand: "unignore" }, ctx });
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch (_e) {
    return false;
  }
}
```

## A settled batch becomes one upload — under the original filenames

Two files from one scan session go to scan-import together, named as the scanner
named them. That matters: scan-import groups images by scanner `<prefix>_NNN`
naming and records the basename as provenance, so hash-named inputs would wreck
both. The provenance string is the credential that sent them.

```ts
const box = await makeTmpBox({ git: true, annex: true });
await quarantine(box, HASH_A, { originalFilename: "Scan_001.pdf" });
await quarantine(box, HASH_B, { originalFilename: "Scan_002.pdf" });
const upload = fakeUpload();
const wakeup = fakeWakeup();

const result = await runScanPromotePass({
  boxRoot: box.root,
  deps: { runUpload: upload.runner, runWakeup: wakeup.runner },
});
JSON.stringify(upload.calls)
=> [{"source":"scan-upload/laptop-scansnap","files":["Scan_001.pdf","Scan_002.pdf"]}]

JSON.stringify({ imported: result.imported, failed: result.failed, wakeup: result.wakeup, wakeups: wakeup.runs })
=> {"imported":2,"failed":0,"wakeup":"ran","wakeups":1}
```

Imported entries are swept in the same pass — file and sidecar both — and the
staging copies go with them. Nothing else cleans this directory: the generic
`_tmp/` sweep skips directories entirely.

```ts continue
JSON.stringify({
  entries: await readAllQuarantineEntries(box.root),
  file: await exists(quarantineFilePath(box.root, `${HASH_A}.pdf`)),
  staging: await exists(box.path("_tmp/scan-staging")),
  removed: result.importedRemoved,
})
=> {"entries":[],"file":false,"staging":false,"removed":2}
```

The wakeup marker is gone too, because the run succeeded:

```ts continue
await exists(wakeupMarkerPath(box.root))
=> false
```

```ts cleanup
await box.cleanup();
```

## Two files with the same name both survive the batch

The scanner can emit the same basename from two profiles. A collision within one
batch gets a numbered suffix rather than one file silently overwriting the other.

```ts
const box = await makeTmpBox({ git: true, annex: true });
await quarantine(box, HASH_A, { originalFilename: "Invoice.pdf" });
await quarantine(box, HASH_B, { originalFilename: "Invoice.pdf" });
const upload = fakeUpload();

await runScanPromotePass({
  boxRoot: box.root,
  deps: { runUpload: upload.runner, runWakeup: fakeWakeup().runner },
});
JSON.stringify(upload.calls[0].files)
=> ["Invoice.pdf","Invoice-2.pdf"]
```

```ts cleanup
await box.cleanup();
```

## Provenance is per-credential, so a mixed batch is two uploads

`--source` is per invocation, and the token that sent a file is what the session
card records — so files from two credentials cannot share one upload.

```ts
const box = await makeTmpBox({ git: true, annex: true });
await quarantine(box, HASH_A, { originalFilename: "Study.pdf", tokenName: "laptop-scansnap" });
await quarantine(box, HASH_B, { originalFilename: "Desk.pdf", tokenName: "office-scanner" });
await quarantine(box, HASH_C, { originalFilename: "Manual.pdf", tokenName: null });
const upload = fakeUpload();

await runScanPromotePass({
  boxRoot: box.root,
  deps: { runUpload: upload.runner, runWakeup: fakeWakeup().runner },
});
JSON.stringify(upload.calls.map((c) => [c.source, c.files]))
=> [["scan-upload/laptop-scansnap",["Study.pdf"]],["scan-upload/office-scanner",["Desk.pdf"]],["scan-upload/owner",["Manual.pdf"]]]
```

```ts cleanup
await box.cleanup();
```

## A crash mid-promote is resumed from the sidecar

`promoting` is written before any work, so an entry the last process died on is
re-driven by the next pass. Re-running the upload is safe — the ledger dedups on
content hash — which is exactly why the recovery can be this blunt.

```ts
const box = await makeTmpBox({ git: true, annex: true });
await quarantine(box, HASH_A, { state: "promoting", originalFilename: "Halfway.pdf" });
// The dead process's staging dir is still lying around.
await fs.mkdir(box.path("_tmp/scan-staging/dead-run"), { recursive: true });
await fs.writeFile(box.path("_tmp/scan-staging/dead-run/Halfway.pdf"), "leftover");
const upload = fakeUpload();

const result = await runScanPromotePass({
  boxRoot: box.root,
  deps: { runUpload: upload.runner, runWakeup: fakeWakeup().runner },
});
JSON.stringify({ imported: result.imported, files: upload.calls[0].files })
=> {"imported":1,"files":["Halfway.pdf"]}

await exists(box.path("_tmp/scan-staging/dead-run"))
=> false
```

```ts cleanup
await box.cleanup();
```

## A failed upload leaves the entry retryable, not lost

The wakeup still runs: the marker is written *before* the batch, so that a crash
between marking an entry `imported` and writing the marker can't lose the wakeup
for good. A wakeup after a failed batch is the cheap side of that trade.

```ts
const box = await makeTmpBox({ git: true, annex: true });
await quarantine(box, HASH_A);
const result = await runScanPromotePass({
  boxRoot: box.root,
  deps: { runUpload: fakeUpload({ fail: true }).runner, runWakeup: fakeWakeup().runner },
});
JSON.stringify({ imported: result.imported, failed: result.failed, wakeup: result.wakeup })
=> {"imported":0,"failed":1,"wakeup":"ran"}

(await readQuarantineEntry(box.root, HASH_A)).state
=> promoting
```

```ts cleanup
await box.cleanup();
```

## A failed wakeup keeps its marker, and the next pass clears it

Connector-scoped scheduled wakeups never drain a `source: scan` job, so a lost
wakeup is indefinite rather than late. The marker is written before the run and
survives a restart; every later pass retries it.

```ts
const box = await makeTmpBox({ git: true, annex: true });
await quarantine(box, HASH_A);
const failing = fakeWakeup({ fail: true });

const first = await runScanPromotePass({
  boxRoot: box.root,
  deps: { runUpload: fakeUpload().runner, runWakeup: failing.runner },
});
JSON.stringify({ imported: first.imported, wakeup: first.wakeup, marker: await exists(wakeupMarkerPath(box.root)) })
=> {"imported":1,"wakeup":"failed","marker":true}
```

The retry needs no new files — an empty pass still owes the wakeup:

```ts continue
const recovered = fakeWakeup();
const second = await runScanPromotePass({
  boxRoot: box.root,
  deps: { runUpload: fakeUpload().runner, runWakeup: recovered.runner },
});
JSON.stringify({ imported: second.imported, wakeup: second.wakeup, runs: recovered.runs, marker: await exists(wakeupMarkerPath(box.root)) })
=> {"imported":0,"wakeup":"ran","runs":1,"marker":false}
```

```ts cleanup
await box.cleanup();
```

## A rejection raises exactly one question card, however often the worker runs

The rejection reason is written for the person who reads the question card, not
just for an HTTP body the uploader printed once. `questionRef` on the sidecar is
what makes a repeated pass adopt the card instead of emitting a second one.

```ts
const box = await makeTmpBox({ git: true, annex: true });
await quarantine(box, HASH_A, {
  state: "rejected",
  originalFilename: "Contract.pdf",
  reason: "magic bytes say text/html but the extension is .pdf",
});

const first = await runScanPromotePass({
  boxRoot: box.root,
  deps: { runUpload: fakeUpload().runner, runWakeup: fakeWakeup().runner },
});
const entry = await readQuarantineEntry(box.root, HASH_A);
JSON.stringify({ questions: first.questions, ref: entry.questionRef })
=> {"questions":1,"ref":"_bookkeeping/questions/scan-rejected-aaaaaaaaaaaa.question.card"}

const card = await box.read(entry.questionRef);
JSON.stringify([card.includes("Contract.pdf"), card.includes("magic bytes say text/html"), card.includes("status: pending")])
=> [true,true,true]
```

A second pass writes nothing new and the box still holds one question:

```ts continue
const second = await runScanPromotePass({
  boxRoot: box.root,
  deps: { runUpload: fakeUpload().runner, runWakeup: fakeWakeup().runner },
});
JSON.stringify({ questions: second.questions, dir: await box.list("_bookkeeping/questions") })
=>
{"questions":0,"dir":"_bookkeeping/questions/.gitkeep\n_bookkeeping/questions/scan-rejected-aaaaaaaaaaaa.question.card"}
```

```ts cleanup
await box.cleanup();
```

## A rejected file is kept until its question is resolved, then for 30 days as a tombstone

The bytes go the moment the question is answered. The sidecar stays behind as a
tombstone so `/api/scan/check` keeps answering `rejected` (with its reason) for
another 30 days — collapsing that to `unknown` early would invite the uploader to
re-send a file the boxholder already ruled on.

```ts
const box = await makeTmpBox({ git: true, annex: true });
await quarantine(box, HASH_A, { state: "rejected", reason: "qpdf --check reported a damaged PDF" });
const deps = { runUpload: fakeUpload().runner, runWakeup: fakeWakeup().runner };

// Pass 1 raises the question. It is pending, so nothing is collected.
const raised = await runScanPromotePass({ boxRoot: box.root, deps });
const held = await runScanPromotePass({ boxRoot: box.root, deps });
JSON.stringify({
  tombstoned: held.tombstoned,
  file: await exists(quarantineFilePath(box.root, `${HASH_A}.pdf`)),
})
=> {"tombstoned":0,"file":true}
```

Answering the question is what releases the bytes:

```ts continue
const ref = (await readQuarantineEntry(box.root, HASH_A)).questionRef;
await box.write(ref, (await box.read(ref)).replace("status: pending", "status: answered"));

const collected = await runScanPromotePass({ boxRoot: box.root, deps });
const tombstone = await readQuarantineEntry(box.root, HASH_A);
JSON.stringify({
  tombstoned: collected.tombstoned,
  file: await exists(quarantineFilePath(box.root, `${HASH_A}.pdf`)),
  state: tombstone.state,
  reason: tombstone.reason,
  resolved: typeof tombstone.resolvedAt,
})
=> {"tombstoned":1,"file":false,"state":"rejected","reason":"qpdf --check reported a damaged PDF","resolved":"string"}
```

Thirty days on, the tombstone goes too and the hash reverts to `unknown` — far
enough out that a re-upload deserves fresh validation:

```ts continue
const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
await recordQuarantineEntry(box.root, { ...tombstone, resolvedAt: old });
const swept = await runScanPromotePass({ boxRoot: box.root, deps });
JSON.stringify({ removed: swept.tombstonesRemoved, entry: await readQuarantineEntry(box.root, HASH_A) })
=> {"removed":1,"entry":null}
```

A deleted question card counts as resolved — deleting it is how a boxholder
finishes with one:

```ts continue
await quarantine(box, HASH_B, { state: "rejected", reason: "unsupported type: image/gif" });
await runScanPromotePass({ boxRoot: box.root, deps });
await fs.rm(box.path((await readQuarantineEntry(box.root, HASH_B)).questionRef));
const gone = await runScanPromotePass({ boxRoot: box.root, deps });
JSON.stringify({ tombstoned: gone.tombstoned, file: await exists(quarantineFilePath(box.root, `${HASH_B}.pdf`)) })
=> {"tombstoned":1,"file":false}
```

```ts cleanup
await box.cleanup();
```

## The GC never acts on a stale verdict

A re-PUT of a rejected hash is the sanctioned retry path, and it can land while
a pass is running. The GC re-reads each entry immediately before deleting
anything, so a hash whose state moved on since the listing is left for the next
pass rather than having its freshly uploaded bytes deleted under it.

```ts
const box = await makeTmpBox({ git: true, annex: true });
const stale = await quarantine(box, HASH_A, { state: "rejected", reason: "unsupported type: image/gif" });
// The listing says "rejected, resolved"; the sidecar on disk says the uploader
// has since re-sent it and it validated.
await recordQuarantineEntry(box.root, { ...stale, state: "pending", reason: undefined });

const gc = await collectQuarantine({
  boxRoot: box.root,
  entries: [{ ...stale, questionRef: "_bookkeeping/questions/gone.question.card" }],
});
JSON.stringify({
  gc,
  state: (await readQuarantineEntry(box.root, HASH_A)).state,
  file: await exists(quarantineFilePath(box.root, `${HASH_A}.pdf`)),
})
=> {"gc":{"importedRemoved":0,"tombstoned":0,"tombstonesRemoved":0},"state":"pending","file":true}
```

```ts cleanup
await box.cleanup();
```

## What `/api/scan/check` can still answer, at every GC stage

The route reads the ledger first and quarantine second, so the two sweeps above
are chosen to keep every answer truthful: an imported hash is answerable from
the ledger after its quarantine entry is gone, and a rejected one stays
answerable from its tombstone.

```ts
const box = await makeTmpBox({ git: true, annex: true });
await quarantine(box, HASH_A, { originalFilename: "Filed.pdf" });
// A real upload writes the ledger; the fake stands in for that half.
const upload = async ({ files }) => {
  await box.write(".beebox/uploads.json", JSON.stringify({
    version: 1,
    entries: [{ hash: HASH_A, originalName: path.basename(files[0]), originalPath: files[0], uploadedAt: "2026-08-01T10:00:00Z", kind: "scan" }],
  }));
  return { ok: true, detail: "" };
};
await runScanPromotePass({ boxRoot: box.root, deps: { runUpload: upload, runWakeup: fakeWakeup().runner } });

const ledger = await loadLedger(box.root);
JSON.stringify({
  quarantine: await readQuarantineEntry(box.root, HASH_A),
  ledger: findEntry(ledger, HASH_A).originalName,
})
=> {"quarantine":null,"ledger":"Filed.pdf"}
```

```ts cleanup
await box.cleanup();
```

## A pass that cannot take the promotion lock does nothing

The `bbx serve` child and a hand-run CLI are different processes and both may
promote; whoever holds the lock is already doing this work.

```ts
const box = await makeTmpBox({ git: true, annex: true });
await quarantine(box, HASH_A);
await acquireLock(promotionLockPath(box.root), { purpose: "test" });
const upload = fakeUpload();

const result = await runScanPromotePass({
  boxRoot: box.root,
  deps: { runUpload: upload.runner, runWakeup: fakeWakeup().runner },
});
JSON.stringify({ skipped: result.skipped, calls: upload.calls.length, state: (await readQuarantineEntry(box.root, HASH_A)).state })
=> {"skipped":"locked","calls":0,"state":"pending"}

await releaseLock(promotionLockPath(box.root));
```

```ts cleanup
await box.cleanup();
```

## Quarantined bytes that vanished become a rejection, not an eternal retry

```ts
const box = await makeTmpBox({ git: true, annex: true });
await quarantine(box, HASH_A, { originalFilename: "Vanished.pdf" });
await fs.rm(quarantineFilePath(box.root, `${HASH_A}.pdf`));
const upload = fakeUpload();

const result = await runScanPromotePass({
  boxRoot: box.root,
  deps: { runUpload: upload.runner, runWakeup: fakeWakeup().runner },
});
const entry = await readQuarantineEntry(box.root, HASH_A);
JSON.stringify({ imported: result.imported, calls: upload.calls.length, state: entry.state, reason: entry.reason })
=> {"imported":0,"calls":0,"state":"rejected","reason":"the quarantined copy disappeared before it could be imported"}
```

```ts cleanup
await box.cleanup();
```

## A box that is not annex-converted is skipped, not driven

Promotion runs `bbx upload --as scan`, which stages raw asset bytes. On a box
still using the manifest scheme those bytes are gitignored, so the upload fails
at commit — and the entries it touched are left in `promoting` for the next pass
to fail on again. The shape is re-probed at the top of every pass rather than
once at startup, because a box can be de-annexed while the server runs: an older
`bbx init` rewriting `.gitignore` is exactly how the first box lost the shape.

Here a box that WAS converted has its asset ignore block put back — a de-annexed
box with quarantine already full — and the pass declines to touch it.

```ts
const box = await makeTmpBox({ git: true, annex: true });
await quarantine(box, HASH_A);
await deAnnex(box.root);
const upload = fakeUpload();

const result = await runScanPromotePass({
  boxRoot: box.root,
  deps: { runUpload: upload.runner, runWakeup: fakeWakeup().runner },
});
JSON.stringify({ skipped: result.skipped, calls: upload.calls.length, state: (await readQuarantineEntry(box.root, HASH_A)).state })
=> {"skipped":"not-annex","calls":0,"state":"pending"}
```

Nothing is lost: the quarantined bytes and their `pending` sidecar stay exactly
where they are, so converting the box makes the very next pass import them.

```ts continue
await reAnnex(box.root);
const second = await runScanPromotePass({
  boxRoot: box.root,
  deps: { runUpload: upload.runner, runWakeup: fakeWakeup().runner },
});
JSON.stringify({ skipped: second.skipped, imported: second.imported, files: upload.calls[0].files })
=> {"skipped":null,"imported":1,"files":["Invoice_001.pdf"]}
```

```ts cleanup
await box.cleanup();
```
