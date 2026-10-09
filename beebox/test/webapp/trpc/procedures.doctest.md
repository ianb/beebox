# tRPC procedure gates: authedProcedure / ownerProcedure

The shared procedure builders enforce auth at the tRPC layer, mirroring the raw
`addOwnerCheck` preHandler. `ownerProcedure` admits only the box owner (or
auth-disabled dev, where `ctx.isOwner` is `true`); `authedProcedure` admits any
authenticated request. The context booleans (`authed`, `isOwner`) are computed
in `createContext` (`server-box-scope.ts`) so these gates are pure checks.

```ts setup
import { router, publicProcedure, authedProcedure, ownerProcedure, authenticatedOwnerProcedure } from "../../../src/webapp/trpc/procedures.js";

const testRouter = router({
  pub: publicProcedure.query(() => "pub-ok"),
  authed: authedProcedure.query(() => "authed-ok"),
  owner: ownerProcedure.query(() => "owner-ok"),
  strictOwner: authenticatedOwnerProcedure.query(() => "strict-owner-ok"),
});

// Full context with the gate booleans defaulting to denied; override per case.
function caller(over) {
  const ctx = {
    boxRoot: "/x",
    boxSlug: "t",
    eventBus: { emit: () => 0, emitTransient: () => {}, readSince: () => [], subscribe: () => ({ unsubscribe: () => {} }), prune: () => 0, close: () => {} },
    services: {},
    user: null,
    authed: false,
    isOwner: false,
    isAuthenticatedOwner: false,
    ...over,
  };
  return testRouter.createCaller(ctx);
}

// Run a call and report either its result or the TRPCError code.
async function attempt(fn) {
  try {
    return await fn();
  } catch (e) {
    return `THREW:${e.code}`;
  }
}
```

## The gates, one caller per row

Each line is `procedure caller → result`. `publicProcedure` is always
reachable. `ownerProcedure` denies a request that authenticated as a
box-*allowed* user but is not the owner (`isOwner: false`), the gap the raw
`addOwnerCheck` closed. `ctx.isOwner` is `true` for the real owner and for an
open-access box (the `openAccess` construction option,
`identity.source === "open"`), so both reach it. `authedProcedure` denies an
unauthenticated request and admits an authenticated one.

`authenticatedOwnerProcedure` refuses open access, where `ownerProcedure`
admits it. `ctx.isOwner` deliberately folds open access in, and for box-scoped
owner surfaces that is right. The machine-level secret store is the exception:
its router is the only user of the strict gate, so an open-access box reaches
every other owner surface and none of the secrets ones
(`docs/implemented-plans/secret-custody.md`). A real signed-in owner passes
both.

```ts
const cases = [
  ["pub", "anonymous", {}],
  ["owner", "authed non-owner", { authed: true, isOwner: false }],
  ["owner", "owner / open access", { isOwner: true }],
  ["authed", "unauthenticated", { authed: false }],
  ["authed", "authenticated", { authed: true }],
  ["owner", "open access (not authenticated owner)", { authed: true, isOwner: true, isAuthenticatedOwner: false }],
  ["strictOwner", "open access (not authenticated owner)", { authed: true, isOwner: true, isAuthenticatedOwner: false }],
  ["owner", "signed-in owner", { authed: true, isOwner: true, isAuthenticatedOwner: true }],
  ["strictOwner", "signed-in owner", { authed: true, isOwner: true, isAuthenticatedOwner: true }],
];
const lines = [];
for (const [procedure, who, over] of cases) {
  lines.push(`${procedure} ${who} → ${await attempt(() => caller(over)[procedure]())}`);
}
lines.join("\n")
=>
pub anonymous → pub-ok
owner authed non-owner → THREW:FORBIDDEN
owner owner / open access → owner-ok
authed unauthenticated → THREW:UNAUTHORIZED
authed authenticated → authed-ok
owner open access (not authenticated owner) → owner-ok
strictOwner open access (not authenticated owner) → THREW:FORBIDDEN
owner signed-in owner → owner-ok
strictOwner signed-in owner → strict-owner-ok
```
