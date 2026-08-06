# admin.boxConfig / updateBoxConfig parity

The `admin` tRPC procedures reached parity with the raw `/api/admin/box-config`
route so the raw route can retire: `boxConfig` returns `ownerEmail`, and
`updateBoxConfig` accepts `googleServices` (not just `allowedEmails`), commits
the change, and returns both fields.

```ts setup
import { appRouter } from "../../src/webapp/trpc/router.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { simpleGit } from "simple-git";

// Owner context (ownerProcedure requires ctx.isOwner).
function caller(boxRoot) {
  const ctx = {
    boxRoot,
    boxSlug: "test",
    eventBus: { emit: () => 0, emitTransient: () => {}, readSince: () => [], subscribe: () => ({ unsubscribe: () => {} }), prune: () => 0, close: () => {} },
    services: {},
    user: { email: "owner@example.com", name: "Owner" },
    authed: true,
    isOwner: true,
  };
  return appRouter.createCaller(ctx);
}
```

## updateBoxConfig writes googleServices and commits

```ts
const box = await makeTmpBox({ git: true });
const res = await caller(box.root).admin.updateBoxConfig({ googleServices: { calendar: true, gmail: false } });
print(`ok: ${res.success}`);
print(`services: ${JSON.stringify(res.googleServices)}`);
// The change was committed (a new commit exists on top of the box's initial one).
const subject = (await simpleGit(box.root).log({ maxCount: 1 })).latest.message;
print(`commit: ${subject}`);
=>
ok: true
services: {"calendar":true,"gmail":false}
commit: Update box config: googleServices
```

## boxConfig round-trips googleServices and exposes ownerEmail

```ts continue
const cfg = await caller(box.root).admin.boxConfig();
print(`services: ${JSON.stringify(cfg.googleServices)}`);
print(`hasOwnerEmailField: ${"ownerEmail" in cfg}`);
=>
services: {"calendar":true,"gmail":false}
hasOwnerEmailField: true
```

## updateBoxConfig still accepts allowedEmails and filters non-emails

```ts continue
const res2 = await caller(box.root).admin.updateBoxConfig({
  allowedEmails: [" A@Example.COM ", "a@example.com", "not-an-email"],
});
print(JSON.stringify(res2.allowedEmails));
=>
["a@example.com"]
```

## empty input is rejected

```ts continue
const err = await caller(box.root).admin.updateBoxConfig({}).then(() => "none", (e) => e.code);
print(err);
=>
BAD_REQUEST
```
