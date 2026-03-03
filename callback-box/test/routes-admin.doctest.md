# Admin API

Admin endpoints manage box configuration. These are local-only endpoints (Telegram and Claude Code endpoints that require external APIs are not tested here).

```ts setup
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { makeTestServer } from "./helpers/doctest-server.js";
```

## Box config

`GET /api/admin/box-config` returns the current box configuration. An empty box returns defaults:

```
const ctx = await makeTestServer();
await ctx.inject({ method: "GET", url: "/api/admin/box-config" })
=>
200
{
  "boxSlug": "test",
  "allowedEmails": []«*»
}
```

``` cleanup
await ctx.cleanup();
```

## Saving allowed emails

`POST /api/admin/box-config` saves the allowed emails list:

```
const ctx = await makeTestServer();
await ctx.inject({
  method: "POST",
  url: "/api/admin/box-config",
  payload: { allowedEmails: ["alice@example.com", "bob@example.com"] },
})
=>
200
{
  "success": true,
  "allowedEmails": [
    "alice@example.com",
    "bob@example.com"
  ]
}
```

The change persists — a subsequent GET returns the saved emails:

``` continue
const res = await ctx.request({ method: "GET", url: "/api/admin/box-config" });
JSON.stringify(res.body.allowedEmails)
=> ["alice@example.com","bob@example.com"]
```

``` cleanup
await ctx.cleanup();
```

## Invalid email filtering

Invalid emails are silently filtered out:

```
const ctx = await makeTestServer();
await ctx.inject({
  method: "POST",
  url: "/api/admin/box-config",
  payload: { allowedEmails: ["valid@example.com", "not-an-email", "", "also@valid.org"] },
})
=>
200
{
  "success": true,
  "allowedEmails": [
    "valid@example.com",
    "also@valid.org"
  ]
}
```

``` cleanup
await ctx.cleanup();
```

## Missing field rejection

The endpoint rejects requests without `allowedEmails`:

```
const ctx = await makeTestServer();
const res = await ctx.request({ method: "POST", url: "/api/admin/box-config", payload: {} });
res.statusCode
=> 400
```

``` cleanup
await ctx.cleanup();
```

## Preserving other config fields

Updating `allowedEmails` preserves other config fields like `publicUrl`:

```
const ctx = await makeTestServer();
const configDir = join(ctx.boxRoot, "config");
await mkdir(configDir, { recursive: true });
await writeFile(
  join(configDir, "box.json"),
  JSON.stringify({ publicUrl: "https://example.com" }) + "\n",
);
await ctx.inject({
  method: "POST",
  url: "/api/admin/box-config",
  payload: { allowedEmails: ["user@example.com"] },
});
const res = await ctx.request({ method: "GET", url: "/api/admin/box-config" });
JSON.stringify(res.body.allowedEmails)
=> ["user@example.com"]
```

``` continue
res.body.publicUrl
=> https://example.com
```

``` cleanup
await ctx.cleanup();
```
