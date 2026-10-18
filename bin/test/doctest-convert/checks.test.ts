// Static fidelity: a worker may reformat or rewrite a checked expression,
// but not an expected value, a check's method, or a marker.

import { test } from "tap";
import "agent-doctest/tap";
import { checksByMarker, compareChecks } from "../../doctest-convert/checks.ts";

const converted = [
  "void test(\"a\", async (t) => {",
  "  // doctest:L5",
  "  const list = load();",
  "  t.check(list, [1, 2]);",
  "  // doctest:L9",
  "  await t.checkText(render(list), \"one\\ntwo\");",
  "});",
].join("\n");

function compare(edited: string) {
  return compareChecks({ before: checksByMarker(converted, "x.test.ts"), source: edited, fileName: "x.test.ts", markerLines: [5, 9] });
}

void test("reformatting is not a change", async (t) => {
  const edited = converted
    .replace("t.check(list, [1, 2]);", "t.check(\n    list,\n    [1, 2,], // the two items\n  );")
    .replace("\"one\\ntwo\"", "'one\\ntwo'");
  t.check(compare(edited), { problems: [], changedActuals: [] });
});

void test("a changed actual value is listed, not refused", async (t) => {
  t.check(compare(converted.replace("t.check(list,", "t.check(list.toSorted(),")), {
    problems: [],
    changedActuals: ["at doctest:L5, line 4"],
  });
});

void test("an expected value, a method, or a marker cannot change", async (t) => {
  t.check(compare(converted.replace("[1, 2]", "[1, 3]")).problems, ["at doctest:L5: expected value changed (line 4)"]);
  t.check(compare(converted.replace("t.checkText(", "t.check(")).problems, ["at doctest:L9: t.checkText became t.check (line 6)"]);
  t.check(compare(converted.replace("  // doctest:L9\n", "")).problems, [
    "marker doctest:L9 appears 0 times",
    "at doctest:L5: 1 checks became 2",
    "at doctest:L9: 1 checks became 0",
  ]);
  t.check(compare(converted.replace("  t.check(list, [1, 2]);\n", "")).problems, ["at doctest:L5: 1 checks became 0"]);
});
