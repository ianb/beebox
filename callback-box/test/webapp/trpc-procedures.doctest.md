# tRPC procedure gates: authedProcedure / ownerProcedure

The shared procedure builders enforce auth at the tRPC layer, mirroring the raw
`addOwnerCheck` preHandler. `ownerProcedure` admits only the box owner (or
auth-disabled dev, where `ctx.isOwner` is `true`); `authedProcedure` admits any
authenticated request. The context booleans (`authed`, `isOwner`) are computed
in `createContext` (`server-box-scope.ts`) so these gates are pure checks.

```ts setup
import { router, publicProcedure, authedProcedure, ownerProcedure } from "../../src/webapp/trpc/trpc.js";

const testRouter = router({
  pub: publicProcedure.query(() => "pub-ok"),
  authed: authedProcedure.query(() => "authed-ok"),
  owner: ownerProcedure.query(() => "owner-ok"),
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

## publicProcedure is always reachable

```ts
await attempt(() => caller({}).pub())
=> pub-ok
```

## ownerProcedure denies a non-owner (FORBIDDEN)

A request that authenticated as a box-*allowed* user but is not the owner
(`isOwner: false`) is rejected — the gap the raw `addOwnerCheck` closed.

```ts
await attempt(() => caller({ authed: true, isOwner: false }).owner())
=> THREW:FORBIDDEN
```

## ownerProcedure admits the owner (and auth-disabled dev)

`ctx.isOwner` is `true` for the real owner and for an open-mode box (the
`CB_ALLOW_UNAUTHENTICATED` opt-out, `identity.source === "open"`), so both reach
the procedure.

```ts
await attempt(() => caller({ isOwner: true }).owner())
=> owner-ok
```

## authedProcedure denies an unauthenticated request (UNAUTHORIZED)

```ts
await attempt(() => caller({ authed: false }).authed())
=> THREW:UNAUTHORIZED
```

## authedProcedure admits an authenticated request

```ts
await attempt(() => caller({ authed: true }).authed())
=> authed-ok
```
