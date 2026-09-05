# The login/setup pages are self-contained server-rendered HTML

`GET /auth/login` and `GET /auth/setup` (`src/webapp/routes/auth.ts`, rendered by
`src/webapp/login-page.ts`) serve a plain HTML `<form>` with an inline
`<style>` and NO external or gated resource references — no `<script src>`, no
`<link>`, no `/src/`, `/@vite/`, or `/assets/`. This is the fix for a real bug:
behind the authenticating dev router the old React SPA login page loaded its
bundle from gated worktree assets, the auth gate 401'd them, and login broke.

The pages are base-prefix aware: behind a fronting proxy that strips
`/<prefix>` (the trusted `x-bbx-base-prefix` header) the form action, OAuth link,
and `returnTo` carry the prefix; with no header (prod) they are bare origin
paths. Every interpolated value is HTML-escaped, and `returnTo` is sanitized to
a same-origin path.

```ts setup
import { makeTestServer } from "../helpers/doctest-server.js";
import { sanitizeReturnTo, escapeHtml } from "../../src/webapp/login-page.js";

process.env.BBX_SESSION_SECRET = "test-session-secret-for-login-page-doctest";
```

## `sanitizeReturnTo` accepts only a same-origin path, failing safe to `<prefix>/`

```ts
// A single leading-slash path passes through.
sanitizeReturnTo({ raw: "/test/browse/card", prefix: "" })
=> /test/browse/card

// Absent → the prefix root.
sanitizeReturnTo({ raw: undefined, prefix: "/main" })
=> /main/

// Escapes / traversal-shaped values collapse to the safe root:
JSON.stringify([
  sanitizeReturnTo({ raw: "//evil.com/x", prefix: "" }),   // protocol-relative
  sanitizeReturnTo({ raw: "/\\evil.com", prefix: "" }),    // backslash escape
  sanitizeReturnTo({ raw: "http://evil/x", prefix: "" }),  // no leading slash
  sanitizeReturnTo({ raw: "/a\nb", prefix: "" }),          // CR/LF (header injection)
])
=> ["/","/","/","/"]
```

`escapeHtml` neutralizes the injection characters.

```ts
escapeHtml("/\"><script>alert(1)</script>")
=> /&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;
```

## The bare login page renders with no gated/external resources

```ts
const box = await makeTestServer();

const res = await box.server.inject({ method: "GET", url: "/auth/login" });
print(`status: ${res.statusCode}`);
print(`content-type: ${res.headers["content-type"]}`);
print(`has form POST to /auth/login: ${res.payload.includes("<form method=\"POST\" action=\"/auth/login\">")}`);
print(`has email + password inputs: ${res.payload.includes("name=\"email\"") && res.payload.includes("name=\"password\"")}`);
// None of the SPA/asset references a gated router would 401:
print(`no <script: ${!res.payload.includes("<script")}`);
print(`no <link: ${!res.payload.includes("<link")}`);
print(`no /assets/: ${!res.payload.includes("/assets/")}`);
print(`no /@vite/ or /src/: ${!res.payload.includes("/@vite/") && !res.payload.includes("/src/")}`);
"done"
=>
status: 200
content-type: text/html
has form POST to /auth/login: true
has email + password inputs: true
no <script: true
no <link: true
no /assets/: true
no /@vite/ or /src/: true
done
```

## `?error=1` renders the generic error banner; a returnTo is preserved + escaped

```ts continue
const withError = await box.server.inject({
  method: "GET",
  url: "/auth/login?error=1&returnTo=%2F%22%3E%3Cscript%3E",
});
// The banner text, and the injection attempt escaped (never a live <script>).
print(`banner: ${withError.payload.includes("Incorrect email or password.")}`);
print(`returnTo escaped: ${withError.payload.includes("value=\"/&quot;&gt;&lt;script&gt;\"")}`);
print(`no live script tag: ${!withError.payload.includes("<script")}`);
"done"
=>
banner: true
returnTo escaped: true
no live script tag: true
done
```

## Behind a base prefix, the form action and returnTo carry it

```ts continue
const prefixed = await box.server.inject({
  method: "GET",
  url: "/auth/login",
  headers: { "x-bbx-base-prefix": "/main" },
});
print(`action: ${prefixed.payload.includes("action=\"/main/auth/login\"")}`);
print(`returnTo default: ${prefixed.payload.includes("name=\"returnTo\" value=\"/main/\"")}`);
"done"
=>
action: true
returnTo default: true
done
```

## The setup page: guidance without a token, a form with one

```ts continue
const noToken = await box.server.inject({ method: "GET", url: "/auth/setup" });
print(`guidance heading: ${noToken.payload.includes("First-run setup")}`);
print(`no form without a token: ${!noToken.payload.includes("<form")}`);

const withToken = await box.server.inject({ method: "GET", url: "/auth/setup?token=abc123" });
print(`form action: ${withToken.payload.includes("action=\"/auth/setup\"")}`);
print(`hidden token: ${withToken.payload.includes("name=\"token\" value=\"abc123\"")}`);
print(`confirm field: ${withToken.payload.includes("name=\"confirmPassword\"")}`);
"done"
=>
guidance heading: true
no form without a token: true
form action: true
hidden token: true
confirm field: true
done
```

```ts cleanup
await box.cleanup();
```
