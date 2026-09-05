# tRPC procedure gates: authedProcedure / ownerProcedure

The shared procedure builders enforce auth at the tRPC layer, mirroring the raw
`addOwnerCheck` preHandler. `ownerProcedure` admits only the box owner (or
auth-disabled dev, where `ctx.isOwner` is `true`); `authedProcedure` admits any
authenticated request. The context booleans (`authed`, `isOwner`) are computed
in `createContext` (`server-box-scope.ts`) so these gates are pure checks.

```ts setup
import { router, publicProcedure, authedProcedure, ownerProcedure, authenticatedOwnerProcedure } from "../../src/webapp/trpc/trpc.js";

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

`ctx.isOwner` is `true` for the real owner and for an open-access box (the
`openAccess` construction option, `identity.source === "open"`), so both reach
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

## authenticatedOwnerProcedure refuses open access, where ownerProcedure admits it

`ctx.isOwner` deliberately folds open access in, and for box-scoped owner
surfaces that is right. The machine-level secret store is the exception — its
router is the only user of the strict gate — so an open-access box reaches every
other owner surface and none of the secrets ones
(`docs/plans/secret-custody.md`).

```ts
const open = caller({ authed: true, isOwner: true, isAuthenticatedOwner: false });
print(`owner: ${await attempt(() => open.owner())}`);
print(`strictOwner: ${await attempt(() => open.strictOwner())}`);
=>
owner: owner-ok
strictOwner: THREW:FORBIDDEN
```

A real signed-in owner passes both:

```ts continue
const owner = caller({ authed: true, isOwner: true, isAuthenticatedOwner: true });
print(`owner: ${await attempt(() => owner.owner())}`);
print(`strictOwner: ${await attempt(() => owner.strictOwner())}`);
=>
owner: owner-ok
strictOwner: strict-owner-ok
```
