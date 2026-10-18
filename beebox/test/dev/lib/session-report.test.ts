// # Session reports stream bounded sections
//
// `writeSessionReport` scans for summary counts, then writes the header and each
// report section separately. Large tool inputs and results therefore do not make
// the writer retain the completed transcript or concatenate a second report-sized
// string.

import { test } from "tap";
import "agent-doctest/tap";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { writeSessionReport } from "../../../src/dev/lib/session-report/report.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "session-report-"));
const logPath = path.join(dir, "session.jsonl");
const largeInput = "W".repeat(12_000);
const largeOutput = "O".repeat(7_000);
const lines = [
  { type: "user", message: { content: "Start" } },
  {
    type: "assistant",
    message: {
      content: [
        { type: "text", text: "Working" },
        {
          type: "tool_use",
          name: "Write",
          id: "write-1",
          input: { file_path: "/tmp/large.txt", content: largeInput },
        },
        {
          type: "tool_use",
          name: "Bash",
          id: "bash-1",
          input: { command: "make noisy" },
        },
        {
          type: "tool_use",
          name: "Grep",
          id: "grep-1",
          input: { pattern: "needle", path: "." },
        },
      ],
    },
  },
  {
    type: "user",
    message: {
      content: [
        { type: "tool_result", tool_use_id: "write-1", content: "written" },
        { type: "tool_result", tool_use_id: "bash-1", content: largeOutput },
        {
          type: "tool_result",
          tool_use_id: "grep-1",
          content: "one\ntwo\nthree\nfour\nfive\nsix\nseven",
        },
      ],
    },
  },
  { type: "assistant", message: { content: "Done" } },
];
fs.writeFileSync(logPath, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");

// ## Sections are delivered incrementally and stay in transcript order
//
// The callback receives multiple bounded chunks rather than one materialized
// report. Joining them reconstructs the public markdown output.
void test("The callback receives multiple bounded chunks rather than one materialized re...", async (t) => {
  t.teardown(async () => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L71
  const chunks: string[] = [];
  await writeSessionReport({
    logPath,
    rawTranscriptCommand: "bbx session session-123 --raw --allow-huge",
    write: async (chunk) => {
      chunks.push(chunk);
    },
  });
  const report = chunks.join("");

  // doctest:L81
  await t.checkText(chunks.length > 4, "true");

  // doctest:L84
  await t.checkText(
    report.indexOf("## User") < report.indexOf("## Assistant") &&
      report.indexOf("Working") < report.indexOf("Done"),
    "true",
  );

  // doctest:L88
  await t.checkText(
    report.includes("**Turns:** 1 user, 2 assistant") &&
      report.includes("**Tool calls:** 1 Bash, 0 Read, 3 total"),
    "true",
  );

  // doctest:L92
  await t.checkText(
    report.includes("Write `/tmp/large.txt` (12000 chars)") &&
      report.includes("(4000 chars omitted)"),
    "true",
  );

  // ## Any per-tool abbreviation is disclosed at the end
  //
  // Streaming does not drop report entries. The pre-existing Bash and Grep
  // summaries can still abbreviate an individual result, so the final note points
  // to the raw transcript instead of implying that a nonexistent report page can
  // recover it.

  // doctest:L105
  await t.checkText(
    report.endsWith(
      "---\n\nNote: Some tool output was abbreviated. Run `bbx session session-123 --raw --allow-huge` to inspect the full transcript.\n",
    ),
    "true",
  );
});
