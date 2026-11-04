// # The runtime-lint drain
//
// Records the app page wrote print as `runtime-lint:` lines; anything the page
// returns that is not a drain result prints nothing. Two CLI invocations never
// print the same record twice because the page's `take()` clears the buffer it
// returns; no state is shared between processes, so no fake browser is needed.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { drainExpression, drainPlan, formatDrain, parseDrain } from "../src/runtime-lint-drain.js";

const taken = { records: [{ seq: 3, check: "content-replaced", surface: "card-body", content: "c1", gapMs: 12, shown: true }], dropped: 2 };

void test("Records print in field order without check and seq, then the dropped count", async (t) => {
  t.check(formatDrain(parseDrain(JSON.stringify(JSON.stringify(taken)))), [
    "runtime-lint: content-replaced surface=card-body content=c1 gapMs=12 shown=true",
    "runtime-lint: 2 dropped",
  ]);
});

void test("A bare JSON object (not string-wrapped) parses too", async (t) => {
  t.check(formatDrain(parseDrain(JSON.stringify({ records: [], dropped: 0 }))), []);
  t.check(formatDrain(parseDrain(JSON.stringify(taken))).length, 2);
});

void test("Null, garbage, and wrong shapes print nothing", async (t) => {
  t.check([
    formatDrain(parseDrain("null")),
    formatDrain(parseDrain(JSON.stringify("null"))),
    formatDrain(parseDrain("")),
    formatDrain(parseDrain("not json {")),
    formatDrain(parseDrain("[1,2]")),
    formatDrain(parseDrain("42")),
    formatDrain(parseDrain(JSON.stringify({ records: "x", dropped: "y" }))),
    formatDrain(parseDrain(JSON.stringify({ records: [1, null, "a"], dropped: -3 }))),
  ], [[], [], [], [], [], [], [], []]);
});

void test("A record without a string check is labeled unknown", async (t) => {
  t.check(formatDrain({ records: [{ seq: 1, n: 2 }], dropped: 0 }), ["runtime-lint: unknown n=2"]);
});

void test("Subcommands that leave the page drain before and after; close only before; unknown never", async (t) => {
  t.check(["open", "reload", "back", "forward"].map(drainPlan), Array.from({ length: 4 }, () => ({ before: true, after: true })));
  t.check(drainPlan("close"), { before: true, after: false });
  t.check(["click", "snapshot", "screenshot", "get", "eval", "fill", "scroll"].map(drainPlan), Array.from({ length: 7 }, () => ({ before: false, after: true })));
  t.check(["install", "clerk-popup", "session", "--help"].map(drainPlan), Array.from({ length: 4 }, () => ({ before: false, after: false })));
});

void test("The page expression is gated on the router base", async (t) => {
  const expr = drainExpression({ repoDir: "/r", worktree: "w", box: "b", port: 3210, routerBase: "http://localhost:3210/w/b" });
  t.check(expr.includes('"http://localhost:3210/w/b"') && expr.includes("__bbxRuntimeLint.take()"), true);
});
