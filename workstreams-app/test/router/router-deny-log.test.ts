// What a denial line says, and — more importantly — what it must never say.

import assert from "node:assert/strict";
import test from "node:test";
import {
  UPGRADE_DENIAL_WINDOW_MS,
  UpgradeDenialThrottle,
  denialPath,
  formatDenial,
} from "../../src/router/router-deny-log.js";
import type { RouterAuthDecision } from "../../src/router/router-auth.js";

function denied(over?: Partial<RouterAuthDecision & { allow: false }>): RouterAuthDecision & { allow: false } {
  return {
    allow: false,
    status: 401,
    reason: "owner-session-required",
    redirectToLogin: false,
    route: { kind: "control-read", json: false },
    ...(over ?? {}),
  };
}

test("a denial line names exactly four fields", () => {
  assert.equal(
    formatDenial({ method: "GET", url: "/", decision: denied() }),
    "deny GET / route=control-read reason=owner-session-required",
  );
  assert.equal(
    formatDenial({
      method: "POST",
      url: "/main/test1/api/chat",
      decision: denied({ status: 401, reason: "box-auth-required", route: { kind: "box", targetWorktree: "main", targetBox: "test1" } }),
    }),
    "deny POST /main/test1/api/chat route=box reason=box-auth-required",
  );
});

test("the query string is never logged, because a credential lives there", () => {
  // docs/mobile-contract.md puts the chat webview at
  // `<baseURL>/chat?nativeComposer=1[&session=<id>][&mobileToken=<token>]`.
  // Logging a raw URL would write a live token into the durable log.
  const url = "/main/test1/chat?nativeComposer=1&session=abc&mobileToken=SECRET-DEVICE-TOKEN";
  const line = formatDenial({ method: "GET", url, decision: denied() });
  assert.doesNotMatch(line, /SECRET-DEVICE-TOKEN/u);
  assert.doesNotMatch(line, /mobileToken/u);
  assert.doesNotMatch(line, /session=/u);
  assert.match(line, /deny GET \/main\/test1\/chat route=/u);
});

test("a fragment is dropped too, and an empty path reads as the root", () => {
  assert.equal(denialPath("/main/test1#anchor"), "/main/test1");
  assert.equal(denialPath("/x?a=1#b"), "/x");
  assert.equal(denialPath(""), "/");
  assert.equal(denialPath("/"), "/");
});

test("the upgrade throttle admits one line per key per window", () => {
  const throttle = new UpgradeDenialThrottle();
  const key = "deny GET /main/test1/api/trpc route=box reason=box-auth-required";

  assert.equal(throttle.admit({ key, now: 1_000 }), true, "the first denial is always logged");
  // A tRPC wsLink retries forever, first attempt with zero delay — this is the
  // burst the throttle exists for.
  assert.equal(throttle.admit({ key, now: 1_000 }), false);
  assert.equal(throttle.admit({ key, now: 1_000 + UPGRADE_DENIAL_WINDOW_MS - 1 }), false);
  assert.equal(throttle.admit({ key, now: 1_000 + UPGRADE_DENIAL_WINDOW_MS }), true, "the window reopens");
});

test("a different reason or path is a different key, not collateral of the throttle", () => {
  const throttle = new UpgradeDenialThrottle();
  assert.equal(throttle.admit({ key: "deny GET /a route=box reason=box-auth-required", now: 0 }), true);
  assert.equal(throttle.admit({ key: "deny GET /b route=box reason=box-auth-required", now: 0 }), true);
  assert.equal(throttle.admit({ key: "deny GET /a route=box reason=target-box-unresolved", now: 0 }), true);
});

test("the throttle's key table stays bounded under path enumeration", () => {
  const throttle = new UpgradeDenialThrottle();
  // 300 distinct keys against a 256 cap: the table is dropped wholesale rather
  // than grown, so a scanner cannot make the router's memory its problem.
  for (let i = 0; i < 300; i++) {
    assert.equal(throttle.admit({ key: `deny GET /scan/${String(i)} route=unknown reason=not-found`, now: 0 }), true);
  }
  // Having cleared, an early key is admitted again rather than being remembered
  // forever. Re-logging a line is the acceptable cost of a bounded table.
  assert.equal(throttle.admit({ key: "deny GET /scan/0 route=unknown reason=not-found", now: 0 }), true);
});
