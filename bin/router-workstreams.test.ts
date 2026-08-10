import assert from "node:assert/strict";
import fs from "node:fs/promises";
import type { ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { legacyIssuesRedirect, quotaHtml, renderWorkstreams, serveWorkstreams, type WorkstreamRow, type WorkstreamsDeps } from "./router-workstreams.js";
import { parseIssueFile } from "./router-issues.js";

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

test("quota cards show linear pace and stale capture state", () => {
  const html = quotaHtml([
    { provider: "claude", status: "available", fetchedAt: "2026-08-02T00:00:00Z", stale: true,
      windows: [{ label: "7-day window", usedPercent: 20, resetsAt: "2026-08-08T00:00:00Z", durationMinutes: 7 * 24 * 60 }] },
    { provider: "codex", status: "available", fetchedAt: "2026-08-03T00:00:00Z",
      windows: [{ label: "5-hour window", usedPercent: 60, resetsAt: "2026-08-03T05:00:00Z", durationMinutes: 5 * 60 }] },
  ], new Date("2026-08-03T00:00:00Z"));
  assert.match(html, /On track · 9 points under budget \(29% of window elapsed\)/);
  assert.match(html, /Over pace · 60 points over budget \(0% of window elapsed\)/);
  assert.match(html, /Stale · Updated/);
});

test("expired quota windows do not claim to be on track", () => {
  const html = quotaHtml([{ provider: "claude", status: "available", fetchedAt: "2026-08-03T00:00:00Z",
    windows: [{ label: "5-hour window", usedPercent: 80, resetsAt: "2026-08-03T05:00:00Z", durationMinutes: 300 }] }],
  new Date("2026-08-03T06:00:00Z"));
  assert.match(html, /Expired snapshot/);
  assert.doesNotMatch(html, /On track|Over pace|80% used/);
});

test("handler serves the read-only page with its own CSP", async () => {
  const captured = { status: 0, headers: {} as Record<string, string>, body: "" };
  const res = {
    writeHead(status: number, headers: Record<string, string>) { captured.status = status; captured.headers = headers; return res; },
    end(body?: string) { captured.body = body ?? ""; return res; },
  // Test-only structural double implements every response method this handler uses.
  } as unknown as ServerResponse;
  const deps: WorkstreamsDeps = { list: async () => [row({})], run: async () => undefined, documents: async () => ({ issues: [], plans: [] }) };
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
  // Test-only structural double implements every response method this handler uses.
  } as unknown as ServerResponse;
  const deps: WorkstreamsDeps = {
    list: async () => { throw new Error("must not list"); },
    run: async () => { throw new Error("must not run"); },
    documents: async () => { throw new Error("must not read documents"); },
  };

  await serveWorkstreams({ method: "GET", pathname: "/workstreams", repoRoot: "/unused", res, deps });
  assert.equal(captured.status, 301);
  assert.equal(captured.headers.location, "/workstreams/");

  await serveWorkstreams({ method: "GET", pathname: "/workstreams/not.built/", repoRoot: "/unused", res, deps });
  assert.equal(captured.status, 404);
});

test("actions validate the path and redirect with command results", async () => {
  const captured = { status: 0, headers: {} as Record<string, string>, body: "" };
  const calls: string[] = [];
  const res = {
    writeHead(status: number, headers: Record<string, string>) { captured.status = status; captured.headers = headers; return res; },
    end(body?: string) { captured.body = body ?? ""; return res; },
  // Test-only structural double implements every response method this handler uses.
  } as unknown as ServerResponse;
  const deps: WorkstreamsDeps = {
    list: async () => [],
    run: async (verb, name) => { calls.push(`${verb}:${name}`); },
    documents: async () => ({ issues: [], plans: [] }),
  };

  await serveWorkstreams({ method: "POST", pathname: "/workstreams/action/focus/good_name-2", repoRoot: "/unused", res, deps });
  assert.deepEqual(calls, ["focus:good_name-2"]);
  assert.equal(captured.status, 303);
  assert.match(captured.headers.location ?? "", /flash=focus%20good_name-2%3A%20done/);

  await serveWorkstreams({ method: "POST", pathname: "/workstreams/action/focus/bad.name", repoRoot: "/unused", res, deps });
  assert.equal(captured.status, 404);
  assert.deepEqual(calls, ["focus:good_name-2"]);

  await serveWorkstreams({ method: "POST", pathname: "/workstreams/action/confirm-tested/2026-08-09-test.md", repoRoot: "/unused", res, deps });
  assert.deepEqual(calls, ["focus:good_name-2", "confirm-tested:2026-08-09-test.md"]);
});

test("an action failure flashes only the first stderr line", async () => {
  const captured = { status: 0, headers: {} as Record<string, string>, body: "" };
  const res = {
    writeHead(status: number, headers: Record<string, string>) { captured.status = status; captured.headers = headers; return res; },
    end(body?: string) { captured.body = body ?? ""; return res; },
  // Test-only structural double implements every response method this handler uses.
  } as unknown as ServerResponse;
  const deps: WorkstreamsDeps = {
    list: async () => [],
    run: async () => { throw Object.assign(new Error("fallback"), { stderr: "TCC denied\nsecond line" }); },
    documents: async () => ({ issues: [], plans: [] }),
  };

  await serveWorkstreams({ method: "POST", pathname: "/workstreams/action/close/seam", repoRoot: "/unused", res, deps });
  assert.equal(captured.status, 303);
  assert.match(decodeURIComponent(captured.headers.location ?? ""), /TCC denied$/);
  assert.doesNotMatch(captured.headers.location ?? "", /second/);
});

