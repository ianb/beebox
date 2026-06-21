# Commands API

The commands API lists available commands, retrieves command details, and executes commands. Command execution supports both streaming (SSE) and synchronous modes.

```ts setup
import { makeTestServer } from "./helpers/doctest-server.js";
```

## Listing commands

`GET /api/commands/list` returns all registered commands:

```ts
const ctx = await makeTestServer();
const res = await ctx.request({ method: "GET", url: "/api/commands/list" });
res.statusCode
=> 200
```

```ts continue
Array.isArray(res.body.commands)
=> true

res.body.commands.length > 0
=> true
```

Each command has a name and description:

```ts continue
const cmd = res.body.commands[0];
typeof cmd.name
=> string

typeof cmd.description
=> string
```

```ts cleanup
await ctx.cleanup();
```

## Getting command details

`GET /api/commands/:name` returns details for a specific command:

```ts
const ctx = await makeTestServer();
const res = await ctx.request({ method: "GET", url: "/api/commands/create" });
res.statusCode
=> 200
```

```ts continue
res.body.name
=> create
```

```ts cleanup
await ctx.cleanup();
```

Unknown commands return 404:

```ts
const ctx = await makeTestServer();
const res = await ctx.request({ method: "GET", url: "/api/commands/nonexistent-command" });
res.statusCode
=> 404
```

```ts cleanup
await ctx.cleanup();
```

## Synchronous execution

Missing command name returns 400:

```ts
const ctx = await makeTestServer();
const res = await ctx.request({
  method: "POST",
  url: "/api/commands/execute-sync",
  payload: { args: {} },
});
res.statusCode
=> 400
```

```ts cleanup
await ctx.cleanup();
```

Unknown command returns 404:

```ts
const ctx = await makeTestServer();
const res = await ctx.request({
  method: "POST",
  url: "/api/commands/execute-sync",
  payload: { command: "nonexistent", args: {} },
});
res.statusCode
=> 404
```

```ts cleanup
await ctx.cleanup();
```
