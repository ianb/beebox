// tap's junit output, read per file: the top-level suites are the files run,
// with paths relative to the package tap ran from.

import { test } from "tap";
import "agent-doctest/tap";
import { parseJunit } from "../../doctest-convert/tools.ts";

const xml = [
  "<testsuites>",
  "<testsuite name=\"../bin/test/lib/terminal-tabs.test.ts\" tests=\"5\" failures=\"0\" assertions=\"3\" skipped=\"0\">",
  "<testsuite name=\"terminal-tabs.doctest.md:23 — const x = &quot;a&quot;;\" tests=\"3\" failures=\"0\" assertions=\"2\">",
  "</testsuite></testsuite>",
  "<testsuite name=\"test/lib/env.test.ts\" tests=\"35\" failures=\"2\" assertions=\"25\">",
  "</testsuite>",
  "</testsuites>",
].join("\n");

void test("each file's failures and assertions, by repo-relative path", async (t) => {
  const results = parseJunit(xml, "beebox");
  t.check(
    { tabs: results.get("bin/test/lib/terminal-tabs.test.ts"), env: results.get("beebox/test/lib/env.test.ts") },
    { tabs: { failures: 0, assertions: 3 }, env: { failures: 2, assertions: 25 } },
  );
});
