import assert from "node:assert/strict";
import test from "node:test";
import {
  type ProbeVerdict,
  isRetryableVerdict,
  pollUntilReady,
  readHealthProbe,
  MENU_ERROR_TEXT,
  SmokeFailure,
  cardViewRendered,
  directoryRowCount,
  expandedState,
  firstCardRow,
  generationStartedAt,
  hasDomId,
  isFreshGeneration,
  menuItemNames,
  parseFailedPage,
  placeMenuFailure,
  probeFailure,
  readPlaceMenu,
  readProbe,
  formatSmokeReport,
  refFor,
  summarizeSmokeLog,
  worktreeState,
  type SmokeRunRecord,
} from "./smoke-lib.js";

/** The shape bin/router.ts's renderFailedPage produces, trimmed to what we parse. */
const FAILED_PAGE = `<!doctype html>
<html lang="en">
<head><title>Worktree smoke-tier — failed to start</title></head>
<body>
<h1>Worktree <code>smoke-tier</code> failed to start</h1>
<p class="sub">Phase: <code>waitForHttp</code> · <span class="meta">3s ago</span></p>
<div class="err">fastify/smoke-tier did not respond to HTTP GET /healthz within 30000ms</div>
<h2>vite output</h2><pre>ready in 400 ms</pre>
<h2>fastify output</h2><pre>Error: Cannot find module &#39;./missing.js&#39;
    at loader (node:internal)</pre>
</body></html>`;

test("readProbe: 200 is ok, 401 is our credential, the failed page is the app", () => {
  assert.deepEqual(readProbe({ status: 200, body: "<html>fine</html>" }), { kind: "ok" });
  assert.deepEqual(readProbe({ status: 401, body: "" }), { kind: "unauthorized" });
  const verdict = readProbe({ status: 502, body: FAILED_PAGE });
  assert.equal(verdict.kind, "failed");
  assert.equal(verdict.kind === "failed" ? verdict.phase : null, "waitForHttp");
});

test("readProbe: a 502 that is NOT the failed page is unexpected, not a boot failure", () => {
  // Blurring these two sends someone to debug a box that booted fine.
  assert.deepEqual(readProbe({ status: 502, body: "upstream closed" }), {
    kind: "unexpected",
    status: 502,
  });
});

test("parseFailedPage: carries the child's own error, not only the router's timeout", () => {
  const parsed = parseFailedPage(FAILED_PAGE);
  assert.equal(parsed.phase, "waitForHttp");
  assert.match(parsed.message, /did not respond to HTTP GET \/healthz/);
  // Entities decoded, both children's blocks present: the cause is in there.
  assert.match(parsed.stderr, /Cannot find module '\.\/missing\.js'/);
  assert.match(parsed.stderr, /ready in 400 ms/);
});

test("parseFailedPage: restyled markup degrades instead of throwing", () => {
  const parsed = parseFailedPage("<html><body>something else entirely</body></html>");
  assert.deepEqual(parsed, { phase: "unknown", message: "", stderr: "" });
});

test("probeFailure: ok passes; every other verdict names what to do", () => {
  assert.equal(probeFailure({ verdict: { kind: "ok" }, url: "u", body: "" }), null);
  const unauthorized = probeFailure({ verdict: { kind: "unauthorized" }, url: "u", body: "" });
  assert.match(unauthorized?.message ?? "", /CB_BROWSE_API_KEY/);
  const failed = probeFailure({
    verdict: { kind: "failed", phase: "spawn", message: "boom", stderr: "trace" },
    url: "u",
    body: "",
  });
  assert.ok(failed instanceof SmokeFailure);
  assert.match(failed.message, /failed to start \(router phase: spawn\)/);
  assert.equal(failed.detail, "boom\n\ntrace");
});

test("worktreeState: known states pass through, anything else is unknown", () => {
  const status = { worktrees: { a: { state: "ready" }, b: { state: "failed" }, c: {} } };
  assert.equal(worktreeState(status, "a"), "ready");
  assert.equal(worktreeState(status, "b"), "failed");
  assert.equal(worktreeState(status, "c"), "unknown");
  assert.equal(worktreeState(status, "nope"), "unknown");
  assert.equal(worktreeState(null, "a"), "unknown");
});

