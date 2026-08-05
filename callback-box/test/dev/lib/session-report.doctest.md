# Session reports stream bounded sections

`writeSessionReport` scans for summary counts, then writes the header and each
report section separately. Large tool inputs and results therefore do not make
the writer retain the completed transcript or concatenate a second report-sized
string.

```ts setup
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { writeSessionReport } from "../../../src/dev/lib/session-report.js";

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
```

## Sections are delivered incrementally and stay in transcript order

The callback receives multiple bounded chunks rather than one materialized
report. Joining them reconstructs the public markdown output.

```ts
const chunks = [];
await writeSessionReport({
  logPath,
  rawTranscriptCommand: "cb session session-123 --raw --allow-huge",
  write: async (chunk) => {
    chunks.push(chunk);
  },
});
const report = chunks.join("");

chunks.length > 4
=> true

report.indexOf("## User") < report.indexOf("## Assistant") &&
  report.indexOf("Working") < report.indexOf("Done")
=> true

report.includes("**Turns:** 1 user, 2 assistant") &&
  report.includes("**Tool calls:** 1 Bash, 0 Read, 3 total")
=> true

report.includes("Write `/tmp/large.txt` (12000 chars)") &&
  report.includes("(4000 chars omitted)")
=> true
```

## Any per-tool abbreviation is disclosed at the end

Streaming does not drop report entries. The pre-existing Bash and Grep
summaries can still abbreviate an individual result, so the final note points
to the raw transcript instead of implying that a nonexistent report page can
recover it.

```ts continue
report.endsWith(
  "---\n\nNote: Some tool output was abbreviated. Run `cb session session-123 --raw --allow-huge` to inspect the full transcript.\n",
)
=> true
```

```ts cleanup
fs.rmSync(dir, { recursive: true, force: true });
```
