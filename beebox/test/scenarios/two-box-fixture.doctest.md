# Two-box test fixture

`createTwoBoxTestServer` (`test/helpers/test-server.ts`) boots ONE server
serving TWO independent boxes — each its own template clone (own git repo,
own `.beebox/agent-token`), each its own event bus — behind the real auth
wall (`openAccess: false` by default). It exists so cross-box tests (a probe
of another box's surface, a write-side containment test) have somewhere to
start from instead of re-deriving the two-box boot sequence each time. This
file proves the fixture itself works: both scopes answer, the boxes are
genuinely separate directories, and a box's own agent bearer does not reach
the other box's scope.

```ts setup
import { createTwoBoxTestServer } from "../helpers/test-server.js";
```

## Both scopes answer under their own slug, with an agent bearer

The server is booted `openAccess: false` by default, so an unauthenticated
request 401s and the box's own agent bearer clears the wall.

```ts
const ctx = await createTwoBoxTestServer();

const alphaAnon = await ctx.server.inject({ method: "GET", url: "/alpha/api/health" });
print(`alpha anonymous: ${alphaAnon.statusCode}`);

const alphaAuthed = await ctx.server.inject({
  method: "GET",
  url: "/alpha/api/health",
  headers: { authorization: ctx.a.agentBearerHeader() },
});
print(`alpha with its own bearer: ${alphaAuthed.statusCode}`);

const betaAuthed = await ctx.server.inject({
  method: "GET",
  url: "/beta/api/health",
  headers: { authorization: ctx.b.agentBearerHeader() },
});
print(`beta with its own bearer: ${betaAuthed.statusCode}`);
=>
alpha anonymous: 401
alpha with its own bearer: 200
beta with its own bearer: 200
```

## Box A's agent bearer does not reach box B's scope

The per-box auth wall checks the bearer against THAT box's own
`.beebox/agent-token` (`src/core/agent/token.ts`), so alpha's token is just an
unrecognized string on beta's wall — and the wall then finds no session
cookie either, so it falls through to the plain 401.

```ts continue
const crossBox = await ctx.server.inject({
  method: "GET",
  url: "/beta/api/health",
  headers: { authorization: ctx.a.agentBearerHeader() },
});
print(`alpha's bearer on beta: ${crossBox.statusCode}`);

// The same bearer keeps working on its own box, proving the token itself is
// valid — the rejection above is box-scoping, not a broken token.
const stillWorksOnAlpha = await ctx.server.inject({
  method: "GET",
  url: "/alpha/api/health",
  headers: { authorization: ctx.a.agentBearerHeader() },
});
print(`alpha's bearer on alpha: ${stillWorksOnAlpha.statusCode}`);
=>
alpha's bearer on beta: 401
alpha's bearer on alpha: 200
```

## The two boxRoots are independent clones

```ts continue
print(`different roots: ${ctx.a.boxRoot !== ctx.b.boxRoot}`);
print(`different slugs: ${ctx.a.slug} / ${ctx.b.slug}`);
=>
different roots: true
different slugs: alpha / beta
```

```ts cleanup
await ctx.cleanup();
```
