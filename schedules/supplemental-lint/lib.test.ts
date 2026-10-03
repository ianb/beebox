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

const finding = ({ path, line, code }: { path: string; line: number; code: string }): string => [
  "  ! unicorn(no-useless-spread): Using a spread operator here creates a new array unnecessarily.",
  `     ,-[${path}:${String(line)}:27]`,
  ` ${String(line - 1)} |     this.version += 1;`,
  ` ${String(line)} |     ${code}`,
  "     :                           ^^^",
  "     `----",
  "  help: `for…of` can iterate over iterable, it's unnecessary to convert to an array.",
  "",
].join("\n");

test("reportLines collapses an oxlint finding to its rule and flagged line", () => {
  assert.deepEqual(
    reportLines(`${finding({ path: "src/a.ts", line: 128, code: "for (const s of [...xs]) s();" })}Found 1 warning and 0 errors.\n`),
    ["! unicorn(no-useless-spread): Using a spread operator here creates a new array unnecessarily. | for (const s of [...xs]) s();"],
  );
});

test("an oxlint finding keeps its identity when its file moves or the code above it changes", () => {
  const before = reportLines(finding({ path: "src/a.ts", line: 128, code: "for (const s of [...xs]) s();" }));
  const after = reportLines(finding({ path: "src/lib/moved.ts", line: 140, code: "for (const s of [...xs]) s();" }));
  assert.deepEqual(newLines(before, after), []);
});

test("reportLines takes the flagged line of a multi-line span", () => {
  const output = [
    "  ! eslint(no-unreachable): Unreachable code.",
    "    ,-[src/t.ts:88:3]",
    " 87 |       const deadline = 0;",
    " 88 | ,->   for (;;) {",
    " 89 | |       await sleep(1);",
    " 90 | `->   }",
    "    `----",
    "  help: Remove the unreachable code or fix the control flow to make it reachable.",
  ].join("\n");
  assert.deepEqual(reportLines(output), ["! eslint(no-unreachable): Unreachable code. | for (;;) {"]);
});

test("newLines reports a genuinely new finding and nothing else", () => {
  assert.deepEqual(newLines(["a", "b"], ["b", "a", "c"]), ["c"]);
  assert.deepEqual(newLines(["a", "b"], ["b"]), []);
});

test("newLines reports a second copy of a known finding", () => {
  assert.deepEqual(newLines(["a"], ["a", "a"]), ["a"]);
});
