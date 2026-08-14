# `cb session` refuses to print a huge transcript without `--allow-huge`

Every `cb session` output mode scales with the transcript file (`--raw` IS the
file, `--tool-report` exceeds it, render is entry-capped but still enormous
past the threshold), so `transcriptPrintable` fails closed above
`HUGE_TRANSCRIPT_BYTES` unless the caller passed `--allow-huge`. Filed from
the 2026-08-01 OOM incident follow-up: a surprise multi-hundred-MB dump is
never the right result, least of all for an agent reading command output.

```ts setup
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  HUGE_TRANSCRIPT_BYTES,
  sessionEntriesPrintable,
  transcriptPrintable,
} from "../../../src/cli/commands/session-modes.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "huge-guard-"));
const smallPath = path.join(dir, "small.jsonl");
const hugePath = path.join(dir, "huge.jsonl");
fs.writeFileSync(smallPath, '{"type":"user"}\n');
// A sparse file: full reported size, no real disk writes.
fs.writeFileSync(hugePath, "");
fs.truncateSync(hugePath, HUGE_TRANSCRIPT_BYTES + 1);
```

## An ordinary transcript prints

```ts
transcriptPrintable({ logPath: smallPath, sessionId: "s1", allowHuge: false })
=> true
```

## A huge transcript is refused (loudly, on stderr)

```ts
transcriptPrintable({ logPath: hugePath, sessionId: "s2", allowHuge: false })
=> false
```

## `--allow-huge` asserts the caller really wants it

The override never even stats the file — an explicit assertion prints
whatever is there.

```ts
transcriptPrintable({ logPath: hugePath, sessionId: "s3", allowHuge: true })
=> true
```

Supported-API transcripts have no native file to stat, so the guard measures the
normalized readable entries and honors the same explicit override.

```ts
const hugeEntries = [{
  uuid: "u1",
  type: "assistant" as const,
  timestamp: "",
  content: [{ type: "text" as const, text: "x".repeat(HUGE_TRANSCRIPT_BYTES + 1) }],
}];
sessionEntriesPrintable({ entries: hugeEntries, sessionId: "codex-1", allowHuge: false })
=> false

sessionEntriesPrintable({ entries: hugeEntries, sessionId: "codex-1", allowHuge: true })
=> true
```

## The threshold is generous but real

Far past readable output, low enough to catch the incident-class transcript.

```ts
HUGE_TRANSCRIPT_BYTES === 25 * 1024 * 1024
=> true
```

```ts cleanup
fs.rmSync(dir, { recursive: true, force: true });
```