test("generationStartedAt / isFreshGeneration: freshness is identity, not clock order", () => {
  const status = { worktrees: { w: { state: "ready", startedAt: 1000 } } };
  assert.equal(generationStartedAt(status, "w"), 1000);
  assert.equal(isFreshGeneration({ before: 1000, now: 1500 }), true);
  assert.equal(isFreshGeneration({ before: 1000, now: 1000 }), false);
  // A replacement started DURING teardown has an earlier timestamp than the
  // stop's return and is still a different, perfectly good generation. Ordering
  // by clock would call this stale and fail a landing for nothing.
  assert.equal(isFreshGeneration({ before: 1000, now: 900 }), true);
  // Nothing was running before: any generation now is one this run started.
  assert.equal(isFreshGeneration({ before: null, now: 900 }), true);
  // Fails closed: the router reporting no start time proves nothing.
  assert.equal(isFreshGeneration({ before: 1000, now: null }), false);
  assert.equal(isFreshGeneration({ before: null, now: null }), false);
});

const MENU_SNAPSHOT = `- navigation "Primary" [ref=e1]
  - button "Place: Chat" [expanded=true, ref=e12, id=cb-nav-place]
- menuitem "Box: test1 ›" [ref=e2, id=cb-switch-menu-box]
- menuitem "All landmarks →" [ref=e3, id=cb-switch-menu-landmarks]
- menuitem "Recent files ›" [ref=e4, id=cb-switch-menu-recent-files]
- menuitem "Box" [ref=e5]
- menuitem "Acids & Bases" [ref=e6]`;

test("readPlaceMenu: fixed rows are excluded, landmarks are what is left", () => {
  const reading = readPlaceMenu(MENU_SNAPSHOT);
  assert.equal(reading.expanded, true);
  assert.equal(reading.fixedRowsPresent, true);
  assert.deepEqual(reading.landmarkNames, ["Box", "Acids & Bases"]);
  assert.equal(reading.errored, false);
  assert.equal(placeMenuFailure(reading, MENU_SNAPSHOT), null);
});

test("placeMenuFailure: the error row wins over every other reading", () => {
  // The 2026-08-26 escape: the menu opened and looked structurally fine, but
  // its landmark query had died on broken global Codex state. Reporting
  // "collapsed" or "no landmarks" there sends someone to the wrong layer.
  const snapshot = `${MENU_SNAPSHOT}\n- StaticText "${MENU_ERROR_TEXT} — Retry"`;
  const failure = placeMenuFailure(readPlaceMenu(snapshot), snapshot);
  assert.match(failure?.message ?? "", /could not load its landmarks/);
});

test("placeMenuFailure: the ASCII apostrophe spelling is caught too", () => {
  const snapshot = `${MENU_SNAPSHOT}\n- StaticText "Couldn't load this menu — Retry"`;
  assert.equal(readPlaceMenu(snapshot).errored, true);
});

test("placeMenuFailure: a click that did not open the menu", () => {
  const collapsed = MENU_SNAPSHOT.replace("expanded=true", "expanded=false");
  const failure = placeMenuFailure(readPlaceMenu(collapsed), collapsed);
  assert.match(failure?.message ?? "", /did not open the menu/);
});

test("placeMenuFailure: fixed rows but no landmarks is its own failure", () => {
  const empty = MENU_SNAPSHOT.split("\n").slice(0, 5).join("\n");
  const failure = placeMenuFailure(readPlaceMenu(empty), empty);
  assert.match(failure?.message ?? "", /lists no landmarks/);
});

test("expandedState: absent element is null, not false", () => {
  // False would read as "the menu is closed" for an app bar that never
  // rendered — a different bug with a different fix.
  assert.equal(expandedState(MENU_SNAPSHOT, "cb-nav-place"), true);
  assert.equal(expandedState(MENU_SNAPSHOT, "cb-nav-missing"), null);
});

test("refFor: resolves role + name, and escapes regex metacharacters in the name", () => {
  assert.equal(refFor(MENU_SNAPSHOT, "menuitem", "Box"), "e5");
  assert.equal(refFor(MENU_SNAPSHOT, "menuitem", "Acids & Bases"), "e6");
  assert.equal(refFor(MENU_SNAPSHOT, "button", "Place: Chat"), "e12");
  assert.equal(refFor(MENU_SNAPSHOT, "menuitem", "Box (nope)"), null);
});

test("menuItemNames / hasDomId read the snapshot as written", () => {
  assert.equal(menuItemNames(MENU_SNAPSHOT).length, 5);
  assert.equal(hasDomId(MENU_SNAPSHOT, "cb-nav-place"), true);
  assert.equal(hasDomId(MENU_SNAPSHOT, "cb-composer-input"), false);
});

