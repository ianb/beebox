import assert from "node:assert/strict";
import test from "node:test";
import { newLines, reportLines } from "./lib.ts";

test("reportLines drops the banner, blank lines, and per-run timings", () => {
  const output = [
    "",
    "> beebox@0.1.0 lint:circular /repo/beebox",
    "> oxlint -f default -c .oxlint-cycles.json src/",
    "",
    "Found 0 warnings and 0 errors.",
    "Finished in 298ms on 2746 files with 1 rules using 12 threads.",
    " ELIFECYCLE  Command failed with exit code 1.",
  ].join("\n");
  assert.deepEqual(reportLines(output), []);
});

// no-cycle follows its help line with a note: the import path that closes the
// cycle, drawn over several lines. It is part of the finding, not a finding.
test("reportLines folds a no-cycle finding's path diagram into the finding", () => {
  const output = [
    "  x import(no-cycle): Dependency cycle detected",
    "    ,-[src/q/tab.ts:13:30]",
    " 12 | import { toastError } from \"../ui/toast-store\";",
    " 13 | import { useWorkspace } from \"../ws/provider\";",
    "    :                              ^^^^^^^^^^^^^^^^",
    "    `----",
    "  help: Refactor to remove the cycle. Consider extracting shared code into a separate module that both files can import.",
    "  note: These paths form a cycle:",
    "           ╭──▶ ../ws/provider (src/ws/provider.tsx)",
    "           │         ⬇ imports",
    "           │    ../../q/tab (src/q/tab.ts)",
    "           ╰─────────╯ imports the current file",
    "",
    "Found 0 warnings and 1 error.",
  ].join("\n");
  assert.deepEqual(reportLines(output), ["x import(no-cycle): Dependency cycle detected | import { useWorkspace } from \"../ws/provider\";"]);
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
