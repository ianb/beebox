// # The limits on the box agent's changelog
//
// A curator lands entries unread, so the check is what keeps the doc short.

import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { sectionHandles } from "../../../src/core/agent-guide/sections.js";
import { agentChangesProblems } from "../../../src/dev/doc-check/agent-changes.js";
import { PACKAGE_ROOT } from "../../../src/lib/package-root.js";

const handles = new Set(["TOOLS"]);
const check = (...lines: string[]) => agentChangesProblems({ text: lines.join("\n"), handles });
const entry = (date: string, text?: string) => `- ${date} (abc1234): ${text ?? "A thing changed."}`;

void test("Well-formed entries pass; text that is not an entry is ignored", async (t) => {
  t.check(check("# Title", "", "Prose.", entry("2026-10-29", "See **TOOLS**."), entry("2026-10-20")), []);
});

void test("A line that is not an entry is named", async (t) => {
  t.check(check("- 2026-10-29: no hash"), ['line 1 is not "- YYYY-MM-DD (hash): text"']);
  t.check(check("- 2026-02-30 (abc1234): not a real day"), ['line 1 is not "- YYYY-MM-DD (hash): text"']);
});

void test("Thirty words pass and thirty-one fail", async (t) => {
  t.check(check(entry("2026-10-29", Array.from({ length: 30 }, () => "w").join(" "))), []);
  t.check(check(entry("2026-10-29", Array.from({ length: 31 }, () => "w").join(" "))), ["line 1 has 31 words; the limit is 30"]);
});

void test("Entries are newest first", async (t) => {
  t.check(check(entry("2026-10-20"), entry("2026-10-29")), ["line 2 is out of order; entries are newest first"]);
});

void test("A guide section that does not exist is named", async (t) => {
  t.check(check(entry("2026-10-29", "See **GONE**.")), ["line 1 names **GONE**, which is not a guide section"]);
});

// The span includes both ends: the seventh entry fails at exactly ten days,
// and passes at eleven.
void test("At most six entries in ten days", async (t) => {
  const six = ["2026-10-30", "2026-10-29", "2026-10-28", "2026-10-27", "2026-10-26", "2026-10-25"].map((d) => entry(d));
  t.check(check(...six, entry("2026-10-19")), []);
  t.check(check(...six, entry("2026-10-20")), ["7 entries in the 10 days up to 2026-10-30; the limit is 6"]);
});

void test("At most forty entries", async (t) => {
  const dated = (count: number) => Array.from({ length: count }, (_, i) => entry(new Date(Date.UTC(2026, 0, 1 + i * 3)).toISOString().slice(0, 10))).toReversed();
  t.check(check(...dated(40)), []);
  t.check(check(...dated(41)), ["41 entries; the limit is 40"]);
});

void test("The shipped doc is within the limits", async (t) => {
  const text = fs.readFileSync(path.join(PACKAGE_ROOT, "docs", "box", "agent-changes.md"), "utf8");
  t.check(agentChangesProblems({ text, handles: new Set(sectionHandles()) }), []);
});
