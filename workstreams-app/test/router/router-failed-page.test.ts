// Track 6 of docs/plans/router-transient-failure-resilience.md: a down worktree
// is unavailable, not unauthorized.
//
// Boxholder ruling, 2026-09-15: "I don't see why we'd have a 401 instead of 503,
// a down worktree is unavailable, not unauthorized." The cost of the old shape
// was measured — about half an hour on 2026-08-18 — because the wrong message is
// convincingly about the wrong thing: it points at credentials, sessions, and
// recent deploys, all plausible.

import assert from "node:assert/strict";
import test from "node:test";
import type { RouterRoute } from "../../src/router/router-auth.js";
import type { FailedLifecycle, WorktreeHandle } from "../../src/router/router-lifecycle.js";
import {
  WORKTREE_UNAVAILABLE,
  parkedWorktreeFor,
  wantsHtmlPage,
  worktreeUnavailableBody,
  writeWorktreeUnavailable,
  type UnavailableResponse,
} from "../../src/router/router-failed-page.js";

function parkedLifecycle(phase: string): FailedLifecycle {
  return {
    phase: "failed",
    lastError: {
      message: "vite/main did not respond to HTTP GET /main/ within 180000ms",
      phase,
      viteOutput: "  VITE v5  ready\nsecret-looking build output",
      fastifyOutput: "",
      at: 0,
    },
    attempts: 3,
    retryAfter: null,
  };
}

function parkedCore(name: string, phase: string): { getHandle(n: string): WorktreeHandle | undefined } {
  const handle: WorktreeHandle = { name, startedAt: 0, lifecycle: parkedLifecycle(phase) };
  return { getHandle: (n) => (n === name ? handle : undefined) };
}

interface Captured {
  status?: number | undefined;
  headers?: Record<string, string> | undefined;
  body?: string | undefined;
}
function capture(into: Captured): UnavailableResponse {
  return {
    writeHead(status, headers): void {
      into.status = status;
      into.headers = headers;
    },
    end(chunk): void {
      into.body = chunk;
    },
  };
}

test("the JSON body names the worktree and phase, and nothing else", () => {
  const body: unknown = JSON.parse(worktreeUnavailableBody("main", parkedLifecycle("waitForHttp")));
  assert.deepEqual(body, {
    error: WORKTREE_UNAVAILABLE,
    worktree: "main",
    phase: "waitForHttp",
    retry: "/__router/retry/main",
  });
});

test("the JSON body leaks nothing the caller did not already supply", () => {
  // "Don't leak more than the caller may know" — the 2026-08-18 filing. The
  // worktree name came from the caller's own URL and `phase` is a closed
  // vocabulary; the captured child output is for the browser page only.
  const raw = worktreeUnavailableBody("main", parkedLifecycle("waitForHttp"));
  assert.doesNotMatch(raw, /secret-looking build output/u);
  assert.doesNotMatch(raw, /VITE/u);
});

test("a browser navigation still gets the rich page, at 503", () => {
  const got: Captured = {};
  writeWorktreeUnavailable(capture(got), { name: "main", failed: parkedLifecycle("waitForHttp"), html: true });
  assert.equal(got.status, 503);
  assert.match(got.headers?.["content-type"] ?? "", /text\/html/u);
  assert.match(got.body ?? "", /failed to start/u);
  // The page keeps the captured output and the retry button that make it useful.
  assert.match(got.body ?? "", /secret-looking build output/u);
  assert.match(got.body ?? "", /__router\/retry\/main/u);
});

test("a native client gets JSON at 503, not a web page it cannot act on", () => {
  const got: Captured = {};
  writeWorktreeUnavailable(capture(got), { name: "main", failed: parkedLifecycle("childExit"), html: false });
  assert.equal(got.status, 503);
  assert.match(got.headers?.["content-type"] ?? "", /application\/json/u);
  assert.equal(JSON.parse(got.body ?? "{}").phase, "childExit");
});

test("content negotiation reads Accept in either header shape", () => {
  assert.equal(wantsHtmlPage("text/html,application/xhtml+xml"), true);
  assert.equal(wantsHtmlPage(["application/json", "text/html"]), true);
  assert.equal(wantsHtmlPage("application/json"), false);
  // A request with no Accept header at all — a bare fetch, not a browser.
  assert.equal(wantsHtmlPage(""), false);
});

// --- which routes carry a liveness fact at all -------------------------------

const box: RouterRoute = { kind: "box", targetWorktree: "main", targetBox: "test1" };
const rootControl: RouterRoute = { kind: "control-read", json: false };

test("a box route against a parked worktree reports unavailability", () => {
  const parked = parkedWorktreeFor(parkedCore("main", "waitForHttp"), box);
  assert.equal(parked?.name, "main");
  assert.equal(parked?.failed.lastError.phase, "waitForHttp");
});

test("the bare root keeps its 401 — it names no worktree, so there is no liveness fact", () => {
  // This is the deliberate limit of the change: `/` is the router itself, and
  // owner-session-required is the honest answer there.
  assert.equal(parkedWorktreeFor(parkedCore("main", "waitForHttp"), rootControl), null);
});

test("a healthy worktree is not reported as unavailable", () => {
  const empty = { getHandle: (): undefined => undefined };
  assert.equal(parkedWorktreeFor(empty, box), null, "a genuine auth failure still reads as one");
});

test("a box route naming a DIFFERENT worktree than the parked one is unaffected", () => {
  const other: RouterRoute = { kind: "box", targetWorktree: "sidebranch", targetBox: "test1" };
  assert.equal(parkedWorktreeFor(parkedCore("main", "waitForHttp"), other), null);
});

test("the worktree box list and asset routes carry the fact too", () => {
  const list: RouterRoute = { kind: "worktree-box-list", targetWorktree: "main" };
  const asset: RouterRoute = { kind: "worktree-asset", targetWorktree: "main" };
  assert.equal(parkedWorktreeFor(parkedCore("main", "spawn"), list)?.name, "main");
  assert.equal(parkedWorktreeFor(parkedCore("main", "spawn"), asset)?.name, "main");
});

test("a dev-read is served from disk, so a parked worktree does not stop it", () => {
  // /<w>/dev/ never cold-starts the worktree; reporting it as unavailable would
  // take away the docs a reader wants precisely when the worktree is broken.
  assert.equal(parkedWorktreeFor(parkedCore("main", "waitForHttp"), { kind: "dev-read" }), null);
});
