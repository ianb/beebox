// The guarded-dev-router self-identification header (Track C of
// callback-box/docs/implemented-plans/expose-dev-router.md). On a denied `/__router/*`
// control request the router answers with `x-cb-router-guarded: 1` so
// `cb tailscale setup` can prove the auth gate is live end-to-end over Serve
// (401 + this header) and tell a guarded router apart from an ungated one
// (200, no header) or a non-router. The marker leaks nothing a bare curl
// doesn't already learn.
//
// Run with:
//   node --import tsx --test bin/router-guard-header.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";

import { routerGuardHeaders, writeDeny, type DenyRequest, type DenyResponse } from "./router.js";
import type { RouterAuthDecision } from "./router-auth.js";

interface Captured {
  status: number;
  headers: Record<string, unknown>;
  body: string;
}

// A minimal response double capturing writeHead/end — enough to assert the
// header. `writeDeny` takes the structural `DenyResponse`/`DenyRequest`, so no
// cast to Node's own types is needed.
function fakeRes(captured: Captured): DenyResponse {
  return {
    writeHead(status: number, headers?: Record<string, string>): void {
      captured.status = status;
      captured.headers = headers ?? {};
    },
    end(chunk?: string): void {
      if (typeof chunk === "string") captured.body = chunk;
    },
  };
}

function req(url: string): DenyRequest {
  return { url };
}

test("routerGuardHeaders: only /__router/* paths get the marker", () => {
  assert.deepEqual(routerGuardHeaders("/__router/status"), { "x-cb-router-guarded": "1" });
  assert.deepEqual(routerGuardHeaders("/__router/status/"), { "x-cb-router-guarded": "1" });
  assert.deepEqual(routerGuardHeaders("/__router/stop/main"), { "x-cb-router-guarded": "1" });
  assert.deepEqual(routerGuardHeaders("/__router"), { "x-cb-router-guarded": "1" });
  assert.deepEqual(routerGuardHeaders("/__router/status?foo=1"), { "x-cb-router-guarded": "1" });
  // Not a control route — no marker.
  assert.deepEqual(routerGuardHeaders("/"), {});
  assert.deepEqual(routerGuardHeaders("/main/test1/"), {});
  assert.deepEqual(routerGuardHeaders("/main/dev/"), {});
  // A worktree that merely starts with the string but isn't the control root.
  assert.deepEqual(routerGuardHeaders("/__routerish/x"), {});
});

test("writeDeny: anonymous /__router/status 401 carries the guarded header", () => {
  const captured: Captured = { status: 0, headers: {}, body: "" };
  const deny: RouterAuthDecision & { allow: false } = {
    allow: false,
    status: 401,
    reason: "owner-session-required",
    redirectToLogin: false,
    route: { kind: "control-read", json: true },
  };
  writeDeny(req("/__router/status"), { res: fakeRes(captured), decision: deny });
  assert.equal(captured.status, 401);
  assert.equal(captured.headers["x-cb-router-guarded"], "1");
  assert.equal(captured.headers["content-type"], "application/json; charset=utf-8");
  assert.equal(captured.body, `${JSON.stringify({ error: "owner-session-required" })}\n`);
});

test("writeDeny: a non-router box deny does NOT carry the header", () => {
  const captured: Captured = { status: 0, headers: {}, body: "" };
  const deny: RouterAuthDecision & { allow: false } = {
    allow: false,
    status: 401,
    reason: "box-auth-required",
    redirectToLogin: false,
    route: { kind: "box", targetWorktree: "main", targetBox: "test1" },
  };
  writeDeny(req("/main/test1/api/x"), { res: fakeRes(captured), decision: deny });
  assert.equal(captured.status, 401);
  assert.equal(captured.headers["x-cb-router-guarded"], undefined);
});

test("writeDeny: a /__router/* login redirect still carries the header", () => {
  const captured: Captured = { status: 0, headers: {}, body: "" };
  const deny: RouterAuthDecision & { allow: false } = {
    allow: false,
    status: 401,
    reason: "owner-session-required",
    redirectToLogin: true,
    route: { kind: "control" },
  };
  writeDeny(req("/__router/dashboard/main"), { res: fakeRes(captured), decision: deny });
  assert.equal(captured.status, 302);
  assert.equal(captured.headers["x-cb-router-guarded"], "1");
  assert.equal(typeof captured.headers["location"], "string");
});
