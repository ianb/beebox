import assert from "node:assert/strict";
import test from "node:test";
import { newLines, reportLines } from "./lib.ts";

test("reportLines drops the banner, blank lines, and per-run timings", () => {
  const output = [
    "",
    "> beebox@0.1.0 lint:circular /repo/beebox",
    "> madge --circular --extensions ts,tsx src/",
    "",
    "- Finding files",
    "Processed 1812 files (3.3s) (45 warnings)",
    "Finished in 412ms on 1812 files",
    "✔ No circular dependency found!",
    " ELIFECYCLE  Command failed with exit code 1.",
  ].join("\n");
  assert.deepEqual(reportLines(output), ["- Finding files", "✔ No circular dependency found!"]);
});

test("reportLines strips madge's ordinal so a cycle keeps its identity when the list shifts", () => {
  const before = reportLines("1) a.ts > b.ts\n2) c.ts > d.ts\n");
  const after = reportLines("1) a.ts > b.ts\n2) NEW.ts > x.ts\n3) c.ts > d.ts\n");
  assert.deepEqual(newLines(before, after), ["NEW.ts > x.ts"]);
});

test("reportLines keeps oxlint's indentation, which carries the source excerpt's shape", () => {
  assert.deepEqual(
    reportLines("  ! unicorn(no-useless-spread): ...\n 45 |     for (const x of [...xs]) f(x);   \n"),
    ["  ! unicorn(no-useless-spread): ...", " 45 |     for (const x of [...xs]) f(x);"],
  );
});

test("newLines reports a genuinely new finding and nothing else", () => {
  assert.deepEqual(newLines(["a", "b"], ["b", "a", "c"]), ["c"]);
  assert.deepEqual(newLines(["a", "b"], ["b"]), []);
});
