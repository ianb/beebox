# Browse path classification

Classification uses the actual filesystem and the same namespace fence as file
reads. A dotted directory, extensionless file, and missing path stay distinct.

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { makeTestServer } from "../../../../helpers/doctest-server.js";
import type { TrpcContext } from "../../../../../src/webapp/trpc/context.js";
import { filesRouter } from "../../../../../src/webapp/trpc/routers/files/router.js";
```

```ts
const server = await makeTestServer();
const ctx: TrpcContext = {
  boxRoot: server.boxRoot, boxSlug: "t", user: null, authed: true, isOwner: true, isAuthenticatedOwner: true, actor: "user", services: {},
  eventBus: { emit: () => 0, emitTransient: () => {}, readSince: () => [], readRecent: () => [], subscribe: () => ({ unsubscribe: () => {} }), prune: () => 0, close: () => {} },
};
const caller = filesRouter.createCaller(ctx);
await fs.mkdir(path.join(server.boxRoot, "_content/notes.attach"), { recursive: true });
await server.seed("_content/README", "hello");
JSON.stringify(await caller.kind({ path: "_content/notes.attach" }))
=> {"kind":"directory"}

JSON.stringify(await caller.kind({ path: "_content/README" }))
=> {"kind":"file"}

JSON.stringify(await caller.kind({ path: "_content/missing" }))
=> {"kind":"missing"}

JSON.stringify(await caller.kind({ path: "" }))
=> {"kind":"directory"}

await caller.kind({ path: "_content/../package.json" })
=> throws TRPCError: Path is outside the box namespace
```

```ts continue
await fs.symlink(server.boxRoot, path.join(server.boxRoot, "_content/escape"));
await caller.kind({ path: "_content/escape/package.json" })
=> throws TRPCError: Path is outside the box namespace
```

```ts cleanup
await server.cleanup();
```
