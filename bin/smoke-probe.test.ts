import assert from "node:assert/strict";
import test from "node:test";
import {
  generationStartedAt,
  isFreshGeneration,
  isRetryableVerdict,
  parseFailedPage,
  pollUntilReady,
  probeFailure,
  readHealthProbe,
  readProbe,
  worktreeState,
  type ProbeVerdict,
} from "./smoke-probe.js";
import { SmokeFailureError } from "./smoke-errors.js";

/** The shape workstreams-app/src/router/router.ts's renderFailedPage produces, trimmed to what we parse. */
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
  assert.match(unauthorized?.message ?? "", /BBX_BROWSE_API_KEY/);
  const failed = probeFailure({
    verdict: { kind: "failed", phase: "spawn", message: "boom", stderr: "trace" },
    url: "u",
    body: "",
  });
  assert.ok(failed instanceof SmokeFailureError);
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