test("issues are mounted canonically under workstreams", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workstreams-issues-"));
  await fs.mkdir(path.join(root, "issues", "bugs"), { recursive: true });
  await fs.writeFile(path.join(root, "issues", "bugs", "2026-08-09-seam.md"), "---\ntitle: Seam bug\n---\n");
  const captured = { status: 0, headers: {} as Record<string, string>, body: "" };
  const res = {
    setHeader(name: string, value: string) { captured.headers[name.toLowerCase()] = value; return res; },
    writeHead(status: number, headers: Record<string, string>) {
      captured.status = status;
      Object.assign(captured.headers, headers);
      return res;
    },
    end(body?: string) { captured.body = body ?? ""; return res; },
  // Test-only structural double implements every response method this handler uses.
  } as unknown as ServerResponse;
  const deps: WorkstreamsDeps = { list: async () => [], run: async () => undefined, documents: async () => ({ issues: [], plans: [] }) };

  await serveWorkstreams({
    method: "GET", pathname: "/workstreams/issues/", repoRoot: root,
    mainRoot: root, worktreesRoot: path.join(root, "worktrees"), res, deps,
  });
  assert.equal(captured.status, 200);
  assert.match(captured.body, /href="\/workstreams\/issues\/bugs\/2026-08-09-seam.md"/);
  assert.equal(captured.headers["content-security-policy"], "default-src 'none'; style-src 'unsafe-inline'");
});

test("legacy worktree issue URLs redirect permanently without losing suffixes", () => {
  assert.equal(legacyIssuesRedirect("/dev/issues"), "/workstreams/issues/");
  assert.equal(
    legacyIssuesRedirect("/dev/issues/bugs/example.md?state=open"),
    "/workstreams/issues/bugs/example.md?state=open",
  );
  assert.equal(legacyIssuesRedirect("/dev/issues-not-really"), null);
});

test("detail joins a workstream to its plans", async () => {
  const captured = { status: 0, headers: {} as Record<string, string>, body: "" };
  const res = {
    writeHead(status: number, headers: Record<string, string>) { captured.status = status; captured.headers = headers; return res; },
    end(body?: string) { captured.body = body ?? ""; return res; },
  // Test-only structural double implements every response method this handler uses.
  } as unknown as ServerResponse;
  const deps: WorkstreamsDeps = {
    list: async () => [row({ name: "seam" })],
    run: async () => undefined,
    documents: async () => ({ issues: [], plans: [{ title: "Seam design", status: "active", workstream: "seam", relPath: "callback-box/docs/plans/seam.md" }] }),
  };
  await serveWorkstreams({ method: "GET", pathname: "/workstreams/seam/", repoRoot: "/unused", res, deps });
  assert.equal(captured.status, 200);
  assert.match(captured.body, /Seam design/);
  assert.match(captured.body, /1 ahead, 0 dirty/);
});

test("front-page search includes culled registry rows and plan titles", () => {
  const html = renderWorkstreams(
    [row({ name: "old-seam", path: null })], "", "seam",
    { issues: [], plans: [{ title: "Seam design", status: "active", workstream: "seam", relPath: "callback-box/docs/plans/seam.md" }] },
  );
  assert.match(html, /old-seam/);
  assert.match(html, /Seam design/);
});

test("plans view groups statuses and links workstreams", async () => {
  const captured = { status: 0, headers: {} as Record<string, string>, body: "" };
  const res = {
    writeHead(status: number, headers: Record<string, string>) { captured.status = status; captured.headers = headers; return res; },
    end(body?: string) { captured.body = body ?? ""; return res; },
  // Test-only structural double implements every response method this handler uses.
  } as unknown as ServerResponse;
  const deps: WorkstreamsDeps = {
    list: async () => [], run: async () => undefined,
    documents: async () => ({ issues: [], plans: [{ title: "Seam design", status: "active", workstream: "seam", relPath: "callback-box/docs/plans/seam.md" }] }),
  };
  await serveWorkstreams({ method: "GET", pathname: "/workstreams/plans/", repoRoot: "/unused", res, deps });
  assert.equal(captured.status, 200);
  assert.match(captured.body, /active <small>1/);
  assert.match(captured.body, /href="\/workstreams\/seam\/"/);
});

test("testing view separates landed confirmation from pre-merge feedback", async () => {
  const captured = { status: 0, headers: {} as Record<string, string>, body: "" };
  const res = {
    writeHead(status: number, headers: Record<string, string>) { captured.status = status; captured.headers = headers; return res; },
    end(body?: string) { captured.body = body ?? ""; return res; },
  // Test-only structural double implements every response method this handler uses.
  } as unknown as ServerResponse;
  const issue = parseIssueFile("features/test.md", "---\ntitle: Test it\nworkstream: seam\nneeds: [manual-testing]\n---\n## Manual testing\n");
  const deps: WorkstreamsDeps = {
    list: async () => [row({ name: "seam" })], run: async () => undefined,
    documents: async () => ({ issues: [issue], plans: [], worktreeIssues: [{ worktree: "seam", issue }] }),
  };
  await serveWorkstreams({ method: "GET", pathname: "/workstreams/testing/", repoRoot: "/unused", res, deps });
  assert.match(captured.body, /action="\/workstreams\/action\/confirm-tested\/test.md"/);
  assert.equal((captured.body.match(/>Confirm<\/button>/g) ?? []).length, 1);
  assert.match(captured.body, /Pre-merge, testable in place/);
});
