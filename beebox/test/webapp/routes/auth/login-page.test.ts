// # The login/setup pages are self-contained server-rendered HTML
//
// `GET /auth/login` and `GET /auth/setup` (`src/webapp/routes/auth/register.ts`, rendered by
// `src/webapp/routes/auth/login-page.ts`) serve a plain HTML `<form>` with an inline
// `<style>` and NO external or gated resource references — no `<script src>`, no
// `<link>`, no `/src/`, `/@vite/`, or `/assets/`. This is the fix for a real bug:
// behind the authenticating dev router the old React SPA login page loaded its
// bundle from gated worktree assets, the auth gate 401'd them, and login broke.
//
// The pages are base-prefix aware: behind a fronting proxy that strips
// `/<prefix>` (the trusted `x-bbx-base-prefix` header) the form action, OAuth link,
// and `returnTo` carry the prefix; with no header (prod) they are bare origin
// paths. Every interpolated value is HTML-escaped, and `returnTo` is sanitized to
// a same-origin path.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, not } from "@ianbicking/tap-check/check";
import { makeTestServer } from "../../../helpers/test-route-server.js";
import { sanitizeReturnTo } from "../../../../src/webapp/routes/auth/login-page.js";
import { escapeHtml } from "../../../../src/lib/escape-html.js";

process.env.BBX_SESSION_SECRET = "test-session-secret-for-login-page-doctest";

// ## `sanitizeReturnTo` accepts only a same-origin path, failing safe to `<prefix>/`
void test("`sanitizeReturnTo` accepts only a same-origin path, failing safe to `<prefix>/`", async (t) => {
  // A single leading-slash path passes through.
  t.check(sanitizeReturnTo({ raw: "/test/browse/card", prefix: "" }), "/test/browse/card");

  // Absent → the prefix root.
  t.check(sanitizeReturnTo({ raw: undefined, prefix: "/main" }), "/main/");

  // Escapes / traversal-shaped values collapse to the safe root:
  t.check([
    sanitizeReturnTo({ raw: "//evil.com/x", prefix: "" }),   // protocol-relative
    sanitizeReturnTo({ raw: "/\\evil.com", prefix: "" }),    // backslash escape
    sanitizeReturnTo({ raw: "http://evil/x", prefix: "" }),  // no leading slash
    sanitizeReturnTo({ raw: "/a\nb", prefix: "" }),          // CR/LF (header injection)
  ], ["/", "/", "/", "/"]);
});

// `escapeHtml` neutralizes the injection characters.
void test("escapeHtml neutralizes the injection characters.", async (t) => {
  t.check(escapeHtml("/\"><script>alert(1)</script>"), "/&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;");
});

// The pages are generated HTML, so the checks below look for the parts that matter
// rather than comparing a whole page.
// ## The bare login page renders with no gated/external resources
void test("The bare login page renders with no gated/external resources", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTestServer();

  const res = await box.server.inject({ method: "GET", url: "/auth/login" });
  t.check({ status: res.statusCode, contentType: res.headers["content-type"] }, {
    status: 200,
    contentType: "text/html",
  });
  t.check(res.payload, any(String).includes("<form method=\"POST\" action=\"/auth/login\">"));
  t.check(res.payload, any(String).includes("name=\"email\""));
  t.check(res.payload, any(String).includes("name=\"password\""));
  // None of the SPA/asset references a gated router would 401:
  t.check(res.payload, not(any(String).includes("<script")));
  t.check(res.payload, not(any(String).includes("<link")));
  t.check(res.payload, not(any(String).includes("/assets/")));
  t.check(res.payload, not(any(String).includes("/@vite/")));
  t.check(res.payload, not(any(String).includes("/src/")));

  // ## `?error=1` renders the generic error banner; a returnTo is preserved + escaped

  const withError = await box.server.inject({
    method: "GET",
    url: "/auth/login?error=1&returnTo=%2F%22%3E%3Cscript%3E",
  });
  // The banner text, and the injection attempt escaped (never a live <script>).
  t.check(withError.payload, any(String).includes("Incorrect email or password."));
  t.check(withError.payload, any(String).includes("value=\"/&quot;&gt;&lt;script&gt;\""));
  t.check(withError.payload, not(any(String).includes("<script")));

  // ## Behind a base prefix, the form action and returnTo carry it

  const prefixed = await box.server.inject({
    method: "GET",
    url: "/auth/login",
    headers: { "x-bbx-base-prefix": "/main" },
  });
  t.check(prefixed.payload, any(String).includes("action=\"/main/auth/login\""));
  t.check(prefixed.payload, any(String).includes("name=\"returnTo\" value=\"/main/\""));

  // ## The setup page: guidance without a token, a form with one

  const noToken = await box.server.inject({ method: "GET", url: "/auth/setup" });
  t.check(noToken.payload, any(String).includes("First-run setup"));
  t.check(noToken.payload, not(any(String).includes("<form")));

  const withToken = await box.server.inject({ method: "GET", url: "/auth/setup?token=abc123" });
  t.check(withToken.payload, any(String).includes("action=\"/auth/setup\""));
  t.check(withToken.payload, any(String).includes("name=\"token\" value=\"abc123\""));
  t.check(withToken.payload, any(String).includes("name=\"confirmPassword\""));
});