const BROWSE_SNAPSHOT = `- button "/" [ref=e26, id=cb-browse-crumb-root]
- button "box directory, 791 items" [ref=e10]
- button "docs directory" [ref=e12]
- button "Box, landmark card" [ref=e18]
- button "briefing card" [ref=e19]
- button "AGENTS.md" [ref=e20]`;

test("cardViewRendered: a mounted frame with no card in it is not a rendered card", () => {
  assert.equal(cardViewRendered('- heading "Box" [level=2, ref=e26]'), true);
  assert.equal(cardViewRendered('- link "Open full view →" [ref=e27, id=cb-browse-open-card]'), false);
  // The page's own h1 is not the card's title.
  assert.equal(cardViewRendered('- heading "Browse" [level=1, ref=e3]'), false);
});

test("directoryRowCount / firstCardRow: counted rows come from real box content", () => {
  assert.equal(directoryRowCount(BROWSE_SNAPSHOT), 2);
  assert.deepEqual(firstCardRow(BROWSE_SNAPSHOT), { role: "button", name: "Box, landmark card" });
  assert.equal(directoryRowCount("- button \"/\" [ref=e1]"), 0);
  assert.equal(firstCardRow("- button \"AGENTS.md\" [ref=e1]"), null);
});

// ── the run log ─────────────────────────────────────────────────────────────

const RUN = (over: Partial<SmokeRunRecord>): string =>
  JSON.stringify({
    ts: "2026-08-26T12:00:00.000Z",
    commit: "abc",
    branch: "worktree-x",
    worktree: "x",
    box: "test1",
    verdict: "green",
    ms: 27000,
    steps: [
      { id: "cold-start", outcome: "ok", ms: 2500 },
      { id: "place-menu", outcome: "ok", ms: 3700 },
    ],
    ...over,
  } satisfies SmokeRunRecord);

test("summarizeSmokeLog: a step's denominator is the runs it actually ran in", () => {
  // The walk stops at the first failure. Counting the later step as a pass in
  // the run it never reached is exactly the arithmetic that would get it
  // trimmed for "never failing".
  const summary = summarizeSmokeLog([
    RUN({}),
    RUN({
      verdict: "red",
      failedStep: "cold-start",
      steps: [
        { id: "cold-start", outcome: "fail", ms: 31000 },
        { id: "place-menu", outcome: "not-run", ms: 0 },
      ],
    }),
  ]);
  assert.equal(summary.runs, 2);
  assert.equal(summary.red, 1);
  const cold = summary.steps.find((s) => s.id === "cold-start");
  const menu = summary.steps.find((s) => s.id === "place-menu");
  assert.deepEqual({ ran: cold?.ran, failed: cold?.failed }, { ran: 2, failed: 1 });
  assert.deepEqual({ ran: menu?.ran, failed: menu?.failed }, { ran: 1, failed: 0 });
  assert.equal(cold?.lastFailure, "2026-08-26T12:00:00.000Z");
  assert.equal(menu?.lastFailure, null);
});

test("summarizeSmokeLog: a truncated final line does not lose the whole log", () => {
  // A run killed mid-append leaves a partial line; the report still has to work.
  const summary = summarizeSmokeLog([RUN({}), '{"ts":"2026-08-26T13:00', ""]);
  assert.equal(summary.runs, 1);
});

test("summarizeSmokeLog: steps read in walk order, by first appearance", () => {
  assert.deepEqual(
    summarizeSmokeLog([RUN({})]).steps.map((s) => s.id),
    ["cold-start", "place-menu"],
  );
});

test("formatSmokeReport: no trim advice until a clean record means something", () => {
  const oneRun = formatSmokeReport(summarizeSmokeLog([RUN({})]));
  assert.match(oneRun, /1 run logged/);
  assert.doesNotMatch(oneRun, /Never caught anything/);

  const many = formatSmokeReport(summarizeSmokeLog(Array.from({ length: 25 }, () => RUN({}))));
  assert.match(many, /25 runs logged/);
  assert.match(many, /Never caught anything in 20\+ runs/);
  assert.match(many, /cold-start, place-menu/);
});

test("formatSmokeReport: an empty log says so rather than printing a bare table", () => {
  assert.match(formatSmokeReport(summarizeSmokeLog([])), /no runs logged yet/);
});

