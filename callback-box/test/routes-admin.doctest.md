# Admin API

Admin endpoints manage box configuration, Telegram connector setup, and Claude Code auth.

```ts setup
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { makeTestServer } from "./helpers/doctest-server.js";
import { createFakeTelegram } from "../src/services/telegram.js";
import { createFakeClaudeCli } from "../src/services/claude-cli.js";
```

## Box config

`GET /api/admin/box-config` returns the current box configuration. An empty box returns defaults:

```ts
const ctx = await makeTestServer();
await ctx.inject({ method: "GET", url: "/api/admin/box-config" })
=>
200
{
  "boxSlug": "test",
  "allowedEmails": []«*»
}
```

```ts cleanup
await ctx.cleanup();
```

## Saving allowed emails

`POST /api/admin/box-config` saves the allowed emails list:

```ts
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

```ts continue
const res = await ctx.request({ method: "GET", url: "/api/admin/box-config" });
JSON.stringify(res.body.allowedEmails)
=> ["alice@example.com","bob@example.com"]
```

```ts cleanup
await ctx.cleanup();
```

## Invalid email filtering

Invalid emails are silently filtered out:

```ts
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

```ts cleanup
await ctx.cleanup();
```

## Missing field rejection

The endpoint rejects requests without `allowedEmails`:

```ts
const ctx = await makeTestServer();
const res = await ctx.request({ method: "POST", url: "/api/admin/box-config", payload: {} });
res.statusCode
=> 400
```

```ts cleanup
await ctx.cleanup();
```

## Preserving other config fields

Updating `allowedEmails` preserves other config fields like `publicUrl`:

```ts
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

```ts continue
res.body.publicUrl
=> https://example.com
```

```ts cleanup
await ctx.cleanup();
```

## Telegram status — not configured

When no Telegram config exists, the status endpoint reports not configured:

```ts
const ctx = await makeTestServer({
  services: { telegram: createFakeTelegram({ username: "test_bot" }) },
});
const res = await ctx.request({ method: "GET", url: "/api/admin/telegram-status" });
res.body.configured
=> false
```

```ts cleanup
await ctx.cleanup();
```

## Telegram status — configured

When Telegram config exists and a fake service is injected, we get bot info:

```ts
const tg = createFakeTelegram({ username: "my_bot", firstName: "MyBot" });
await tg.setWebhook("https://example.com/webhook/test/telegram");
const ctx = await makeTestServer({ services: { telegram: tg } });
await ctx.seed(
  "config/connectors/telegram.secret.json",
  JSON.stringify({ botToken: "fake:token", webhookSecret: "secret" }),
);
const res = await ctx.request({ method: "GET", url: "/api/admin/telegram-status" });
res.body.configured
=> true
```

```ts continue
res.body.botUsername
=> my_bot
```

```ts continue
res.body.webhookUrl
=> https://example.com/webhook/test/telegram
```

```ts cleanup
await ctx.cleanup();
```

## Telegram setup — saves config and validates token

```ts
const tg = createFakeTelegram({ username: "new_bot", firstName: "NewBot" });
const ctx = await makeTestServer({ services: { telegram: tg } });
const res = await ctx.request({
  method: "POST",
  url: "/api/admin/telegram-setup",
  payload: { botToken: "fake:new-token" },
});
res.body.success
=> true
```

```ts continue
res.body.botUsername
=> new_bot
```

The config file is written:

```ts continue
const config = JSON.parse(await ctx.read("config/connectors/telegram.secret.json"));
config.botToken
=> fake:new-token
```

```ts continue
// webhookSecret is a random hex string
config.webhookSecret.length
=> 64
```

```ts cleanup
await ctx.cleanup();
```

## Telegram setup — missing bot token

```ts
const ctx = await makeTestServer({
  services: { telegram: createFakeTelegram({ username: "bot" }) },
});
const res = await ctx.request({
  method: "POST",
  url: "/api/admin/telegram-setup",
  payload: {},
});
res.statusCode
=> 400
```

```ts cleanup
await ctx.cleanup();
```

## Telegram disconnect

```ts
const tg = createFakeTelegram({ username: "bot" });
await tg.setWebhook("https://example.com/webhook");
const ctx = await makeTestServer({ services: { telegram: tg } });
await ctx.seed(
  "config/connectors/telegram.secret.json",
  JSON.stringify({ botToken: "fake:token", webhookSecret: "secret" }),
);
const res = await ctx.request({ method: "POST", url: "/api/admin/telegram-disconnect" });
res.body.success
=> true
```

The webhook was deleted:

```ts continue
tg.webhookUrl
=> null
```

```ts cleanup
await ctx.cleanup();
```

## Claude Code auth status

System admin routes are root-level (not under the box prefix), so we use `rootRequest`:

```ts
const ctx = await makeTestServer({
  services: { claudeCli: createFakeClaudeCli({ loggedIn: true }) },
});
const res = await ctx.rootRequest({ method: "GET", url: "/api/admin/claude-status" });
res.body.loggedIn
=> true
```

```ts cleanup
await ctx.cleanup();
```

## Claude Code auth status — not logged in

```ts
const ctx = await makeTestServer({
  services: { claudeCli: createFakeClaudeCli() },
});
const res = await ctx.rootRequest({ method: "GET", url: "/api/admin/claude-status" });
res.body.loggedIn
=> false
```

```ts cleanup
await ctx.cleanup();
```

## Claude Code login

```ts
const ctx = await makeTestServer({
  services: { claudeCli: createFakeClaudeCli() },
});
const res = await ctx.rootRequest({ method: "POST", url: "/api/admin/claude-login" });
res.body.authUrl
=> https://claude.ai/oauth/authorize?fake=1
```

```ts cleanup
await ctx.cleanup();
```

## Claude Code logout

```ts
const cli = createFakeClaudeCli({ loggedIn: true });
const ctx = await makeTestServer({ services: { claudeCli: cli } });
await ctx.rootRequest({ method: "POST", url: "/api/admin/claude-logout" });
cli.loggedIn
=> false
```

```ts cleanup
await ctx.cleanup();
```
