# Scan quarantine sidecars

Every file the scan routes accept lands in `tmp/scan-quarantine/` as
`<sha256>.<ext>` beside a `<sha256>.json` sidecar holding its state machine. The
sidecar — not memory — is the recovery source of truth: the promote worker
re-scans this directory at startup and resumes whatever it finds, and the
`check` route answers from it without the uploader's help. So what this file
pins is the durability properties: the shape survives a round trip, a state
advance is a read-modify-write of one entry, and a corrupt sidecar degrades to
"not present" rather than taking the whole scan down.

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import {
  ensureQuarantineDir,
  quarantineDir,
  quarantineFilePath,
  readAllQuarantineEntries,
  readQuarantineEntry,
  recordQuarantineEntry,
  updateQuarantineState,
} from "../../../src/core/scan/quarantine.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function entry(sha256, overrides) {
  return {
    sha256,
    state: "pending",
    storedFilename: `${sha256}.pdf`,
    originalFilename: "Invoice_001.pdf",
    tokenName: "laptop-scansnap",
    receivedAt: "2026-08-01T09:00:00Z",
    ...overrides,
  };
}
```

## An entry round-trips, and quarantine lives under the box's swept tmp dir

```ts
const box = await makeTmpBox();
quarantineDir(box.root) === path.join(box.root, "tmp", "scan-quarantine")
=> true

await recordQuarantineEntry(box.root, entry(HASH_A));
const read = await readQuarantineEntry(box.root, HASH_A);
JSON.stringify({ state: read.state, name: read.originalFilename, token: read.tokenName })
=> {"state":"pending","name":"Invoice_001.pdf","token":"laptop-scansnap"}
```

A hash quarantine has never seen is `null`, not a throw — "unknown" is a normal
answer, not an error:

```ts continue
await readQuarantineEntry(box.root, HASH_B)
=> null
```

```ts cleanup
await box.cleanup();
```

## `updateQuarantineState` advances one entry and leaves its siblings alone

The promote worker drives `pending → promoting → imported`, and records a
`questionRef` on a rejection so a repeated pass doesn't emit a second question
card for the same file.

```ts
const box = await makeTmpBox();
await recordQuarantineEntry(box.root, entry(HASH_A));
await recordQuarantineEntry(box.root, entry(HASH_B, { state: "rejected", reason: "magic bytes say image/png but the extension is .pdf" }));

const promoting = await updateQuarantineState(box.root, { sha256: HASH_A, state: "promoting" });
const flagged = await updateQuarantineState(box.root, { sha256: HASH_B, state: "rejected", questionRef: "questions/Bad_Scan.question.card" });
JSON.stringify({ a: promoting.state, b: [flagged.state, flagged.questionRef, flagged.reason] })
=> {"a":"promoting","b":["rejected","questions/Bad_Scan.question.card","magic bytes say image/png but the extension is .pdf"]}
```

Reading them all back gives the promote worker its work list, hash-sorted:

```ts continue
const all = await readAllQuarantineEntries(box.root);
JSON.stringify(all.map((e) => [e.sha256.slice(0, 4), e.state]))
=> [["aaaa","promoting"],["bbbb","rejected"]]
```

Updating a hash that isn't in quarantine reports `null` rather than inventing an
entry — a worker acting on a swept file must notice, not resurrect it:

```ts continue
await updateQuarantineState(box.root, { sha256: "c".repeat(64), state: "imported" })
=> null
```

```ts cleanup
await box.cleanup();
```

## A corrupt sidecar is skipped, not fatal

The file's bytes are still on disk and a re-PUT rewrites the verdict, so one
unparseable sidecar must not stop the promote worker from draining the rest.

```ts
const box = await makeTmpBox();
const dir = await ensureQuarantineDir(box.root);
await recordQuarantineEntry(box.root, entry(HASH_A));
await fs.writeFile(path.join(dir, `${HASH_B}.json`), "{ not json at all");
await fs.writeFile(path.join(dir, `${"c".repeat(64)}.json`), JSON.stringify({ sha256: "c", state: "nonsense" }));

const all = await readAllQuarantineEntries(box.root);
JSON.stringify(all.map((e) => e.sha256.slice(0, 4)))
=> ["aaaa"]
```

The stored file itself sits beside the sidecar under its hash name — the promote
worker materializes it under `originalFilename` later, because scan-import's
image grouping keys on scanner `<prefix>_NNN` names:

```ts continue
await fs.writeFile(quarantineFilePath(box.root, `${HASH_A}.pdf`), "%PDF-1.4\n");
const names = (await fs.readdir(dir)).toSorted().map((n) => n.slice(0, 4) + n.slice(64));
JSON.stringify(names)
=> ["aaaa.json","aaaa.pdf","bbbb.json","cccc.json"]
```

```ts cleanup
await box.cleanup();
```