test("summarizeSmokeLog: a fault-injected run is counted apart from every rate", () => {
  // The first weekly review read a deliberately broken run as a real
  // intermittent "worth a second look if it recurs". Folding an ordered
  // failure into `failed` is what made that reading possible.
  const summary = summarizeSmokeLog([
    RUN({}),
    RUN({
      verdict: "red",
      faultInjected: "hub throws at import",
      failedStep: "cold-start",
      steps: [
        { id: "cold-start", outcome: "fail", ms: 31000 },
        { id: "place-menu", outcome: "not-run", ms: 0 },
      ],
    }),
  ]);
  assert.equal(summary.runs, 1);
  assert.equal(summary.red, 0);
  assert.equal(summary.injectedRuns, 1);
  const cold = summary.steps.find((s) => s.id === "cold-start");
  assert.deepEqual(
    { ran: cold?.ran, failed: cold?.failed, injected: cold?.injected },
    { ran: 1, failed: 0, injected: 1 },
  );
  // And its 31s timeout must not drag the median: p50 is what the step costs
  // when it works.
  assert.equal(cold?.medianSeconds, 2.5);
  assert.equal(cold?.lastFailure, null);
});

test("formatSmokeReport: forced failures are shown, and never counted as caught", () => {
  const report = formatSmokeReport(
    summarizeSmokeLog([
      ...Array.from({ length: 25 }, () => RUN({})),
      RUN({
        verdict: "red",
        faultInjected: "hub throws at import",
        failedStep: "cold-start",
        steps: [{ id: "cold-start", outcome: "fail", ms: 31000 }],
      }),
    ]),
  );
  assert.match(report, /1 fault-injected run excluded from every count below/);
  assert.match(report, /forced/);
  // cold-start fired only on demand, so it still reads as never having caught
  // anything — which is the honest thing for a trim decision to see.
  assert.match(report, /Never caught anything in 20\+ runs[\s\S]*cold-start/);
});

test("readHealthProbe: only a health payload is ok; vite's HTML is not the backend", () => {
  assert.deepEqual(readHealthProbe({ status: 200, body: '{"status":"degraded"}' }), { kind: "ok" });
  assert.deepEqual(readHealthProbe({ status: 200, body: "<!doctype html><title>Chat</title>" }), { kind: "not-backend" });
  assert.deepEqual(readHealthProbe({ status: 200, body: '{"ok":true}' }), { kind: "not-backend" });
  assert.deepEqual(readHealthProbe({ status: 502, body: "upstream closed" }), { kind: "unexpected", status: 502 });
  assert.equal(readHealthProbe({ status: 502, body: FAILED_PAGE }).kind, "failed");
});

test("isRetryableVerdict: a box mid-boot is retried, a verdict is not", () => {
  assert.equal(isRetryableVerdict({ kind: "unexpected", status: 502 }), true);
  assert.equal(isRetryableVerdict({ kind: "not-backend" }), true);
  assert.equal(isRetryableVerdict({ kind: "ok" }), false);
  assert.equal(isRetryableVerdict({ kind: "unauthorized" }), false);
  assert.equal(isRetryableVerdict({ kind: "failed", phase: "waitForHttp", message: "", stderr: "" }), false);
});

test("pollUntilReady: 502s while the backend boots become ok within the window", async () => {
  // The 2026-08-26 shape: vite up, Fastify still starting (or reloading after
  // a post-commit CLI rebuild), then the health payload arrives.
  const answers: readonly (ProbeVerdict | null)[] = [
    null,
    { kind: "unexpected", status: 502 },
    { kind: "not-backend" },
    { kind: "ok" },
  ];
  let i = 0;
  let clock = 0;
  const result = await pollUntilReady({
    attempt: async () => answers[Math.min(i++, answers.length - 1)] ?? null,
    until: 10_000,
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
    pollMs: 250,
  });
  assert.deepEqual(result, { verdict: { kind: "ok" }, timedOut: false });
  assert.equal(i, 4);
});

test("pollUntilReady: a failed-to-start page stops the poll at once; a deadline reports the last verdict", async () => {
  const failed = { kind: "failed", phase: "waitForHttp", message: "boom", stderr: "" } as const;
  let calls = 0;
  const terminal = await pollUntilReady({
    attempt: async () => { calls++; return failed; },
    until: 10_000,
    now: () => 0,
    sleep: async () => {},
    pollMs: 250,
  });
  assert.deepEqual(terminal, { verdict: failed, timedOut: false });
  assert.equal(calls, 1);

  let clock = 0;
  const expired = await pollUntilReady({
    attempt: async () => ({ kind: "unexpected", status: 502 }),
    until: 1_000,
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
    pollMs: 250,
  });
  assert.deepEqual(expired, { verdict: { kind: "unexpected", status: 502 }, timedOut: true });
});
