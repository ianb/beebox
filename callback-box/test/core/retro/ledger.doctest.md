# Retro observation ledger

`.callback-box/retro/observations.jsonl` is append-forever — one line per
observation per nightly run — so both readers stream it line by line rather
than reading the file whole and splitting it. `loadEvidenceHashes` builds its
Set as the lines go past, without ever materializing the entries.

```ts setup
import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { appendLedgerEntries, loadEvidenceHashes, loadLedgerEntries } from "../../../src/core/retro/ledger.js";

const entry = (n) => ({
  kind: "preference",
  evidence: `evidence ${n}`,
  proposal: `observation ${n}`,
  sink: "personality",
  runId: "run-1",
  sessionId: `s-${n}`,
  threadRef: null,
  evidenceHash: `hash-${n}`,
  observedAt: "2026-08-25T00:00:00Z",
});
```

## A missing ledger reads as empty

```ts
const box = await makeTmpBox();
(await loadLedgerEntries(box.root)).length
=> 0

(await loadEvidenceHashes(box.root)).size
=> 0
```

```ts cleanup
await box.cleanup();
```

## Entries round-trip, and hashes come back as a Set

Blank and corrupt lines are skipped rather than poisoning the history — a
partial append shouldn't lose everything written before it.

```ts
const box = await makeTmpBox();
await appendLedgerEntries(box.root, [entry(1), entry(2)]);
const ledgerPath = join(box.root, ".callback-box/retro/observations.jsonl");
await appendFile(ledgerPath, "\n{not json}\n" + JSON.stringify({ missing: "fields" }) + "\n");
await appendLedgerEntries(box.root, [entry(3)]);

(await loadLedgerEntries(box.root)).map((e) => e.proposal).join(",")
=> observation 1,observation 2,observation 3
```

```ts continue
[...(await loadEvidenceHashes(box.root))].sort().join(",")
=> hash-1,hash-2,hash-3
```

```ts cleanup
await box.cleanup();
```
