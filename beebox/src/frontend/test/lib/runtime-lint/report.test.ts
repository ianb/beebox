// Runtime lint records: the budget (one per subject a minute, 20 a minute in
// all, failure and recovery keyed apart), the suppressed count, the page buffer
// that bin/browse takes, the log line, and the privacy shape (no raw string in
// a record). Plan: docs/implemented-plans/runtime-lint.md, Track 1.
// First, and bare: the page buffer lives on the happy-dom window.
import "../../helpers/dom-globals.js";
import { test, type Test } from "tap";
import "@ianbicking/tap-check/tap";
import { formatRecord, opaqueId, procedureName, reportRuntimeLint, resetRuntimeLintForTest, setRuntimeLintSink, type RuntimeLintPayload } from "../../../src/lib/runtime-lint/report.js";

function setup(t: Test) {
  let now = 0;
  resetRuntimeLintForTest(() => now);
  // The development build also prints each line; keep test output quiet.
  t.capture(console, "warn");
  const sent: string[] = [];
  setRuntimeLintSink((lines) => { sent.push(...lines); });
  return { sent, at: (ms: number) => { now = ms; }, take: () => window.__bbxRuntimeLint?.take() };
}

const replaced = (content: string): RuntimeLintPayload => ({ check: "content-replaced", surface: "card-body", content: opaqueId(content), gapMs: 0 });

void test("one record per subject a minute; the next one carries the suppressed count", async (t) => {
  const { sent, at } = setup(t);
  reportRuntimeLint(replaced("_content/a.doc.card"));
  at(30_000);
  reportRuntimeLint(replaced("_content/a.doc.card"));
  reportRuntimeLint(replaced("_content/a.doc.card"));
  at(61_000);
  reportRuntimeLint(replaced("_content/a.doc.card"));
  t.check(sent, [
    "content-replaced surface=card-body content=c1 gapMs=0",
    "content-replaced surface=card-body content=c1 gapMs=0 suppressed=2",
  ]);
});

void test("20 records a minute in all; a refresh episode is outside that cap", async (t) => {
  const { sent, at } = setup(t);
  for (let i = 0; i < 25; i++) reportRuntimeLint(replaced(`_content/${i}.doc.card`));
  at(1);
  reportRuntimeLint({ check: "refresh-failed", phase: "failed", surface: "card-body", content: opaqueId("_content/x.doc.card"), kind: "unreachable" });
  // The recovery has its own key, so its failure a moment ago does not eat it.
  reportRuntimeLint({ check: "refresh-failed", phase: "recovered", surface: "card-body", content: opaqueId("_content/x.doc.card"), durationMs: 900 });
  t.check({ count: sent.length, last: sent.slice(-2) }, {
    count: 22,
    last: [
      "refresh-failed phase=failed surface=card-body content=c26 kind=unreachable suppressed=5",
      "refresh-failed phase=recovered surface=card-body content=c26 durationMs=900",
    ],
  });
});

void test("the page buffer hands each record to one reader, once", async (t) => {
  const { take } = setup(t);
  reportRuntimeLint(replaced("_content/a.doc.card"));
  t.check(take(), { records: [{ check: "content-replaced", surface: "card-body", content: opaqueId("_content/a.doc.card"), gapMs: 0, seq: 1 }], dropped: 0 });
  t.check(take(), { records: [], dropped: 0 });
});

void test("lines sent before the sender is installed wait for it", async (t) => {
  let now = 0;
  resetRuntimeLintForTest(() => now);
  t.capture(console, "warn");
  reportRuntimeLint(replaced("_content/a.doc.card"));
  now = 1;
  const sent: string[] = [];
  setRuntimeLintSink((lines) => { sent.push(...lines); });
  t.check(sent, ["content-replaced surface=card-body content=c1 gapMs=0"]);
});

void test("ids are page-local; a procedure name that is not a code name is logged as other", async (t) => {
  setup(t);
  t.check([opaqueId("_content/a.doc.card"), opaqueId("_content/b.doc.card"), opaqueId("_content/a.doc.card"), procedureName("card.get"), procedureName("/_content/a b.md")].map(String),
    ["c1", "c2", "c1", "card.get", "other"]);
});

void test("a procedure name longer than a code name is logged as other", async (t) => {
  setup(t);
  // The pattern allows 61 characters; tRPC paths are far shorter.
  const line = formatRecord({ check: "fetch-storm", procedure: procedureName(`a${"b".repeat(61)}`), input: opaqueId("x"), starts: 9, windowMs: 10_000, seq: 1 });
  t.check(line, "[runtime-lint] fetch-storm procedure=other input=c1 starts=9 windowMs=10000");
});

// Privacy: a record's content is an OpaqueId; a raw card path does not compile.
// @ts-expect-error -- a raw string is not an OpaqueId
const rawPath: RuntimeLintPayload = { check: "content-replaced", surface: "card-body", content: "_content/private.doc.card", gapMs: 0 };
void rawPath;
