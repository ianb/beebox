// # Session reports stream bounded sections
//
// `writeSessionReport` scans for summary counts, then writes the header and each
// report section separately. Large tool inputs and results therefore do not make
// the writer retain the completed transcript or concatenate a second report-sized
// string.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
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
  const chunks: string[] = [];
  await writeSessionReport({
    logPath,
    rawTranscriptCommand: "bbx session session-123 --raw --allow-huge",
    write: async (chunk) => {
      chunks.push(chunk);
    },
  });

  // Bash output of 7000 chars keeps 1500 at each end and discloses the 4000 omitted.
  t.check(chunks, [
    "# Session Report\n\n**Turns:** 1 user, 2 assistant\n**Tool calls:** 1 Bash, 0 Read, 3 total\n\n---\n\n",
    "## User\n\nStart\n",
    "\n",
    "## Assistant\n\nWorking\n\n- Write `/tmp/large.txt` (12000 chars)\n### Bash\n```\n$ make noisy\n```\nOutput:\n```\n" +
      "O".repeat(1500) +
      "\n\n... (4000 chars omitted) ...\n\n" +
      "O".repeat(1500) +
      "\n```\n\n- Grep \"needle\" in .\n  ```\n  one\ntwo\nthree\nfour\nfive\n  ```\n",
    "\n",
    "## Assistant\n\nDone\n\n",
    // Streaming does not drop report entries. The pre-existing Bash and Grep
    // summaries can still abbreviate an individual result, so the final note points
    // to the raw transcript instead of implying that a nonexistent report page can
    // recover it.
    "\n---\n\nNote: Some tool output was abbreviated. Run `bbx session session-123 --raw --allow-huge` to inspect the full transcript.\n",
  ]);
});
