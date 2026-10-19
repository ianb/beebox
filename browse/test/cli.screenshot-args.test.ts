// # `browse screenshot` argument parsing

import { test } from "tap";
import "@ianbicking/tap-check/tap";

// `--help` must never become an output path: before this parser returned a
// discriminated result, `bin/browse screenshot --help` took a screenshot and
// wrote a file named `--help.json`.
void test("--help must never become an output path:", async (t) => {
  // doctest:L8
  const { parseScreenshotArgs } = await import("../src/cli.js");

  // doctest:L10
  t.check(parseScreenshotArgs(["--help"]).kind, "help");

  // doctest:L13
  t.check(parseScreenshotArgs(["-h"]).kind, "help");

  // doctest:L16
  t.check(parseScreenshotArgs(["--bogus"]), {
    kind: "error",
    message: "unknown option --bogus",
  });

  // doctest:L19
  t.check(parseScreenshotArgs(["--slug"]), {
    kind: "error",
    message: "--slug needs a name",
  });

  // doctest:L22
  t.check(parseScreenshotArgs(["a.png", "b.png"]).kind, "error");

  // doctest:L25
  t.check(parseScreenshotArgs(["--full", "--slug", "login", "out/shot.png"]), {
    kind: "run",
    invocation: {
      path: "out/shot.png",
      slug: "login",
      full: true,
      annotate: false,
    },
  });

  // doctest:L28
  t.check(parseScreenshotArgs([]), {
    kind: "run",
    invocation: {
      path: null,
      slug: "shot",
      full: false,
      annotate: false,
    },
  });
});
