// # The form of the person's changelog
//
// Entries are added by hand at finish time; the check keeps them to one shape.

import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { whatsNewProblems } from "../../../src/dev/doc-check/whats-new.js";
import { PACKAGE_ROOT } from "../../../src/lib/package-root.js";

const check = (...lines: string[]) => whatsNewProblems(lines.join("\n"));

void test("Well-formed entries pass; prose is ignored", async (t) => {
  t.check(check("# What's new", "", "Prose.", "- 2026-11-15 **New**: A new control.", "- 2026-11-12 **Agent**: It can do more.", "- 2026-11-09 **Changed**: An older one."), []);
});

const FORM = 'is not "- YYYY-MM-DD **New|Changed|Agent**: text"';

void test("A line without one known category, or a real date, is named", async (t) => {
  t.check(check("- 2026-11-15: no category"), [`line 1 ${FORM}`]);
  t.check(check("- 2026-11-15 **Fixed**: an unknown category"), [`line 1 ${FORM}`]);
  t.check(check("- 2026-11-15 (abc1234): the agent changelog's form"), [`line 1 ${FORM}`]);
  t.check(check("- 2026-02-30 **New**: not a real day"), [`line 1 ${FORM}`]);
});

void test("Thirty words pass and thirty-one fail", async (t) => {
  t.check(check(`- 2026-11-15 **New**: ${Array.from({ length: 30 }, () => "w").join(" ")}`), []);
  t.check(check(`- 2026-11-15 **New**: ${Array.from({ length: 31 }, () => "w").join(" ")}`), ["line 1 has 31 words; the limit is 30"]);
});

void test("Entries are newest first", async (t) => {
  t.check(check("- 2026-11-09 **New**: older", "- 2026-11-15 **New**: newer"), ["line 2 is out of order; entries are newest first"]);
});

void test("The shipped doc holds its form", async (t) => {
  t.check(whatsNewProblems(fs.readFileSync(path.join(PACKAGE_ROOT, "docs", "box", "whats-new.md"), "utf8")), []);
});
