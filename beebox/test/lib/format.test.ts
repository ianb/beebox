// # Format Utilities
//
// `stripAnsi` removes ANSI escape codes from text, useful for logging or when color support is disabled.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { colorLevel, fmt, stripAnsi } from "../../src/lib/format.js";

void test("line 9", async (t) => {
  t.check(stripAnsi("\u001B[32m✓ done\u001B[39m"), "✓ done");

  t.check(stripAnsi("\u001B[1m\u001B[36mHeader\u001B[39m\u001B[22m"), "Header");

  t.check(stripAnsi("no codes here"), "no codes here");
});

// Color is for a terminal. Output that is not one (a tick's log, a pipe, the
// web UI's command output) is plain, and `NO_COLOR` (any non-empty value) turns
// it off even on a terminal. This test's stdout is not a terminal, so `fmt`
// emits no escape codes.
void test("Color is for a terminal.", async (t) => {
  t.check(
    [
      colorLevel({ isTTY: true, env: {} }),
      colorLevel({ isTTY: false, env: {} }),
      colorLevel({ isTTY: undefined, env: {} }),
      colorLevel({ isTTY: true, env: { NO_COLOR: "1" } }),
      colorLevel({ isTTY: true, env: { NO_COLOR: "" } }),
    ].join(" "),
    "2 0 0 0 2",
  );

  t.check(fmt.dim("  Skipped: precheck exit 75"), "  Skipped: precheck exit 75");
});
