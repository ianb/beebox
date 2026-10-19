// # Agent guide — the ledger and the handle registry
//
// Plan: `docs/implemented-plans/agent-guide-spec.md`, Track 1. `src/core/agent-guide/ledger.yaml`
// holds the decisions behind the always-loaded guide: the budget, one row per
// rule, and the registry of section handles. The spec is `docs/agent-guide.md`.
// This file holds the ledger to three promises: it parses, every audit a row
// names exists, and the registry, the guide's headings, and `section()` name
// the same handles in the same order.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any } from "@ianbicking/tap-check/check";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { PACKAGE_ROOT } from "../../../src/lib/package-root.js";
import { loadLedger, parseLedger, HANDLE_PATTERN } from "../../../src/core/agent-guide/ledger-schema.js";
import { section, sectionHandles, xref } from "../../../src/core/agent-guide/sections.js";
import { generateAgentGuide } from "../../../src/core/agent-guide/guide/core.js";
import { loadTests } from "../../../src/dev/lib/test-runner/runner/run-test.js";

const ledger = loadLedger();

// A guide with every optional section present: a procedure, a guide card, a personality.
const guide = generateAgentGuide({
  procedures: [{ name: "tidy", filename: "tidy.procedure.card", description: "Tidy the inbox." }],
  shape: { shapeVersion: 3, boxRoot: "/tmp/box" },
  instructionFile: "AGENTS.md",
  guides: [{ name: "cooking", guidePath: "_config/cooking.guide.card", compiledPath: "_content/docs/generated/cooking-guide.md", appliesTo: "recipes", jobTypes: [] }],
  personalitySection: "## Personality\n\nWarm and brief.",
});

// `## HANDLE` or `### HANDLE`, optionally followed by ` — subtitle`.
const HEADING = /^#{2,3} ([A-Z]+(?:_[A-Z]+)*)(?: — (.*))?$/;

interface Heading { handle: string; subtitle: string | undefined; line: number }

const headings: Heading[] = guide.split("\n").flatMap((text, line) => {
  const m = HEADING.exec(text);
  return m?.[1] === undefined ? [] : [{ handle: m[1], subtitle: m[2], line }];
});

// The rendered text under one handle's heading, up to the next heading at its level or above.
function sectionText(handle: string): string {
  const lines = guide.split("\n");
  const start = headings.find((h) => h.handle === handle)?.line ?? -1;
  const level = (lines[start] ?? "").indexOf(" ");
  let end = start + 1;
  while (end < lines.length) {
    const hashes = /^(#+) /.exec(lines[end] ?? "")?.[1];
    if (hashes !== undefined && hashes.length <= level) break;
    end++;
  }
  return lines.slice(start, end).join("\n");
}

// The name of the error `fn` throws, or "no error".
function thrown(fn: () => unknown): string {
  try {
    fn();
    return "no error";
  } catch (e) {
    return e instanceof Error ? e.name : "non-error";
  }
}

// "<handle> ← <referrer>" for each listed referrer that no longer names its handle.
async function staleReferrers(): Promise<string[]> {
  const stale: string[] = [];
  for (const entry of ledger.registry) {
    const subtitle = headings.find((h) => h.handle === entry.handle)?.subtitle;
    for (const referrer of entry.referrers) {
      const text = HANDLE_PATTERN.test(referrer) ?
        sectionText(referrer) :
        await fs.readFile(path.join(PACKAGE_ROOT, referrer), "utf-8");
      const names = text.includes(entry.handle) || (subtitle !== undefined && text.includes(subtitle));
      if (!names) stale.push(`${entry.handle} ← ${referrer}`);
    }
  }
  return stale;
}

// ## The ledger parses
//
// `loadLedger` validates `ledger.yaml` with zod at the parse boundary. The
// budget header and the registry are present; a malformed ledger names its bad
// field.
void test("loadLedger validates ledger.yaml with zod at the parse boundary.", async (t) => {
  // doctest:L88
  t.check(ledger.registry.map((e) => e.handle), [
    "THE_LAWS", "THE_LAW_OF_QUOTING", "THE_LAW_OF_SAVING", "THE_LAW_OF_CARDS", "THE_LAW_OF_CHECKING", "DOCS", "SPEAKING",
    "ABOUT_CARDS", "CARD_TYPES", "QUESTIONS", "TODOS", "DIRECTORY_LAYOUT", "BOX_CODE", "LANDMARKS", "INTAKE", "COMMANDS",
    "REACHING_THE_BOXHOLDER", "SEARCHING", "PROCEDURES", "GUIDES", "SECRETS", "TOOLS", "PROVENANCE", "HISTORY", "RECORDING",
    "PERSONALITY",
  ]);

  // doctest:L91
  // The word budgets are tuned as the guide grows, so only their shape is fixed.
  t.check(ledger.budget, {
    guide_words: any(Number).int(),
    always_loaded_words: any(Number).int(),
    uncited_words_per_section: any(Number).int(),
  });

  // doctest:L94
  t.check(thrown(() => parseLedger("budget: {}\nlint: {covered_sections: []}\nregistry: []\nrows: []\n")), "ZodError");
});

// ## Every audit a row names exists
//
// A row's `audits:` names the knowledge audits that guard its rule. An id that
// is not in `src/dev/knowledge-audits.yaml` guards nothing.
void test("A row's audits: names the knowledge audits that guard its rule.", async (t) => {
  // doctest:L104
  const suite = await loadTests(path.join(PACKAGE_ROOT, "src/dev/knowledge-audits.yaml"));
  const auditIds = new Set(suite.tests.map((entry) => entry.id));
  t.check(ledger.rows.flatMap((row) => row.audits.filter((id) => !auditIds.has(id)).map((id) => `${row.id}: ${id}`)), []);
});

// ## Registry, headings, and `section()` name the same handles
//
// Every section heading of the rendered guide is a handle, in registry order,
// and `section()` accepts exactly the registry.
void test("Every section heading of the rendered guide is a handle, in registry order, a...", async (t) => {
  // doctest:L116
  t.check(headings.map((h) => h.handle), ledger.registry.map((e) => e.handle));

  // doctest:L119
  t.check(sectionHandles(), ledger.registry.map((e) => e.handle));

  // doctest:L122
  t.check(ledger.registry.filter((e) => !HANDLE_PATTERN.test(e.handle)).map((e) => e.handle), []);
  t.check(ledger.registry.map((e) => section(e.handle)), ledger.registry.map((e) => e.handle));

  // doctest:L125
  t.check(xref("TODOS"), "**TODOS**");

  // doctest:L128
  t.check(thrown(() => section("KEY_COMMANDS")), "UnknownSectionError");
});

// ## Every listed referrer still names its handle
//
// A referrer is another handle, whose section must mention the handle, or a
// file in the package, which must mention the handle or its heading subtitle.
// A referrer that no longer names the handle is stale: a rename missed it, or
// the reference was removed and the registry was not updated.
void test("A referrer is another handle, whose section must mention the handle, or a fil...", async (t) => {
  // doctest:L140
  t.check(await staleReferrers(), []);
});
