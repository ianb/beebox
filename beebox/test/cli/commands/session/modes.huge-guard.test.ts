// # `bbx session` refuses to print a huge transcript without `--allow-huge`
//
// Every `bbx session` output mode scales with the transcript file (`--raw` IS the
// file, `--tool-report` exceeds it, render is entry-capped but still enormous
// past the threshold), so `transcriptPrintable` fails closed above
// `HUGE_TRANSCRIPT_BYTES` unless the caller passed `--allow-huge`. Filed from
// the 2026-08-01 OOM incident follow-up: a surprise multi-hundred-MB dump is
// never the right result, least of all for an agent reading command output.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { consoleLines } from "../../../helpers/console-lines.js";
import {
  HUGE_TRANSCRIPT_BYTES,
  sessionEntriesPrintable,
  transcriptPrintable,
} from "../../../../src/cli/commands/session/modes.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "huge-guard-"));
const smallPath = path.join(dir, "small.jsonl");
const hugePath = path.join(dir, "huge.jsonl");
fs.writeFileSync(smallPath, '{"type":"user"}\n');
// A sparse file: full reported size, no real disk writes.
fs.writeFileSync(hugePath, "");
fs.truncateSync(hugePath, HUGE_TRANSCRIPT_BYTES + 1);

// ## An ordinary transcript prints
void test("An ordinary transcript prints", async (t) => {
  t.check(transcriptPrintable({ logPath: smallPath, sessionId: "s1", allowHuge: false }), true);
});

// ## A huge transcript is refused (loudly, on stderr)
void test("A huge transcript is refused (loudly, on stderr)", async (t) => {
  const errors = consoleLines(t, "error");
  t.check(transcriptPrintable({ logPath: hugePath, sessionId: "s2", allowHuge: false }), false);
  // The file is one byte over the threshold, which both print as 25.0 MB:
  t.check(errors(), ["Refusing to print session s2: its transcript is 25.0 MB (threshold 25.0 MB). Re-run with --allow-huge if you really want a result this size."]);
});

// ## `--allow-huge` asserts the caller really wants it
//
// The override never even stats the file — an explicit assertion prints
// whatever is there.
void test("The override never even stats the file — an explicit assertion prints whateve...", async (t) => {
  t.check(transcriptPrintable({ logPath: hugePath, sessionId: "s3", allowHuge: true }), true);
});

// Supported-API transcripts have no native file to stat, so the guard measures the
// normalized readable entries and honors the same explicit override.
void test("Supported-API transcripts have no native file to stat, so the guard measures...", async (t) => {
  t.teardown(async () => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const hugeEntries = [{
    uuid: "u1",
    type: "assistant" as const,
    timestamp: "",
    content: [{ type: "text" as const, text: "x".repeat(HUGE_TRANSCRIPT_BYTES + 1) }],
  }];
  const errors = consoleLines(t, "error");
  t.check(sessionEntriesPrintable({ entries: hugeEntries, sessionId: "codex-1", allowHuge: false }), false);
  t.check(errors(), ["Refusing to print session codex-1: its readable history is 25.0 MB (threshold 25.0 MB). Re-run with --allow-huge if you really want a result this size."]);

  t.check(sessionEntriesPrintable({ entries: hugeEntries, sessionId: "codex-1", allowHuge: true }), true);
});
