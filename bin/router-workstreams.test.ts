import assert from "node:assert/strict";
import type { ServerResponse } from "node:http";
import { test } from "node:test";

import { renderWorkstreams, serveWorkstreams, type WorkstreamRow, type WorkstreamsDeps } from "./router-workstreams.js";

function row(overrides: Partial<WorkstreamRow>): WorkstreamRow {
  return {
    name: "seam", path: "/tmp/seam", git: { ahead: 1, dirty: 0, merged: false, tip: "tip" },
    runtime: { state: "cold" }, agent: { state: "none", reason: "" },
    session: { agent: "claude", hasSession: true, tty: null, emoji: "🧵", baseSha: "base", removed: null },
    boxState: { testSetup: false, keepUnmerged: false, pristine: null }, ...overrides,
  };
}

test("renderer emits every workstream stratum", () => {
  const html = renderWorkstreams([
    row({ name: "progress" }),
    row({ name: "merged", git: { ahead: 0, dirty: 0, merged: true, tip: "tip" }, agent: { state: "live", reason: "argv" } }),
    row({ name: "untouched", git: { ahead: 0, dirty: 0, merged: true, tip: "base" } }),
    row({ name: "held", git: { ahead: 0, dirty: 0, merged: true, tip: "tip" }, boxState: { testSetup: true, keepUnmerged: false, pristine: true } }),
    row({ name: "culled", path: null, git: null, session: { agent: "claude", hasSession: true, tty: null, emoji: null, baseSha: "base", removed: { at: "2026-08-09T00:00:00Z", merged: true } } }),
    row({ name: "forced", path: null, git: null, session: { agent: "claude", hasSession: true, tty: null, emoji: null, baseSha: "base", removed: { at: "2026-08-09T00:00:00Z", finalSha: "abcdef123456", merged: false } } }),
  ]);
  for (const heading of ["In progress", "Merged ✓, session still open", "Untouched", "Held for testing", "Recently culled", "Removed with unmerged work"]) {
    assert.ok(html.includes(heading));
  }
  assert.match(html, /href="\/workstreams\/progress\/"/);
  assert.doesNotMatch(html, /http:\/\/localhost/);
});

test("handler serves the read-only page with its own CSP", async () => {
  const captured = { status: 0, headers: {} as Record<string, string>, body: "" };
  const res = {
    writeHead(status: number, headers: Record<string, string>) { captured.status = status; captured.headers = headers; return res; },
    end(body?: string) { captured.body = body ?? ""; return res; },
  } as unknown as ServerResponse;
  const deps: WorkstreamsDeps = { list: async () => [row({})], run: async () => undefined };
  await serveWorkstreams({ method: "GET", pathname: "/workstreams/", repoRoot: "/unused", res, deps });
  assert.equal(captured.status, 200);
  assert.equal(captured.headers["content-security-policy"], "default-src 'none'; style-src 'unsafe-inline'");
  assert.match(captured.body, /workstreams/);
});

test("handler redirects the bare path and rejects detail paths", async () => {
  const captured = { status: 0, headers: {} as Record<string, string>, body: "" };
  const res = {
    writeHead(status: number, headers: Record<string, string>) { captured.status = status; captured.headers = headers; return res; },
    end(body?: string) { captured.body = body ?? ""; return res; },
  } as unknown as ServerResponse;
  const deps: WorkstreamsDeps = {
    list: async () => { throw new Error("must not list"); },
    run: async () => { throw new Error("must not run"); },
  };

  await serveWorkstreams({ method: "GET", pathname: "/workstreams", repoRoot: "/unused", res, deps });
  assert.equal(captured.status, 301);
  assert.equal(captured.headers.location, "/workstreams/");

  await serveWorkstreams({ method: "GET", pathname: "/workstreams/not-built/", repoRoot: "/unused", res, deps });
  assert.equal(captured.status, 404);
});

test("actions validate the path and redirect with command results", async () => {
  const captured = { status: 0, headers: {} as Record<string, string>, body: "" };
  const calls: string[] = [];
  const res = {
    writeHead(status: number, headers: Record<string, string>) { captured.status = status; captured.headers = headers; return res; },
    end(body?: string) { captured.body = body ?? ""; return res; },
  } as unknown as ServerResponse;
  const deps: WorkstreamsDeps = {
    list: async () => [],
    run: async (verb, name) => { calls.push(`${verb}:${name}`); },
  };

  await serveWorkstreams({ method: "POST", pathname: "/workstreams/action/focus/good_name-2", repoRoot: "/unused", res, deps });
  assert.deepEqual(calls, ["focus:good_name-2"]);
  assert.equal(captured.status, 303);
  assert.match(captured.headers.location ?? "", /flash=focus%20good_name-2%3A%20done/);

  await serveWorkstreams({ method: "POST", pathname: "/workstreams/action/focus/bad.name", repoRoot: "/unused", res, deps });
  assert.equal(captured.status, 404);
  assert.deepEqual(calls, ["focus:good_name-2"]);
});

test("an action failure flashes only the first stderr line", async () => {
  const captured = { status: 0, headers: {} as Record<string, string>, body: "" };
  const res = {
    writeHead(status: number, headers: Record<string, string>) { captured.status = status; captured.headers = headers; return res; },
    end(body?: string) { captured.body = body ?? ""; return res; },
  } as unknown as ServerResponse;
  const deps: WorkstreamsDeps = {
    list: async () => [],
    run: async () => { throw Object.assign(new Error("fallback"), { stderr: "TCC denied\nsecond line" }); },
  };

  await serveWorkstreams({ method: "POST", pathname: "/workstreams/action/close/seam", repoRoot: "/unused", res, deps });
  assert.equal(captured.status, 303);
  assert.match(decodeURIComponent(captured.headers.location ?? ""), /TCC denied$/);
  assert.doesNotMatch(captured.headers.location ?? "", /second/);
});
